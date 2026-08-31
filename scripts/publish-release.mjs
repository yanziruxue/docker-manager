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
 * 行为：
 *   1. 读 package.json version → TAG = vX.Y.Z
 *   2. 从 docs/CHANGELOG.md 提取对应版本段作为 Release notes
 *   3. Release 已存在 → 覆盖上传 asset（--clobber）
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
  const a = { repo: "", zip: "", prerelease: false, draft: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo") a.repo = argv[++i];
    else if (argv[i] === "--zip") a.zip = argv[++i];
    else if (argv[i] === "--prerelease") a.prerelease = true;
    else if (argv[i] === "--draft") a.draft = true;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  const version = pkg.version;
  const TAG = "v" + version;
  const repo = args.repo || defaultRepo();
  const zip =
    args.zip || path.join(ROOT, "build-upload", "docker-manager-yanzi-linux-x64.zip");
  // 一键安装脚本作为 Release 附加资源，使「curl ... | sudo bash」可直接拉取
  const scriptAsset = path.join(ROOT, "scripts", "quick-install.sh");
  const assets = [zip];
  if (fs.existsSync(scriptAsset)) assets.push(scriptAsset);

  if (!fs.existsSync(zip)) {
    console.error(
      `[ERROR] 未找到交付包: ${zip}\n请先构建：\n  npm run build:frontend && node scripts/build-binary.mjs\n  cd deploy/linux && python make-package.py && cp *.zip ../build-upload/`
    );
    process.exit(1);
  }

  // 凭据：加载 .env → 检查 GITHUB_TOKEN/GH_TOKEN → 否则要求 gh auth login
  loadDotEnv();
  const gh = resolveGh();
  if (!gh) {
    console.error("[ERROR] 未找到 GitHub CLI (gh)。请先安装：https://cli.github.com");
    process.exit(1);
  }
  const hasToken = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  if (!hasToken) {
    try {
      run(gh, ["auth", "status"], { silent: true });
    } catch {
      console.error(
        "[ERROR] 未提供 GitHub 凭据。请任选其一：\n" +
          "  1) 环境变量：GITHUB_TOKEN=xxx npm run release\n" +
          "  2) 项目根 .env 写：GITHUB_TOKEN=xxx\n" +
          "  3) 先登录：gh auth login  （注意 PAT 需含 read:org scope）"
      );
      process.exit(1);
    }
  }

  console.log(`发布目标: ${repo} @ ${TAG}`);
  console.log(`使用 gh: ${gh}${hasToken ? "  (凭据: 环境变量/GITHUB_TOKEN)" : "  (凭据: gh 登录态)"}`);

  // Release 是否已存在
  let exists = false;
  try {
    run(gh, ["release", "view", TAG, "--repo", repo], { silent: true });
    exists = true;
  } catch {
    exists = false;
  }

  if (exists) {
    console.log(`Release ${TAG} 已存在，覆盖上传 asset...`);
    run(gh, ["release", "upload", TAG, ...assets, "--repo", repo, "--clobber"]);
    console.log(`✅ 已更新 ${TAG} 的 asset（${assets.length} 个文件）`);
  } else {
    console.log(`创建 Release ${TAG} 并上传 asset...`);
    const notes = extractChangelog(TAG) || `Release ${TAG}`;
    const notesFile = path.join(ROOT, "build-upload", `.notes-${version}.md`);
    fs.writeFileSync(notesFile, notes);
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
    // 临时 notes 文件清理：safe-delete 可能拦截 unlinkSync 且 trash 在本环境失败，
    // 残留文件已被 .gitignore 忽略，故吞掉错误，避免误判发布失败。
    try {
      fs.rmSync(notesFile, { force: true });
    } catch {}
    console.log(`✅ 已发布 ${TAG}`);
  }

  console.log(
    `\n下一步：应用内「系统更新」点检查更新即可发现 ${TAG}（仓库已固定写死为 ${repo}）`
  );
}

main();
