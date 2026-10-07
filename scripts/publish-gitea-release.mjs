#!/usr/bin/env node
/**
 * 一键发布到自建 Gitea Releases（yanzi/docker-manager-yanzi）。
 *
 * 前置：
 *   - 仓库必须可匿名读（owner 账号 visibility=public；否则 OTA / quick-install.sh 的
 *     Gitea 分支会 404 并退化为只走 GitHub）—— 见 MEMORY「Gitea 仓库必须可匿名读」。
 *   - 令牌按 host 存于 wincred（协议 https、host git.ziruxue.top）；脚本自动用
 *     `git credential fill` 取出，无需手动传。也可显式 `GITEA_TOKEN=xxx` 覆盖。
 *
 * 用法：
 *   node scripts/publish-gitea-release.mjs
 *   GITEA_TOKEN=xxx node scripts/publish-gitea-release.mjs
 *
 * 行为：
 *   1. 读 package.json version → TAG = vX.Y.Z
 *   2. notes 取自 docs/CHANGELOG.md 中 ## vX.Y.Z 段落（与 GitHub 发布保持一致）
 *   3. 资产：版本化 zip + 无版本 latest 别名 zip（同字节）+ quick-install.sh
 *   4. Release 已存在 → 删除后重建（保证 asset 与 notes 干净）；否则直接创建
 *   5. 上传 3 个资产；直链前缀 /{owner}/{repo}/releases/download/{tag}/{name}
 *
 * 安全：token 仅来自 wincred / 环境变量，脚本内不出现明文。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const GITEA_BASE = (process.env.UPDATE_GITEA_BASE || "https://git.ziruxue.top").replace(/\/$/, "");
const GITEA_REPO = process.env.UPDATE_GITEA_REPO || "yanzi/docker-manager-yanzi";

// ---------- 取令牌 ----------
function getToken() {
  if (process.env.GITEA_TOKEN) return process.env.GITEA_TOKEN;
  try {
    const out = execFileSync(
      "git",
      ["credential", "fill"],
      { input: "protocol=https\nhost=git.ziruxue.top\n\n", encoding: "utf-8" }
    );
    const m = out.match(/^password=(.*)$/m);
    if (m) return m[1].trim();
  } catch (e) {
    console.error("[WARN] 无法从 wincred 取 Gitea 令牌：" + (e?.message || e));
  }
  throw new Error("[ERROR] 需要 Gitea 令牌：设置 GITEA_TOKEN 环境变量，或先 `git credential approve` git.ziruxue.top");
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

async function api(method, p, { body, raw, contentType } = {}) {
  const res = await fetch(GITEA_BASE + p, {
    method,
    headers: {
      Authorization: `token ${TOKEN}`,
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

const TOKEN = getToken();

async function main() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;
  const TAG = "v" + version;
  const [owner, repo] = GITEA_REPO.split("/");
  const notes = extractChangelog(TAG) || `Release ${TAG}`;

  const zip = path.join(ROOT, "build-upload", `docker-manager-yanzi-linux-x64-v${version}.zip`);
  const aliasZip = path.join(ROOT, "build-upload", "docker-manager-yanzi-linux-x64.zip");
  fs.copyFileSync(zip, aliasZip);
  const scriptAsset = path.join(ROOT, "scripts", "quick-install.sh");
  const assets = [zip, aliasZip, scriptAsset].filter((f) => fs.existsSync(f));

  if (!fs.existsSync(zip)) {
    console.error(`[ERROR] 未找到交付包: ${zip}`);
    process.exit(1);
  }

  console.log(`发布目标: ${GITEA_REPO} @ ${TAG}（${GITEA_BASE}）`);

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
    tag_name: TAG,
    target_commitish: "main",
    name: TAG,
    body: notes,
    draft: false,
    prerelease: false,
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

  console.log(`✅ 已发布 ${TAG}（Gitea）`);
  console.log(`   网页：${GITEA_BASE}/${GITEA_REPO}/releases/tag/${TAG}`);
  console.log(`   匿名 latest 直链应可达：${GITEA_BASE}/${GITEA_REPO}/releases/download/${TAG}/${encodeURIComponent(path.basename(zip))}`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
