import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * 零依赖 ZIP 读写（仅用 node:zlib，可被 esbuild 打进 SEA 单文件）。
 *
 * 用途：备份包统一使用 .zip（跨平台可直接双击打开；tar 在 Windows/mingw 下
 * 对绝对路径有转义坑，且归档内权限位会把源目录的只读属性一起带出来，导致
 * 暂存目录清理时报 EACCES）。
 *
 * 权限约定：写入时**归一化**——目录 0755、普通文件 0644、符号链接 0777，
 * 避免把源目录的畸形权限（如 0555）带进备份包，恢复后应用无法写入。
 * 读取时校验 CRC 并阻断路径穿越（`..` / 绝对路径）。
 */

// ---------- CRC-32（IEEE 802.3，ZIP 规范要求） ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Date → DOS 日期/时间（ZIP 头字段） */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31),
    date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}

const MODE_FILE = 0o100644;
const MODE_DIR = 0o040755;
const MODE_LINK = 0o120777;
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;

interface ZipEntry {
  /** 归档内路径（目录以 `/` 结尾） */
  name: string;
  data: Buffer;
  /** Unix 权限位（含类型位，用于识别符号链接） */
  mode: number;
  mtime: Date;
}

/** 收集目录树（排序保证归档可复现；符号链接按链接本身归档，不解引用） */
function collect(dir: string, prefix: string, out: ZipEntry[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue; // 读不到 stat 的条目直接跳过（如竞态删除）
    }
    if (st.isSymbolicLink()) {
      let target = "";
      try {
        target = fs.readlinkSync(full);
      } catch {
        continue;
      }
      out.push({ name, data: Buffer.from(target, "utf8"), mode: MODE_LINK, mtime: st.mtime });
    } else if (st.isDirectory()) {
      out.push({ name: name + "/", data: Buffer.alloc(0), mode: MODE_DIR, mtime: st.mtime });
      collect(full, name, out);
    } else if (st.isFile()) {
      out.push({ name, data: fs.readFileSync(full), mode: MODE_FILE, mtime: st.mtime });
    }
    // 其它类型（socket / fifo / 设备）无法用 ZIP 表达，跳过
  }
}

/**
 * 把目录打包为 zip。
 * @param srcDir 源目录
 * @param outFile 目标 zip 绝对路径
 * @param prefix 归档内顶层目录名（空则直接把 srcDir 内容放在根）
 * @returns 写入的条目数
 */
export function zipDirectory(srcDir: string, outFile: string, prefix = ""): number {
  const entries: ZipEntry[] = [];
  collect(srcDir, prefix, entries);

  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const isDir = e.name.endsWith("/");
    const raw = e.data;
    const deflated = isDir ? Buffer.alloc(0) : zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = !isDir && deflated.length < raw.length;
    const method = useDeflate ? 8 : 0;
    const data = isDir ? Buffer.alloc(0) : useDeflate ? deflated : raw;
    const crc = isDir ? 0 : crc32(raw);
    const { time, date } = dosDateTime(e.mtime);
    const flags = 0x0800; // 文件名 UTF-8

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 解压所需版本 2.0
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(isDir ? 0 : raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra
    localChunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x031e, 4); // 由 UNIX(3) / 3.0 创建
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(isDir ? 0 : raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // 起始磁盘
    cd.writeUInt16LE(0, 36); // 内部属性
    // 外部属性：高 16 位为 Unix 权限位，低字节 0x10 表示目录
    // 注意：`|` 会按有符号 int32 返回，必须整体 `>>> 0` 转无符号，否则越界
    cd.writeUInt32LE(((((e.mode & 0xffff) << 16) | (isDir ? 0x10 : 0)) >>> 0), 38);
    cd.writeUInt32LE(offset, 42);
    centralChunks.push(cd, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const central = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // 本磁盘号
  eocd.writeUInt16LE(0, 6); // 中央目录起始磁盘
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // 注释长度

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat([...localChunks, central, eocd]));
  return entries.length;
}

/** 解析归档内路径为绝对路径，阻断 `..` 与绝对路径穿越 */
function safeJoin(root: string, name: string): string {
  const target = path.resolve(root, name);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`压缩包条目路径非法：${name}`);
  }
  return target;
}

/**
 * 解压 zip 到目标目录（覆盖同名文件）。
 * @returns 写出的文件数
 */
export function extractZip(zipFile: string, destDir: string): number {
  const buf = fs.readFileSync(zipFile);
  if (buf.length < 22) throw new Error("不是有效的 zip 文件（长度不足）");

  // 从尾部回扫定位 EOCD（最多 64KB 注释）
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 zip 文件（未找到中央目录结尾）");

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const root = path.resolve(destDir);
  fs.mkdirSync(root, { recursive: true });

  let written = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (!name) continue;
    const target = safeJoin(root, name);
    if (name.endsWith("/")) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }

    // 本地头里的 name/extra 长度可能与中央目录不同，需按本地头计算数据起点
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`压缩包条目损坏：${name}`);
    }
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const body = buf.subarray(dataStart, dataStart + compSize);

    let content: Buffer;
    if (method === 0) content = Buffer.from(body);
    else if (method === 8) content = zlib.inflateRawSync(body, { maxOutputLength: Math.max(uncompSize * 4, 1 << 20) });
    else throw new Error(`不支持的压缩方式（${method}）：${name}`);
    if (uncompSize > 0 && crc32(content) !== crc) throw new Error(`CRC 校验失败：${name}`);

    const unixMode = (extAttr >>> 16) & 0xffff;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if ((unixMode & S_IFMT) === S_IFLNK) {
      try {
        fs.rmSync(target, { force: true });
      } catch {
        /* 目标不存在或不可删，忽略 */
      }
      try {
        fs.symlinkSync(content.toString("utf8"), target);
      } catch {
        /* 平台不支持符号链接时跳过该条目 */
      }
    } else {
      fs.writeFileSync(target, content);
      try {
        fs.chmodSync(target, (unixMode & 0o777) || 0o644);
      } catch {
        /* 权限设置失败不致命 */
      }
      written++;
    }
  }
  return written;
}
