/**
 * 解复用 Docker 日志流（Docker Engine API 的 multiplexed stream）。
 *
 * 非 TTY 容器：每条日志帧前有 8 字节头
 *   [0] = 流类型（1 stdout / 2 stderr）
 *   [1..3] = 固定 0
 *   [4..7] = payload 长度（大端 uint32）
 *   [8..] = payload
 * 若直接把整个 Buffer 交给 toString("utf-8")，帧头里的控制字节与非法 UTF-8 字节
 * 会变成 U+0001 / U+0000 / U+FFFD，前端渲染成每行开头的「方框问号」。
 *
 * TTY=true 容器：Docker 返回 raw stream（无帧头），必须原样解码，否则会误砍正文前 8 字节。
 */
export function demuxDockerLogStream(buf: Buffer): string {
  const parts: string[] = [];
  let offset = 0;

  while (offset + 8 <= buf.length) {
    const streamType = buf[offset];
    // 帧头不合法 ⇒ 视为 raw stream，停止拆帧
    if (
      (streamType !== 1 && streamType !== 2) ||
      buf[offset + 1] !== 0 ||
      buf[offset + 2] !== 0 ||
      buf[offset + 3] !== 0
    ) {
      break;
    }
    const size = buf.readUInt32BE(offset + 4);
    // size 为 0 或超出剩余字节 ⇒ 尾部是半帧，丢弃残字节
    if (size === 0 || offset + 8 + size > buf.length) break;

    parts.push(buf.subarray(offset + 8, offset + 8 + size).toString("utf-8"));
    offset += 8 + size;
  }

  // 一帧都没解析成功 ⇒ TTY raw stream 或本就不是 multiplexed，按纯文本处理
  if (parts.length === 0) return buf.toString("utf-8");

  return parts.join("");
}
