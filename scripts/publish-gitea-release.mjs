#!/usr/bin/env node
/**
 * 一键发布到自建 Gitea Releases（yanzi/docker-manager-yanzi）。
 *
 * 前置：
 *   - 仓库必须可匿名读（owner 账号 visibility=public；否则 OTA / quick-install.sh 的
 *     Gitea 分支会 404 并退化为只走 GitHub）—— 见 MEMORY「Gitea 仓库必须可匿名读」。
 *   - 令牌按 host 存于 wincred；脚本自动用 `git credential fill` 按**当前 base 的
 *     protocol+host** 取出（换入口后 host 变了，需对新 host 单独 approve 一次）。
 *     也可显式 `GITEA_TOKEN=xxx` 覆盖（推荐，最省事）。
 *
 * 用法：
 *   node scripts/publish-gitea-release.mjs                  # 发 package.json 当前版本
 *   node scripts/publish-gitea-release.mjs --version 1.39.0 # 指定版本（补历史发布）
 *   GITEA_TOKEN=xxx node scripts/publish-gitea-release.mjs --version 1.39.2
 *   UPDATE_GITEA_BASE=http://192.168.24.16:8024 node scripts/publish-gitea-release.mjs
 *
 * 行为：
 *   1. 版本取 --version > package.json version → TAG = vX.Y.Z
 *   2. notes 取自 docs/CHANGELOG.md 中 ## vX.Y.Z 段落（与 GitHub 发布保持一致）
 *   3. 资产：版本化 zip + 无版本 latest 别名 zip（同字节）+ quick-install.sh
 *   4. Release 已存在 → 删除后重建（保证 asset 与 notes 干净）；否则直接创建
 *   5. 上传 3 个资产；直链前缀 /{owner}/{repo}/releases/download/{tag}/{name}
 *   6. 发布后回读 /releases/latest 校验（须指向本次或更新的 tag，否则告警）
 *
 * ⚠️ 补历史版本时 latest 别名 zip 会被覆盖为该版本的包 —— 补完最后一个（最新）
 *    版本后须再发一次最新版本，或手动确认 latest 别名指向正确。
 *
 * 安全：token 仅来自 wincred / 环境变量，脚本内不出现明文。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const GITEA_BASE = (process.env.UPDATE_GITEA_BASE || "http://192.168.24.16:8024").replace(/\/$/, "");
const GITEA_REPO = process.env.UPDATE_GITEA_REPO || "yanzi/docker-manager-yanzi";

/** 解析 --version 1.2.3（支持 v 前缀） */
function parseVersionArg() {
  const i = process.argv.indexOf("--version");
  if (i < 0) return null;
  const raw = String(process.argv[i + 1] || "").trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(raw)) {
    console.error(`[ERROR] --version 需要形如 1.39.0 的版本号，收到: "${process.argv[i + 1]}"`);
    process.exit(1);
  }
  return raw;
}

// ---------- 取令牌 ----------
/** 令牌按「当前入口的 protocol+host」存放，换入口后必须对新 host 单独 approve */
function getToken() {
  if (process.env.GITEA_TOKEN) return process.env.GITEA_TOKEN;
  const u = new URL(GITEA_BASE);
  try {
    const out = execFileSync(
      "git",
      ["credential", "fill"],
      {
        input: `protocol=${u.protocol.replace(":", "")}\nhost=${u.host}\n\n`,
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      }
    );
    const m = out.match(/^password=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch (e) {
    console.error("[WARN] 无法从 wincred 取 Gitea 令牌：" + (e?.message || e));
  }
  throw new Error(
    `[ERROR] 需要 Gitea 令牌。请用 GITEA_TOKEN=xxx 环境变量，或对当前入口执行一次：\n` +
    `  printf 'protocol=${u.protocol.replace(":", "")}\\nhost=${u.host}\\nusername=yanzi\\npassword=<令牌>\\n\\n' | git credential approve`
  );
}

// ---------- 取 notes ----------
function extractChangelog(tag) {
  const file = path.join(ROOT, "docs", "CHANGELOG.md");
  if (!fs.existsSync(file)) return "";
  const md = fs.readFileSync(file, "utf-8");
  const escaped = tag.replace(/\./g, "\\.");
  const re = new RegExp("## " + escaped + "[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

// 令牌惰性获取：先让参数校验跑完，避免「参数写错」被 wincred 报错掩盖
let _token = null;
function token() {
  if (!_token) _token = getToken();
  return _token;
}

async function api(method, p, { body, raw, contentType } = {}) {
  const res = await fetch(GITEA_BASE + p, {
    method,
    headers: {
      Authorization: `token ${token()}`,
      Accept: "application/json",
      "User-Agent": "docker-manager-gitea-release",
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`[Gitea ${method} ${p}] -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;
  const version = parseVersionArg() || pkgVersion;
  const TAG = "v" + version;
  const [owner, repo] = GITEA_REPO.split("/");
  const notes = extractChangelog(TAG) || `Release ${TAG}`;

  const zip = path.join(ROOT, "build-upload", `docker-manager-yanzi-linux-x64-v${version}.zip`);
  const aliasZip = path.join(ROOT, "build-upload", "docker-manager-yanzi-linux-x64.zip");
  const scriptAsset = path.join(ROOT, "scripts", "quick-install.sh");

  if (!fs.existsSync(zip)) {
    console.error(`[ERROR] 未找到交付包: ${zip}`);
    console.error(`  · package.json 当前版本 = ${pkgVersion}${version !== pkgVersion ? "（本次发的是 --version 指定版本）" : ""}`);
    console.error(`  · 补历史版本时需先把对应的 zip 放回 build-upload/`);
    process.exit(1);
  }
  // latest 别名 zip 与版本化 zip 同字节（补历史版本也会刷新它 ⇒ 补完最新版本后须再发一次最新版本）
  fs.copyFileSync(zip, aliasZip);
  const assets = [zip, aliasZip, scriptAsset].filter((f) => fs.existsSync(f));

  console.log(`发布目标: ${GITEA_REPO} @ ${TAG}（${GITEA_BASE}）`);
  if (version !== pkgVersion) {
    console.log(`  ⚠️ 补历史发布：package.json 当前为 ${pkgVersion}，本次发 ${TAG}`);
  }

  // 已存在则删除重建（保证干净）
  let existing = null;
  try {
    existing = await api("GET", `/api/v1/repos/${GITEA_REPO}/releases/tags/${TAG}`);
  } catch {}
  if (existing) {
    console.log(`Release ${TAG} 已存在（id=${existing.id}），删除后重建...`);
    await api("DELETE", `/api/v1/repos/${GITEA_REPO}/releases/${existing.id}`);
  }

  console.log("创建 Release 并上传 asset...");
  const release = await api("POST", `/api/v1/repos/${GITEA_REPO}/releases`, {
    body: {
      tag_name: TAG,
      target_commitish: "main",
      name: TAG,
      body: notes,
      draft: false,
      prerelease: false,
    },
    // Gitea 对 JSON 请求体强制要求 Content-Type，缺省会返 422 "Unsupported Content-Type"
    contentType: "application/json",
  });

  for (const file of assets) {
    const name = path.basename(file);
    const buf = fs.readFileSync(file);
    await api("POST", `/api/v1/repos/${GITEA_REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      raw: buf,
      contentType: "application/octet-stream",
    });
    console.log(`  ✓ 已上传 ${name}（${buf.length.toLocaleString()} B）`);
  }

  // 匿名回读校验：latest 指向 + 资产齐全（OTA / quick-install.sh 走匿名读，私有仓库会 404）
  console.log("匿名回读校验...");
  try {
    const anon = await fetch(`${GITEA_BASE}/api/v1/repos/${GITEA_REPO}/releases/latest`, {
      headers: { Accept: "application/json", "User-Agent": "docker-manager-gitea-release" },
    });
    if (!anon.ok) {
      console.log(`  ⚠️ 匿名 releases/latest = HTTP ${anon.status} —— 仓库不可匿名读，OTA 会退化为只走 GitHub`);
    } else {
      const j = await anon.json();
      const names = (j.assets || []).map((a) => a.name);
      console.log(`  · 匿名 latest → ${j.tag_name}`);
      console.log(`  · 资产：${names.join(", ") || "(无)"}`);
      if (j.tag_name !== TAG) {
        console.log(`  ⚠️ latest 指向 ${j.tag_name} 而非本次发布的 ${TAG}（补历史版本时正常，最后须再发一次最新版本）`);
      }
    }
  } catch (e) {
    console.log(`  ⚠️ 匿名校验失败：${e?.message || e}`);
  }

  console.log(`✅ 已发布 ${TAG}（Gitea）`);
  console.log(`   网页：${GITEA_BASE}/${GITEA_REPO}/releases/tag/${TAG}`);
  console.log(`   匿名直链：${GITEA_BASE}/${GITEA_REPO}/releases/download/${TAG}/${encodeURIComponent(path.basename(zip))}`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
