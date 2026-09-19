/**
 * 全局实时推送中心（SSE）
 *
 * 用于跨切面、与具体引擎资源流（/api/engines/:id/resource-stats/stream）无关的实时事件，
 * 例如「镜像更新后台检查完成」后即时通知前端刷新通知中心。
 *
 * 设计要点：
 *  - 全局唯一通道（不按引擎分片），客户端只在登录后建立一条 EventSource；
 *  - 事件体为 JSON：`data: {type, ...}\n\n`，前端 EventSource.onmessage 解析；
 *  - 广播逐客户端 write，单客户端写入失败（断线）静默丢弃，不影响其他客户端；
 *  - 不引入任何存储/队列：实时事件只推一次，错过只能等下次拉取（与活动源非实时本质一致）。
 */

import type { ServerResponse } from "node:http";

interface PushClient {
  res: ServerResponse;
}

const clients = new Set<PushClient>();

/** 注册一个 SSE 客户端连接 */
export function addPushClient(res: ServerResponse): void {
  clients.add({ res });
}

/** 移除一个已断开的 SSE 客户端 */
export function removePushClient(res: ServerResponse): void {
  for (const c of clients) {
    if (c.res === res) {
      clients.delete(c);
      break;
    }
  }
}

/** 推送事件类型 */
export interface PushEvent {
  type: string;
  [key: string]: unknown;
}

/** 向所有已连接的客户端广播一条事件 */
export function broadcastPush(event: PushEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    try {
      c.res.write(payload);
    } catch {
      // 客户端已断开但 close 事件尚未到达：下次连接清理时移除
      clients.delete(c);
    }
  }
}
