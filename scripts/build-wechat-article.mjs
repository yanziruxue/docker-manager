/**
 * 微信公众号文章生成器（v1.50.36 配套，一次性工具）：
 * README.md → 公众号编辑器兼容的**内联样式富文本** → 自包含页 docs/wechat-article.html
 *（打开 → 点「一键复制全文」→ 公众号后台 Ctrl+V 粘贴，格式保留）。
 *
 * - 公众号不认 class / 外部 CSS，全部样式内联（15px 正文 / 标题左侧色条 / 表格浅灰边框）；
 * - 公众号不支持外链图片（SVG 也需转 PNG 手动上传）⇒ 图片转「顺序占位提示块」+ 文末图片清单；
 * - shields.io 徽章直接剔除；站内锚点链接退化为纯文本；外链保留文字并在括号内附 URL。
 *
 * 运行：node scripts/build-wechat-article.mjs（依赖 marked，--no-save 本地安装）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

/* ---------- ① 预处理 ---------- */
let md = readme
  // 剔除 shields.io 等外链徽章
  .replace(/^!\[[^\]]*\]\(https?:\/\/[^)]*\)\s*$/gm, "")
  // <img src="..."> 内嵌图 → markdown 图（统一走 renderer 占位）
  .replace(/<img\s+src="([^"]+)"[^>]*\/?>/g, '![页面配图]($1)')
  // 去 <div>/<p> 裸包裹行（居中徽章区等）
  .replace(/^<\/?(div|p|section)[^>]*>\s*$/gm, "");

/* ---------- ② 图片清单收集 ---------- */
const images = []; // { src, caption }
const imgCaption = (src) => {
  const name = path.basename(src, ".svg");
  const map = {
    banner: "文章封面 / 开头主视觉（鲸背集装箱 banner）",
    architecture: "技术架构图（浏览器 → 三通道 → SEA 二进制 → 引擎三态）",
    features: "八大模块功能总览",
    login: "登录页（品牌区 + banner 主视觉）",
    dashboard: "仪表盘（8 类实时曲线磁贴）",
    containers: "容器管理 + 容器详情页",
    stacks: "堆栈管理 + 编辑弹窗（COMPOSE/SETTINGS/LABELS）",
    images: "镜像管理",
    volumes: "数据卷管理",
    networks: "网络管理",
    notifications: "通知中心",
    settings: "设置中心（12 分区）",
  };
  return map[name] || name;
};

/* ---------- ③ 公众号内联样式 renderer ---------- */
const B = "margin:0;padding:0;"; // 基础 reset
const renderer = {
  heading({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    if (depth === 1) {
      return `<h1 style="${B}font-size:22px;font-weight:700;color:#111827;text-align:center;margin:28px 0 16px;line-height:1.4;">${text}</h1>`;
    }
    if (depth === 2) {
      return `<h2 style="${B}font-size:18px;font-weight:700;color:#111827;border-left:4px solid #2563EB;padding-left:10px;margin:30px 0 14px;line-height:1.4;">${text}</h2>`;
    }
    if (depth === 3) {
      return `<h3 style="${B}font-size:16px;font-weight:700;color:#1D4ED8;margin:22px 0 10px;line-height:1.4;">${text}</h3>`;
    }
    return `<h4 style="${B}font-size:15px;font-weight:700;color:#374151;margin:18px 0 8px;">${text}</h4>`;
  },
  paragraph({ tokens }) {
    const inner = this.parser.parseInline(tokens);
    if (!inner.trim()) return "";
    return `<p style="${B}font-size:15px;line-height:1.8;color:#3E3E3E;margin:10px 0;">${inner}</p>`;
  },
  blockquote({ tokens }) {
    const inner = this.parser.parse(tokens);
    return `<blockquote style="${B}margin:14px 0;padding:10px 14px;background:#F0F6FF;border-left:4px solid #93C5FD;border-radius:4px;font-size:14px;line-height:1.8;color:#4B5563;">${inner}</blockquote>`;
  },
  code({ text }) {
    const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre style="${B}margin:14px 0;padding:12px 14px;background:#F6F8FA;border:1px solid #E5E7EB;border-radius:6px;overflow-x:auto;"><code style="font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.6;color:#1F2937;white-space:pre;">${esc}</code></pre>`;
  },
  codespan({ text }) {
    const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<code style="font-family:Menlo,Consolas,monospace;font-size:13px;background:#F1F5F9;color:#C2410C;padding:1px 5px;border-radius:3px;">${esc}</code>`;
  },
  list({ items, ordered }) {
    const tag = ordered ? "ol" : "ul";
    const lis = items
      .map((it) => `<li style="${B}font-size:15px;line-height:1.8;color:#3E3E3E;margin:6px 0;">${this.parser.parse(it.tokens)}</li>`)
      .join("");
    return `<${tag} style="${B}margin:10px 0;padding-left:22px;">${lis}</${tag}>`;
  },
  table({ header, rows }) {
    const th = header
      .map((c) => `<th style="border:1px solid #DBEAFE;background:#EFF6FF;padding:7px 10px;font-size:13px;font-weight:700;color:#1E40AF;text-align:left;">${this.parser.parseInline(c.tokens)}</th>`)
      .join("");
    const trs = rows
      .map(
        (r) =>
          `<tr>${r.map((c) => `<td style="border:1px solid #E5E7EB;padding:7px 10px;font-size:13px;line-height:1.7;color:#3E3E3E;">${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`
      )
      .join("");
    return `<table style="border-collapse:collapse;width:100%;margin:14px 0;"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  },
  image({ href, text }) {
    if (/^https?:/i.test(href)) return ""; // 外链图（徽章）剔除
    const n = images.push({ src: href, caption: imgCaption(href) });
    return `<section style="${B}margin:16px 0;padding:18px 14px;background:#FFFBEB;border:1px dashed #F59E0B;border-radius:8px;font-size:14px;line-height:1.7;color:#92400E;text-align:center;">📷 <b>在此插入图片 ${n}</b><br/>${imgCaption(href)}<br/><span style="font-size:12px;color:#B45309;">（文件：${href}；公众号不支持 SVG，请用浏览器打开后截图成 PNG 上传）</span></section>`;
  },
  link({ href, tokens }) {
    const text = this.parser.parseInline(tokens);
    if (href.startsWith("#")) return text; // 站内锚点 → 纯文本
    if (/^https?:/i.test(href)) {
      return `<span style="color:#2563EB;font-weight:600;">${text}</span><span style="font-size:12px;color:#9CA3AF;">（${href}）</span>`;
    }
    return text;
  },
  hr() {
    return `<hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;"/>`;
  },
  strong({ tokens }) {
    return `<strong style="color:#111827;">${this.parser.parseInline(tokens)}</strong>`;
  },
};
marked.use({ renderer });

const html = marked.parse(md);

/* ---------- ④ 图片清单 ---------- */
const imageList = images
  .map((im, i) => `<li style="font-size:13px;color:#4B5563;line-height:1.8;">图 ${i + 1}：${im.caption} —— <code style="background:#F1F5F9;padding:1px 4px;border-radius:3px;font-size:12px;">${im.src}</code></li>`)
  .join("");

/* ---------- ⑤ 自包含页面 ---------- */
const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>微信公众号文章 · Docker Manager Yanzi（一键复制）</title>
</head>
<body style="margin:0;background:#EFEFEF;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;">
<div style="max-width:720px;margin:0 auto;padding:20px 14px 60px;">
  <div style="background:#1E293B;border-radius:12px;padding:20px 22px;color:#fff;margin-bottom:16px;">
    <div style="font-size:18px;font-weight:700;">📢 微信公众号发文助手</div>
    <div style="font-size:13px;color:#94A3B8;margin-top:6px;line-height:1.7;">
      ① 点下方按钮复制全文（富文本，格式保留） → ② 打开公众号后台「图文消息」新建图文 → ③ 编辑器内 Ctrl+V 粘贴 → ④ 按图片占位提示顺序上传配图（清单见文末）。
    </div>
    <button id="copyBtn" onclick="copyArticle()" style="margin-top:14px;width:100%;padding:13px 0;font-size:16px;font-weight:700;color:#fff;background:#2563EB;border:none;border-radius:8px;cursor:pointer;">📋 一键复制全文</button>
    <div id="tip" style="margin-top:10px;font-size:13px;color:#FCA5A5;text-align:center;min-height:18px;"></div>
  </div>

  <div id="article" style="background:#fff;border-radius:12px;padding:26px 22px;box-shadow:0 1px 4px rgba(0,0,0,.08);">${html}
    <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;"/>
    <h3 style="margin:0 0 8px;font-size:15px;color:#111827;">📎 配图清单（发帖时按序上传）</h3>
    <ul style="margin:0;padding-left:20px;">${imageList}</ul>
    <p style="font-size:12px;color:#9CA3AF;margin-top:10px;">提示：SVG 文件用浏览器打开后截图（或 Edge 无头 --screenshot）转 PNG；封面建议用 banner 图 2.35:1 裁剪。</p>
  </div>
</div>
<script>
async function copyArticle() {
  var tip = document.getElementById('tip');
  var btn = document.getElementById('copyBtn');
  var art = document.getElementById('article');
  var htmlStr = art.innerHTML;
  var textStr = art.innerText;
  function ok(msg) { tip.style.color = '#4ADE80'; tip.textContent = msg; btn.textContent = '✅ 已复制，去公众号粘贴吧'; setTimeout(function(){ btn.textContent = '📋 一键复制全文'; }, 4000); }
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([htmlStr], { type: 'text/html' }),
        'text/plain': new Blob([textStr], { type: 'text/plain' })
      })]);
      ok('✅ 已复制富文本！去公众号后台编辑器 Ctrl+V 粘贴');
      return;
    }
    throw new Error('no clipboard api');
  } catch (e) {
    try {
      var range = document.createRange();
      range.selectNodeContents(art);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var ok2 = document.execCommand('copy');
      sel.removeAllRanges();
      if (ok2) { ok('✅ 已复制（兼容模式）'); return; }
      throw new Error('execCommand failed');
    } catch (e2) {
      tip.style.color = '#FCA5A5';
      tip.textContent = '复制失败：请手动全选正文区域后 Ctrl+C';
    }
  }
}
</script>
</body>
</html>`;

const out = path.join(ROOT, "docs", "wechat-article.html");
fs.writeFileSync(out, page, "utf8");
console.log(`生成 ${out}`);
console.log(`图片占位 ${images.length} 张、正文 ${page.length} 字符`);
