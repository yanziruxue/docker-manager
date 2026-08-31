/**
 * ============================================
 * 二进制打包脚本
 * 将前端 dist/ 嵌入服务端，用 esbuild 打包成单文件 JS
 * 输出到 deploy/linux/bundle.js
 *
 * 用法：npm run build:linux
 * 输出到 deploy/linux/bundle.js
 * ============================================
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// 应用版本号：与 package.json 保持单一数据源，构建期注入前端
const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;
const DIST_DIR = path.join(ROOT, "dist");
const DEPLOY_LINUX = path.join(ROOT, "deploy", "linux");
const OUTPUT = path.join(DEPLOY_LINUX, "bundle.js");

// ---------- 1. 读取 dist/ 下所有文件，转 base64 ----------
function readDistFiles() {
  const files = {};
  const mimeMap = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".mjs":  "application/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".ico":  "image/x-icon",
    ".woff": "font/woff",
    ".woff2":"font/woff2",
    ".json": "application/json; charset=utf-8",
    ".txt":  "text/plain; charset=utf-8",
  };

  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const key = prefix + entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, key + "/");
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const mime = mimeMap[ext] || "application/octet-stream";
        files[key] = {
          data: fs.readFileSync(full).toString("base64"),
          mime,
        };
      }
    }
  }

  if (!fs.existsSync(DIST_DIR)) {
    console.error("❌ dist/ 目录不存在，请先运行 npm run build:frontend");
    process.exit(1);
  }

  walk(DIST_DIR, "");
  return files;
}

// ---------- 2. esbuild 虚拟模块插件 ----------
function embeddedDistPlugin(embedded) {
  return {
    name: "embedded-dist",
    setup(build) {
      // 拦截 virtual:embedded-dist 导入
      build.onResolve({ filter: /^virtual:embedded-dist$/ }, (args) => ({
        path: "virtual:embedded-dist",
        namespace: "embedded-dist",
      }));

      build.onLoad({ filter: /.*/, namespace: "embedded-dist" }, () => ({
        contents: `export default ${JSON.stringify(embedded)};`,
        loader: "js",
        resolveDir: ROOT,
      }));
    },
  };
}

// ---------- 3. 打包 ----------
async function build() {
  const embedded = readDistFiles();
  console.log(`📦 已读取 ${Object.keys(embedded).length} 个前端文件`);

  fs.mkdirSync(DEPLOY_LINUX, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(ROOT, "server", "index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: OUTPUT,
    minify: false,
    // 原生模块标为外部（仅 SSH 模式需要，二进制中不可用）
    // 二进制模式支持 socket 和 TCP，SSH 需用传统部署
    external: ["cpu-features"],
    mainFields: ["module", "main"],
    plugins: [embeddedDistPlugin(embedded)],
    banner: {
      js: [
        `// Docker Stack Manager - Linux Binary Build`,
        `// Build time: ${new Date().toISOString()}`,
        `// Embedded frontend files: ${Object.keys(embedded).length}`,
        `const __SEA_URL__ = require("node:url").pathToFileURL(process.execPath).href;`,
        ``,
      ].join("\n"),
    },
    // CJS 模式下替换 ESM 特有语法 + 二进制构建标志
    // SEA 中 __filename/__dirname 不可用，用 process.execPath 生成 file URL
    // 应用版本号构建期注入：SEA 二进制内没有 package.json，运行时读取不可靠
    define: {
      "import.meta.url": "__SEA_URL__",
      "BUILD_BINARY": "true",
      "__APP_VERSION__": JSON.stringify(appVersion),
    },
  });

  const sizeMB = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2);
  console.log(`✅ 打包完成 → ${OUTPUT} (${sizeMB} MB)`);
  console.log("");
  console.log("━━━ 部署流程 ━━━");
  console.log("  1. 将 deploy/linux/ 复制到 Linux 服务器");
  console.log("  2. bash build.sh             # 构建 SEA 二进制");
  console.log("  3. sudo bash install.sh      # 安装并启动服务");
  console.log("");
  console.log("  或 Windows 上双击运行 deploy\\linux\\build-bundle.cmd");
}

build().catch((err) => {
  console.error("❌ 打包失败:", err);
  process.exit(1);
});
