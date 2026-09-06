#!/usr/bin/env node
/**
 * 通过 GitHub Git Database API 推送源码到仓库的 main 分支。
 *
 * 适用场景：本机到 github.com:443 的 git smart-HTTP 被网络拦截（无法 git fetch/push），
 * 但 api.github.com 可达。本脚本只调用 REST API（blobs → tree → commit → 更新 ref），
 * 因此不受 git 端口限制影响。
 *
 * 安全：token 仅来自环境变量 GITHUB_TOKEN / GH_TOKEN，不在脚本内硬编码。
 *
 * 用法：
 *   GITHUB_TOKEN=xxx node scripts/push-via-api.mjs [--repo owner/repo] [--msg "commit message"]
 *
 * 行为：
 *   1. 读取远端 main 当前 commit（作为父提交，保证 fast-forward）
 *   2. git ls-files --others --exclude-standard 枚举待提交文件（遵循 .gitignore）
 *   3. 逐个上传 blob（base64）
 *   4. 以远端 tree 为 base_tree 创建新 tree（远端独有文件自动保留）
 *   5. 创建 commit 并 PATCH refs/heads/main
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const a = { repo: process.env.GH_REPO || "yanziruxue/docker-manager", msg: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo") a.repo = argv[++i];
    else if (argv[i] === "--msg") a.msg = argv[++i];
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("[ERROR] 需要环境变量 GITHUB_TOKEN（或 GH_TOKEN）");
  process.exit(1);
}

const API = "https://api.github.com";
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "docker-manager-push",
};

async function api(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[API ${method} ${p}] -> ${res.status}: ${text.slice(0, 600)}`);
    throw new Error("api failed");
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const repo = args.repo;
  console.log(`目标仓库: ${repo}`);

  // 1. 远端 main 当前 commit
  const ref = await api("GET", `/repos/${repo}/git/refs/heads/main`);
  const baseSha = ref.object.sha;
  const baseCommit = await api("GET", `/repos/${repo}/git/commits/${baseSha}`);
  const baseTree = baseCommit.tree.sha;
  console.log(`基线 commit: ${baseSha}`);

  // 2. 枚举本地待提交文件（遵循 .gitignore）
  const files = execSync("git -c core.quotePath=false ls-files --others --exclude-standard", {
    cwd: ROOT,
    encoding: "utf-8",
  })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (files.length === 0) {
    console.log("没有需要提交的文件");
    return;
  }
  console.log(`待上传文件: ${files.length}`);

  // 3. 上传 blob
  const treeEntries = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(ROOT, f));
    const content = buf.toString("base64");
    const r = await api("POST", `/repos/${repo}/git/blobs`, {
      content,
      encoding: "base64",
    });
    treeEntries.push({ path: f, mode: "100644", type: "blob", sha: r.sha });
    process.stdout.write(".");
  }
  console.log("");

  // 4. 创建 tree（base_tree 自动保留远端独有文件）
  const tree = await api("POST", `/repos/${repo}/git/trees`, {
    base_tree: baseTree,
    tree: treeEntries,
  });

  // 5. 创建 commit
  const msg =
    args.msg ||
    `chore: sync source (v1.6.0) — README, quick-install.sh, daemon-config`;
  const commit = await api("POST", `/repos/${repo}/git/commits`, {
    message: msg,
    tree: tree.sha,
    parents: [baseSha],
  });

  // 6. 更新 main
  await api("PATCH", `/repos/${repo}/git/refs/heads/main`, { sha: commit.sha });
  console.log(`✅ 已推送到 ${repo}@main: ${commit.sha}`);
  console.log(`   Code: https://github.com/${repo}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
