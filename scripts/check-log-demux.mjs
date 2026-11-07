/**
 * Docker 日志 8 字节 multiplex header demux 门禁（v1.50.30）。
 *
 * 用**真实 Buffer** 跑 server/log-demux.ts 编译后的函数，断言：
 *   ① stdout / stderr 多帧正文按序拼接，时间戳前缀完整；
 *   ② 帧头控制字节与非法 UTF-8 字节（如 0x8A）不产生控制字符 / U+FFFD「方框问号」；
 *   ③ TTY=true 的 raw stream 原样返回，绝不误砍正文前 8 字节；
 *   ④ 尾部半帧丢弃，不留垃圾；
 *   ⑤ 中文 / emoji payload 逐帧独立解码不破损；
 *   ⑥ 源码接线：服务端不再直出 toString、弹窗改用只读终端。
 *
 * 运行：node scripts/check-log-demux.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  PASS  ${name}  →  ${a.length > 110 ? a.slice(0, 110) + "…" : a}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  期望 ${e.slice(0, 160)}  实际 ${a.slice(0, 160)}`);
  }
}
function ok(name, cond) {
  check(name, !!cond, true);
}

/* ---------- 编译真实实现（无临时文件，data URL 直接 import） ---------- */
const built = await esbuild.build({
  entryPoints: [path.join(ROOT, "server", "log-demux.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node20",
});
const code = built.outputFiles[0].text;
const { demuxDockerLogStream } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);

/** 构造一条真实的 Docker 日志帧：[type, 0, 0, 0, size(4, BE)] + payload */
function frame(type, payload) {
  const body = Buffer.from(payload, "utf-8");
  const head = Buffer.alloc(8);
  head[0] = type;
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

const LN_A = "2026-11-06T04:34:46.002289305Z [GIN-debug] POST /api/scheduled-tasks/:id/run --> handler (7 handlers)\n";
const LN_B = "2026-11-06T04:34:46.002290976Z [GIN] 200 |  12ms |  127.0.0.1 | GET /health\n";

console.log("══ ① 多帧正文拼接 ══");
const twoFrames = demuxDockerLogStream(Buffer.concat([frame(1, LN_A), frame(2, LN_B)]));
check("stdout + stderr 两帧按序拼接", twoFrames, LN_A + LN_B);
ok("时间戳前缀完整（未被 substring(8) 砍掉）", twoFrames.startsWith("2026-11-06T04:34:46.002289305Z"));

console.log("══ ② 行首豆腐块来源已被剥离 ══");
ok("输出无 C0 控制字符（0x00–0x08）", !/[\u0000-\u0008]/.test(twoFrames));
ok("输出无 U+FFFD 替换字符", !twoFrames.includes("\uFFFD"));
ok("输出无 U+0001（stdout 帧头标志）", !twoFrames.includes("\u0001"));
// payload 长度 138 ⇒ 帧头第 8 字节为 0x8A（非法 UTF-8），未 demux 时必产生 U+FFFD
const withBadByte = demuxDockerLogStream(frame(1, "x".repeat(138)));
ok("帧头含 0x8A 也不产生 U+FFFD", !withBadByte.includes("\uFFFD"));
check("含 0x8A 帧的正文长度正确", withBadByte.length, 138);

console.log("══ ③ TTY raw stream 兼容 ══");
const ttyRaw = "hello tty\nsecond line\n";
check("TTY 无帧头时原样返回（不误砍前 8 字节）", demuxDockerLogStream(Buffer.from(ttyRaw, "utf-8")), ttyRaw);
const ttyCn = "容器已启动\n";
check("TTY 中文日志原样返回", demuxDockerLogStream(Buffer.from(ttyCn, "utf-8")), ttyCn);

console.log("══ ④ 尾部半帧 ══");
const halfFrameHeader = Buffer.from([2, 0, 0, 0, 0, 0, 0, 20]);
const withHalf = demuxDockerLogStream(Buffer.concat([frame(1, "OK\n"), halfFrameHeader, Buffer.from("PART")]));
check("半帧残字节被丢弃", withHalf, "OK\n");
ok("半帧不产生乱码", !withHalf.includes("\uFFFD") && !withHalf.includes("PART"));

console.log("══ ⑤ 多字节字符逐帧独立解码 ══");
const cn = "2026-11-07T00:00:00.000000000Z 堆栈日志：容器启动完成 ✅\n";
check("中文 / emoji payload 无损", demuxDockerLogStream(Buffer.concat([frame(1, cn), frame(2, cn)])), cn + cn);

console.log("══ ⑥ 源码接线（静态断言） ══");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const demuxSrc = rd("server/log-demux.ts");
const dockerSrc = rd("server/docker.ts");
const termSrc = rd("src/components/LogTerminal.tsx");
const stacksSrc = rd("src/pages/Stacks.tsx");
const pkg = JSON.parse(rd("package.json"));

ok("demux 按大端 uint32 读取帧长", demuxSrc.includes("readUInt32BE(offset + 4)"));
ok("demux 有 TTY raw stream 兜底", demuxSrc.includes("parts.length === 0"));
ok("demux 导出供 server 复用", demuxSrc.includes("export function demuxDockerLogStream"));
ok("getContainerLogs 调用 demux", dockerSrc.includes("demuxDockerLogStream(raw)"));
ok("server 不再把 stream 直出 toString", !dockerSrc.includes('Buffer.concat(chunks).toString("utf-8")'));
ok("server 已 import demux", dockerSrc.includes('from "./log-demux.js"'));
ok("LogTerminal 为只读终端", termSrc.includes("disableStdin: true"));
ok("LogTerminal 复用 xterm 渲染 ANSI", termSrc.includes("@xterm/xterm") && termSrc.includes("term.writeln(line)"));
ok("LogTerminal 不连 WebSocket / shell", !termSrc.includes("new WebSocket") && !termSrc.includes("term.onData"));
ok("堆栈日志弹窗改用 LogTerminal", stacksSrc.includes("<LogTerminal lines={logs} />"));
ok("弹窗不再用 <pre> + break-all 渲染日志", !stacksSrc.includes('whitespace-pre-wrap break-all">{logs.join'));
ok("版本号已升到 1.50.30", pkg.version === "1.50.30");

console.log(`\n结果: PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
