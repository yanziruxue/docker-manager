/**
 * 把 docker save / OCI 兼容镜像 tar 上传到 GitHub Releases，供他人「手动下载 + 手动导入」。
 *
 * 设计要点：
 *  - 只读 .env 的 GITHUB_TOKEN（classic PAT, scope=repo），密钥绝不入库、绝不打印。
 *  - 上传前硬校验 tar：必须含 manifest.json / repositories，且所有 Layers / Config 引用成员齐全，
 *    否则 docker load 会在他人机器上失败 —— 这一步保证交付物真的能导入。
 *  - Release 一律 prerelease=true：GitHub OTA 读 releases/latest 并匹配 linux-x64*.zip，
 *    镜像 Release 无 zip，若被当作 latest 会打断 OTA，故用独立 tag + prerelease 隔离。
 *  - 469MB 级资产走 https 流式 pipe + Content-Length，不整文件读进内存。
 *
 * 用法：
 *   node scripts/upload-docker-image.mjs --dry-run
 *   node scripts/upload-docker-image.mjs [--file <tar>] [--tag docker-image-v1.52.6] [--name <asset>]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.github.com";
const UPLOAD_HOST = "uploads.github.com";
const REPO = "yanziruxue/docker-manager";

/** 读取 .env 中的 GITHUB_TOKEN（不写入任何日志） */
function tokenFromEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*GITHUB_TOKEN\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return "";
}

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const dryRun = args.includes("--dry-run");
const TOKEN = process.env.GITHUB_TOKEN || tokenFromEnv();

/** 自动取 build-upload 下最新修改的 .tar（用户手动放过来的导出镜像） */
function findTar() {
  const dir = path.join(ROOT, "build-upload");
  const list = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".tar"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (list.length === 0) throw new Error("build-upload 下没有 .tar 镜像文件");
  return path.join(dir, list[0].f);
}

/** 扫描 tar 头（只跳读 512B 头块，不读数据区），返回成员名 → 大小 */
function scanTar(file) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  const members = new Map();
  let off = 0;
  try {
    while (off + 512 <= st.size) {
      const h = Buffer.alloc(512);
      fs.readSync(fd, h, 0, 512, off);
      let name = h.slice(0, 100).toString("utf8");
      const z = name.indexOf("\0");
      if (z >= 0) name = name.slice(0, z);
      name = name.trim();
      if (!name) break;
      const size = parseInt(h.slice(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8) || 0;
      members.set(name, size);
      off += 512 + Math.ceil(size / 512) * 512;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { size: st.size, members };
}

/** 读取 tar 内小文本文件 */
function readTarText(file, target, maxSize = 65536) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  let off = 0;
  try {
    while (off + 512 <= st.size) {
      const h = Buffer.alloc(512);
      fs.readSync(fd, h, 0, 512, off);
      let name = h.slice(0, 100).toString("utf8");
      const z = name.indexOf("\0");
      if (z >= 0) name = name.slice(0, z);
      name = name.trim();
      if (!name) break;
      const size = parseInt(h.slice(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8) || 0;
      if (name === target && size <= maxSize) {
        const b = Buffer.alloc(size);
        fs.readSync(fd, b, 0, size, off + 512);
        return b.toString("utf8");
      }
      off += 512 + Math.ceil(size / 512) * 512;
    }
  } finally {
    fs.closeSync(fd);
  }
  return null;
}

/** 硬校验：docker-archive 必要成员 + 层引用完整 */
function verifyImage(file) {
  const { size, members } = scanTar(file);
  if (!members.has("manifest.json")) throw new Error("缺少 manifest.json：docker load 无法导入（可能是纯 OCI layout）");
  if (!members.has("repositories")) throw new Error("缺少 repositories：docker load 无法导入");
  const manifest = JSON.parse(readTarText(file, "manifest.json") || "[]");
  const repositories = JSON.parse(readTarText(file, "repositories") || "{}");
  const missing = [];
  const tags = [];
  for (const m of manifest) {
    if (!members.has(m.Config)) missing.push(m.Config);
    for (const l of m.Layers || []) if (!members.has(l)) missing.push(l);
    tags.push(...(m.RepoTags || []));
  }
  if (missing.length) throw new Error(`层/配置引用缺失 ${missing.length} 个：${missing.slice(0, 3).join(", ")}`);
  if (!tags.length) throw new Error("manifest.json 无 RepoTags，导入后镜像无标签");
  return { size, memberCount: members.size, tags, repositories };
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const rs = fs.createReadStream(file);
    rs.on("data", (c) => h.update(c));
    rs.on("error", reject);
    rs.on("end", () => resolve(h.digest("hex")));
  });
}

/** gzip 完整性：流式解压计数字节，不落盘、不整块进内存 */
function gunzipByteCount(file) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const gz = zlib.createGunzip();
    gz.on("data", (c) => (n += c.length));
    gz.on("error", reject);
    gz.on("end", () => resolve(n));
    fs.createReadStream(file).on("error", reject).pipe(gz);
  });
}

async function api(method, urlPath, body) {
  const r = await fetch(API + urlPath, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "docker-manager-image-upload",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = (await r.text()).slice(0, 600);
    throw new Error(`${method} ${urlPath} → HTTP ${r.status}: ${t}`);
  }
  return r.status === 204 ? null : r.json();
}

/** 流式上传资产（Content-Length 已知，避免 469MB 整块进内存） */
function uploadAsset(releaseId, name, file, size) {
  return new Promise((resolve, reject) => {
    const target = `/repos/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;
    const req = https.request(
      {
        host: UPLOAD_HOST,
        path: target,
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": size,
          Accept: "application/vnd.github+json",
          "User-Agent": "docker-manager-image-upload",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
          } else {
            reject(new Error(`资产上传失败 HTTP ${res.statusCode}: ${data.slice(0, 600)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(120 * 60 * 1000, () => req.destroy(new Error("上传超时（120 分钟）")));
    const rs = fs.createReadStream(file);
    rs.on("error", reject);
    let sent = 0;
    let nextMark = 20 * 1024 * 1024;
    rs.on("data", (c) => {
      sent += c.length;
      if (sent >= nextMark) {
        console.log(`  上传进度 ${(sent / 1048576).toFixed(0)} / ${(size / 1048576).toFixed(0)} MiB`);
        nextMark += 20 * 1024 * 1024;
      }
    });
    rs.pipe(req);
  });
}

async function main() {
  if (!TOKEN) throw new Error("缺少 GITHUB_TOKEN（环境变量或项目根 .env）");
  const file = opt("--file", findTar());
  if (!fs.existsSync(file)) throw new Error(`文件不存在: ${file}`);
  // 压缩上传时结构校验仍读未压缩的原 tar（同一份内容），保证 docker load 可导入
  const verifyFile = opt("--verify-tar", file);
  if (!fs.existsSync(verifyFile)) throw new Error(`校验源文件不存在: ${verifyFile}`);
  const info = verifyImage(verifyFile);
  const uploadSize = fs.statSync(file).size;
  const isGz = file.endsWith(".gz");
  if (isGz) {
    const expanded = await gunzipByteCount(file);
    if (expanded !== info.size) throw new Error(`gzip 解压后 ${expanded} B != 源 tar ${info.size} B`);
    console.log("gzip 完整性: ✅ 解压后", expanded, "B 与源 tar 字节数一致");
  }
  const ver = (info.tags[0].match(/v\d+\.\d+\.\d+/) || path.basename(file).match(/v\d+\.\d+\.\d+/) || ["v-unknown"])[0];
  const tag = opt("--tag", `docker-image-${ver}`);
  const name = opt("--name", `dockermanagementyanzi-docker-${ver}.tar${isGz ? ".gz" : ""}`);
  console.log("=== 镜像硬校验 ===");
  console.log("上传文件:", path.relative(ROOT, file));
  console.log("上传字节数:", uploadSize, `(${(uploadSize / 1048576).toFixed(2)} MiB)`);
  console.log("结构校验源:", path.relative(ROOT, verifyFile), `(${(info.size / 1048576).toFixed(2)} MiB)`);
  console.log("tar 成员:", info.memberCount, "| RepoTags:", info.tags.join(", "));
  const digest = await sha256(file);
  console.log("SHA-256:", digest);
  console.log("manifest/repositories/层引用: ✅ 齐全（docker load 可导入）");
  console.log("=== 发布计划 ===");
  console.log("repo:", REPO, "| tag:", tag, "| prerelease: true（保护 releases/latest / OTA）");
  console.log("asset:", name);
  if (dryRun) {
    console.log("[dry-run] 未创建/修改任何 Release，未上传任何资产");
    return;
  }

  // 校验身份 + 现有 latest（上传前后对比，证明 OTA 未受影响）
  const me = await api("GET", "/user");
  console.log("GitHub 身份:", me.login);
  const latestBefore = await api("GET", `/repos/${REPO}/releases/latest`);
  console.log("上传前 releases/latest:", latestBefore.tag_name);

  const body = [
    `## Docker 镜像（离线手动下载 / 导入）`,
    ``,
    `- 镜像版本：**${ver}**（linux/amd64）`,
    `- 文件：\`${name}\`（${uploadSize.toLocaleString()} B / ${(uploadSize / 1048576).toFixed(2)} MiB）`,
    `- SHA-256：\`${digest}\``,
    `- 格式：docker-archive${isGz ? "（gzip 压缩，docker load / NAS 导入界面会自动解压）" : ""}（含 \`manifest.json\` / \`repositories\`，同时兼容 OCI layout）`,
    ``,
    `### 1. 下载`,
    `点击本页 Assets 中的 \`${name}\`，或命令行：`,
    `\`\`\`bash`,
    `curl -L -o ${name} \\`,
    `  https://github.com/${REPO}/releases/download/${tag}/${name}`,
    `\`\`\``,
    ``,
    `### 2. 导入（Docker / Unraid / 飞牛等「导入镜像」界面可直接选该文件；.tar.gz 由 docker load 自动解压）`,
    `\`\`\`bash`,
    `docker load -i ${name}`,
    `# 导入后的镜像名带内网仓库前缀，可按需改成简短名字`,
    `docker tag ${info.tags[0]} dockermanagementyanzi:${ver}`,
    `\`\`\``,
    ``,
    `### 3. 运行`,
    `参考仓库 \`deploy/docker/docker-compose.yml\`。程序数据/配置目录需按该文件挂载。`,
    ``,
    `> 本 Release 标记为 **prerelease**，不含 OTA 所需的 \`linux-x64*.zip\`，`,
    `> 因此不会改变 \`releases/latest\`，不影响应用内在线升级。`,
  ].join("\n");

  let release;
  try {
    release = await api("GET", `/repos/${REPO}/releases/tags/${tag}`);
    console.log(`Release ${tag} 已存在（id=${release.id}）；同步资产说明并强制 prerelease=true`);
    release = await api("PATCH", `/repos/${REPO}/releases/${release.id}`, { body, prerelease: true });
  } catch {
    release = await api("POST", `/repos/${REPO}/releases`, {
      tag_name: tag,
      name: `Docker 镜像 ${ver}（手动下载 / 导入）`,
      body,
      prerelease: true,
      draft: false,
    });
    console.log(`已创建 Release ${tag}（id=${release.id}, prerelease=${release.prerelease}）`);
  }

  // 同名资产先删（GitHub 不允许同名重复）
  const existing = (release.assets || []).find((a) => a.name === name);
  if (existing) {
    console.log(`删除同名旧资产 ${name}（id=${existing.id}）`);
    await api("DELETE", `/repos/${REPO}/releases/assets/${existing.id}`);
  }
  console.log(`开始上传 ${(uploadSize / 1048576).toFixed(2)} MiB ...`);
  const asset = await uploadAsset(release.id, name, file, uploadSize);
  console.log("上传完成：", asset.name || name, "state=", asset.state || "uploaded");

  // 端到端核验：资产 size 与本地一致 + latest 未变
  const after = await api("GET", `/repos/${REPO}/releases/tags/${tag}`);
  const got = (after.assets || []).find((a) => a.name === name);
  if (!got) throw new Error("核验失败：Release 中找不到刚上传的资产");
  if (got.size !== uploadSize) throw new Error(`核验失败：远端 size=${got.size} != 本地 ${uploadSize}`);
  const latestAfter = await api("GET", `/repos/${REPO}/releases/latest`);
  console.log("=== 端到端核验 ===");
  console.log("资产 size 一致:", got.size === uploadSize ? "✅" : "❌", got.size);
  console.log("资产 state:", got.state);
  console.log("下载地址:", got.browser_download_url);
  console.log("releases/latest 上传前后:", latestBefore.tag_name, "→", latestAfter.tag_name,
    latestBefore.tag_name === latestAfter.tag_name ? "✅ OTA 未受影响" : "❌ OTA 被改变");
}

main().catch((e) => {
  console.error("[ERROR]", e.message || e);
  process.exit(1);
});
