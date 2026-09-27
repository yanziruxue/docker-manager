#!/usr/bin/env node
/**
 * 一键发布到 GitHub Releases：构建 zip 后自动创建/更新 Release 并上传 asset
 *
 * 前置：
 *   - 已安装 GitHub CLI (gh)
 *   - 凭据（二选一）：
 *       a. 环境变量 GITHUB_TOKEN（或 GH_TOKEN）—— 推荐，无需 gh auth login
 *          （读私有仓库只需 repo scope；gh auth login 强制要求 read:org，PAT 常缺该 scope）
 *       b. gh auth login 已登录
 *       c. 项目根目录 .env 文件写 GITHUB_TOKEN=xxx（脚本自动加载，不进代码/交付包）
 *   - 已构建交付包 build-upload/docker-manager-yanzi-linux-x64.zip
 *
 * 用法：
 *   node scripts/publish-release.mjs [--repo owner/repo] [--zip 路径] [--prerelease] [--draft]
 *   GITHUB_TOKEN=xxx npm run release
 *
 * 多版本合并发布（一次 Release 承载多个未发布的开发版本时必用）：
 *   node scripts/publish-release.mjs --merge-from v1.25.0 --intro-file <升级须知.md> [--dry-run]
 *     --merge-from <vX.Y.Z>  合并 CHANGELOG 中 [vX.Y.Z, 当前版本] 的全部版本段为一份 notes
 *                            （历史版本会自动去掉「### 交付包」小节 —— 那些包已作废，
 *                             SHA 留在 notes 里只会误导用户）
 *     --intro-file <path>    notes 最前面的提示块（升级须知 / 本包资产摘要等）
 *     --notes-file <path>    直接指定完整 notes（优先级最高，覆盖 --merge-from）
 *     --dry-run              只把 notes 写到 build-upload/.notes-dryrun-<ver>.md 供人工过目，
 *                            **不创建/不修改 Release、不上传 asset**
 *     --via-api              强制走 GitHub REST API（默认 gh 优先、不可用时自动回退 REST）
 *
 * 行为：
 *   1. 读 package.json version → TAG = vX.Y.Z
 *   2. notes 来源：--notes-file > --merge-from（合并） > CHANGELOG 单段
 *   3. 通道：gh CLI 优先；**gh 不存在或无法启动时自动回退 REST API**
 *      （本机 Windows 受限环境实测 node 的 child_process 会 EBUSY，故 REST 通道是必要能力）
 *   4. Release 已存在 → 覆盖上传 asset（gh: --clobber / REST: 先删同名再传）**并同步覆盖 notes**
 *      否则 → 创建 Release（非 draft / 非 prerelease，除非显式指定）并上传 asset
 *
 * 安全：token 仅来自环境变量或 .env（本地运行时文件），脚本内不出现任何明文 token；
 *       若后续初始化 git，务必把 .env 加入 .gitignore，切勿提交。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf-8",
    stdio: opts.silent ? "pipe" : "inherit",
    ...opts,
  });
}

// 探测 gh 可执行路径：先 PATH，再 Windows 常见安装位置
function resolveGh() {
  try {
    run("gh", ["--version"], { silent: true });
    return "gh";
  } catch {}
  const candidates = [
    "C:\\Program Files\\GitHub CLI\\gh.exe",
    "C:/Program Files/GitHub CLI/gh.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "github-cli", "gh.exe"),
    "C:\\Program Files (x86)\\GitHub CLI\\gh.exe",
    "/usr/bin/gh",
    "/usr/local/bin/gh",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        run(c, ["--version"], { silent: true });
        return c;
      }
    } catch {}
  }
  return null;
}

// 加载项目根 .env（若存在），仅补充尚未设置的环境变量
function loadDotEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return;
  const text = fs.readFileSync(f, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}

function parseArgs(argv) {
  const a = {
    repo: "",
    zip: "",
    prerelease: false,
    draft: false,
    mergeFrom: "",
    introFile: "",
    notesFile: "",
    dryRun: false,
    viaApi: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo") a.repo = argv[++i];
    else if (argv[i] === "--zip") a.zip = argv[++i];
    else if (argv[i] === "--prerelease") a.prerelease = true;
    else if (argv[i] === "--draft") a.draft = true;
    else if (argv[i] === "--merge-from") a.mergeFrom = argv[++i];
    else if (argv[i] === "--intro-file") a.introFile = argv[++i];
    else if (argv[i] === "--notes-file") a.notesFile = argv[++i];
    else if (argv[i] === "--dry-run") a.dryRun = true;
    else if (argv[i] === "--via-api") a.viaApi = true;
  }
  return a;
}

// 默认仓库：优先读 settings.json 的 update.repo，否则回退常量
function defaultRepo() {
  for (const p of [
    path.join(ROOT, "data", "config", "settings.json"),
    path.join(ROOT, "settings.json"),
  ]) {
    try {
      const s = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (s?.update?.repo) return s.update.repo;
    } catch {}
  }
  return "yanziruxue/docker-manager";
}

// 从 CHANGELOG 提取 ## vX.Y.Z 到下一个 ## 之间的内容
function extractChangelog(tag) {
  const file = path.join(ROOT, "docs", "CHANGELOG.md");
  if (!fs.existsSync(file)) return "";
  const md = fs.readFileSync(file, "utf-8");
  const escaped = tag.replace(/\./g, "\\.");
  const re = new RegExp("## " + escaped + "[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

// ---------- 多版本合并（一个 Release 承载多个开发版本时用 --merge-from） ----------

/** 把 CHANGELOG 拆成 [{ver, heading, body[]}]，顺序与文档一致（新 → 旧） */
function splitSections(md) {
  const out = [];
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^## (v\d+\.\d+\.\d+)(.*)$/);
    if (m) {
      if (cur) out.push(cur);
      cur = { ver: m[1], heading: line.slice(3).trim(), body: [] };
      continue;
    }
    if (cur) cur.body.push(line);
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 去掉段落里的「### 交付包…」小节。
 * 用于**被合并进来的历史版本**：它们的包早已作废，SHA 列在 Release 里只会误导用户。
 */
function stripDeliverySection(bodyLines) {
  const out = [];
  let skipping = false;
  for (const line of bodyLines) {
    if (/^###\s/.test(line)) skipping = /^###\s*交付包/.test(line);
    if (!skipping) out.push(line);
  }
  return out;
}

/** 标题里的「未发布」在 Release notes 语境下没意义，去掉；⚠️ 只摘这一个词，保留「已被 X 取代 / 勿部署」等警示 */
function cleanHeading(heading) {
  return heading
    .replace(/（\s*未发布\s*·\s*/g, "（")
    .replace(/（\s*未发布\s*）/g, "")
    .replace(/\s+—\s+$/, "")
    .trim();
}

/**
 * 合并 [fromTag, toTag] 的**全部**版本段（含两端）为一份 notes。
 * @param {string} toTag 当前版本（如 v1.31.1）
 * @param {string} fromTag 起始版本（如 v1.25.0）；找不到则退化为单段
 * @param {string} intro 置于最前的提示块（升级须知等）
 */
function buildMergedNotes(toTag, fromTag, intro) {
  const md = fs.readFileSync(path.join(ROOT, "docs", "CHANGELOG.md"), "utf-8");
  const secs = splitSections(md);
  const toIdx = secs.findIndex((s) => s.ver === toTag);
  if (toIdx < 0) return "";
  let endIdx = toIdx;
  if (fromTag) {
    const i = secs.findIndex((s) => s.ver === fromTag);
    if (i >= 0) endIdx = i; // 文档新→旧 ⇒ 起始版本在下标更大处
  }
  const picked = secs.slice(toIdx, endIdx + 1);
  const parts = [];
  if (intro && intro.trim()) parts.push(intro.trim());
  parts.push(
    `> 本 Release 合并 **${picked[picked.length - 1].ver} → ${picked[0].ver}** 共 ${picked.length} 个开发版本的全部内容。`
  );
  for (const s of picked) {
    // 历史版本去掉「交付包」小节（包已作废），当前版本保留
    const body = s.ver === toTag ? s.body : stripDeliverySection(s.body);
    parts.push(`---\n\n## ${cleanHeading(s.heading)}\n\n${body.join("\n").trim()}`);
  }
  return parts.join("\n\n");
}

// ---------- 通道 B：GitHub REST API（无需 gh，直接 fetch） ----------

const GITHUB_API = "https://api.github.com";

function authToken() {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!t) throw new Error("[ERROR] 走 REST API 必须提供 GITHUB_TOKEN（环境变量或 .env）");
  return t;
}

async function apiFetch(method, p, { body, raw, contentType } = {}) {
  const res = await fetch(p.startsWith("http") ? p : GITHUB_API + p, {
    method,
    headers: {
      Authorization: `Bearer ${authToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "docker-manager-release",
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[API ${method} ${p}] -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * 用 REST API 创建/更新 Release 并上传资产。
 * tag 不存在时 GitHub 会按默认分支 HEAD 自动建 tag（与 gh release create 行为一致）。
 * ⚠️ REST 不允许同名资产重复上传 ⇒ 已存在时先 DELETE 再传（等价于 gh 的 --clobber）。
 */
async function publishViaRest({ repo, TAG, notes, assets, prerelease, draft }) {
  let release = null;
  try {
    release = await apiFetch("GET", `/repos/${repo}/releases/tags/${TAG}`);
  } catch {
    release = null;
  }

  if (release) {
    console.log(`Release ${TAG} 已存在（id=${release.id}），更新 notes 并覆盖 asset...`);
    release = await apiFetch("PATCH", `/repos/${repo}/releases/${release.id}`, {
      body: { body: notes, draft: !!draft, prerelease: !!prerelease },
    });
  } else {
    console.log(`创建 Release ${TAG} 并上传 asset...`);
    release = await apiFetch("POST", `/repos/${repo}/releases`, {
      body: {
        tag_name: TAG,
        name: TAG,
        body: notes,
        draft: !!draft,
        prerelease: !!prerelease,
      },
    });
  }

  const existing = new Map((release.assets || []).map((a) => [a.name, a]));
  const uploadBase = release.upload_url.replace(/\{\?[^}]*\}$/, "");
  for (const file of assets) {
    const name = path.basename(file);
    const prev = existing.get(name);
    if (prev) await apiFetch("DELETE", `/repos/${repo}/releases/assets/${prev.id}`);
    const buf = fs.readFileSync(file);
    await apiFetch("POST", `${uploadBase}?name=${encodeURIComponent(name)}`, {
      raw: buf,
      contentType: "application/octet-stream",
    });
    console.log(`  ✓ 已上传 ${name}（${buf.length.toLocaleString()} B）`);
  }
  console.log(`✅ 已发布 ${TAG}（REST API）`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  const version = pkg.version;
  const TAG = "v" + version;
  const repo = args.repo || defaultRepo();
  const zip =
    args.zip || path.join(ROOT, "build-upload", `docker-manager-yanzi-linux-x64-v${version}.zip`);
  // 一键安装脚本作为 Release 附加资源，使「curl ... | sudo bash」可直接拉取
  const scriptAsset = path.join(ROOT, "scripts", "quick-install.sh");

  // 同时发布一个不带版本号的「latest」别名资产，使
  // `releases/latest/download/docker-manager-yanzi-linux-x64.zip` 稳定指向最新版本
  // （quick-install.sh 直链、手动下载均可用）。内容与版本化包完全一致。
  const aliasZip = path.join(ROOT, "build-upload", "docker-manager-yanzi-linux-x64.zip");
  fs.copyFileSync(zip, aliasZip);

  const assets = [zip, aliasZip];
  if (fs.existsSync(scriptAsset)) assets.push(scriptAsset);

  if (!fs.existsSync(zip)) {
    console.error(
      `[ERROR] 未找到交付包: ${zip}\n请先构建：\n  npm run build:frontend && node scripts/build-binary.mjs\n  cd deploy/linux && python make-package.py && cp *.zip ../build-upload/`
    );
    process.exit(1);
  }

  // 凭据：加载项目根 .env（若存在），仅补充尚未设置的环境变量
  loadDotEnv();
  const hasToken = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);

  console.log(`发布目标: ${repo} @ ${TAG}`);

  // Release notes：优先级 --notes-file > --merge-from（多版本合并）> CHANGELOG 单段
  // ⚠️ 放在凭据/通道判定之前：--dry-run 只生成 notes，不该因为「本机没有 gh」而失败
  const intro = args.introFile ? fs.readFileSync(args.introFile, "utf-8") : "";
  const notes = args.notesFile
    ? fs.readFileSync(args.notesFile, "utf-8")
    : args.mergeFrom
      ? buildMergedNotes(TAG, args.mergeFrom, intro)
      : extractChangelog(TAG) || `Release ${TAG}`;
  console.log(
    `notes: ${notes.split("\n").length} 行 / ${notes.length} 字符` +
      (args.mergeFrom ? `（合并 ${args.mergeFrom} → ${TAG}）` : "")
  );
  if (args.dryRun) {
    const preview = path.join(ROOT, "build-upload", `.notes-dryrun-${version}.md`);
    fs.writeFileSync(preview, notes);
    console.log(`[dry-run] notes 预览已写出：${preview}`);
    console.log("[dry-run] 未创建/未修改任何 Release，也未上传 asset");
    return;
  }

  // 统一写一份 notes 文件：gh 与 REST 两条通道、创建与「已存在时更新」两条路径共用
  const notesFile = path.join(ROOT, "build-upload", `.notes-${version}.md`);
  fs.writeFileSync(notesFile, notes);

  // 发布通道：gh CLI 优先；不可用时回退 GitHub REST API（--via-api 可强制走 REST）
  // ⚠️ 本机（Windows 受限环境）实测 node 的 `child_process` 会以 **EBUSY** 失败 —— 连 `cmd.exe`
  //    都 spawn 不了（两版 node、关闭沙箱均如此）⇒ 脚本必须能脱离 gh 工作，否则完全没法发布。
  let gh = null;
  if (!args.viaApi) {
    const found = resolveGh();
    if (found) {
      try {
        run(found, ["--version"], { silent: true });
        gh = found;
      } catch {
        gh = null;
      }
    }
  }
  if (!gh && !hasToken) {
    console.error(
      "[ERROR] 既没有可用的 gh，也没有 token。请任选其一：\n" +
        "  1) 环境变量：GITHUB_TOKEN=xxx npm run release\n" +
        "  2) 项目根 .env 写：GITHUB_TOKEN=xxx\n" +
        "  3) 安装可用并登录的 gh：https://cli.github.com"
    );
    process.exit(1);
  }
  console.log(
    gh
      ? `发布通道: gh CLI（${gh}）${hasToken ? "  凭据: 环境变量/.env" : "  凭据: gh 登录态"}`
      : "发布通道: GitHub REST API（未找到可用 gh 或 gh 无法启动 ⇒ 自动回退；--via-api 可强制）"
  );

  if (gh) {
    // ---------------- 通道 A：gh CLI ----------------
    let exists = false;
    try {
      run(gh, ["release", "view", TAG, "--repo", repo], { silent: true });
      exists = true;
    } catch {
      exists = false;
    }

    if (exists) {
      console.log(`Release ${TAG} 已存在，覆盖上传 asset 并更新 notes...`);
      run(gh, ["release", "upload", TAG, ...assets, "--repo", repo, "--clobber"]);
      // 覆盖 notes：只上传 asset 不更新 notes 时，重发会留下过期说明（含作废包 SHA）
      run(gh, ["release", "edit", TAG, "--repo", repo, "--notes-file", notesFile]);
      console.log(`✅ 已更新 ${TAG} 的 asset（${assets.length} 个文件）与 notes`);
    } else {
      console.log(`创建 Release ${TAG} 并上传 asset...`);
      const createArgs = [
        "release",
        "create",
        TAG,
        ...assets,
        "--repo",
        repo,
        "--title",
        TAG,
        "--notes-file",
        notesFile,
      ];
      if (args.prerelease) createArgs.push("--prerelease");
      if (args.draft) createArgs.push("--draft");
      run(gh, createArgs);
      console.log(`✅ 已发布 ${TAG}`);
    }
  } else {
    // ---------------- 通道 B：REST API ----------------
    await publishViaRest({
      repo,
      TAG,
      notes,
      assets,
      prerelease: args.prerelease,
      draft: args.draft,
    });
  }

  // 临时 notes 文件清理：safe-delete 可能拦截 unlinkSync 且 trash 在本环境失败，
  // 残留文件已被 .gitignore 忽略，故吞掉错误，避免误判发布失败。
  try {
    fs.rmSync(notesFile, { force: true });
  } catch {}

  console.log(
    `\n下一步：应用内「系统更新」点检查更新即可发现 ${TAG}（仓库已固定写死为 ${repo}）`
  );
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
