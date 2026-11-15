/**
 * 容器 → 导航页项目卡片的数据派生（v1.53.7）。
 * 纯函数模块（无 React / 无网络），供 AddToNavModal 与门禁真实执行共用。
 */
import type { Container, NavAppItem } from "./types";

/** 生成导航项目 ID（与 NavAppModal 同规则） */
export function genNavAppId(): string {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * WebUI 端口：优先堆栈 LABELS 配置的 webuiPort，回退第一个真实宿主端口映射。
 * 与 NavAppModal#applyContainerPreset 保持同一判据。
 */
export function deriveContainerWebuiPort(c: Container): string {
  return String(c.webuiPort || c.ports?.find((p) => p.host)?.host || "");
}

/** 弹窗初始值：名称取容器名；内网用 `:端口` 简写（导航页按访问主机名自动补全）；外网取 LABELS URL */
export function defaultNavFieldsFromContainer(c: Container): { name: string; lanUrl: string; url: string } {
  const port = deriveContainerWebuiPort(c);
  return {
    name: c.name || "",
    lanUrl: port ? `:${port}` : "",
    url: c.webuiUrl || "",
  };
}

/**
 * 组装导航项目：一律按「自托管」保存（内外网地址可互相回退，见 webui-url#resolveNavAppUrl）。
 * icon 留空 ⇒ NavBoard#resolveNavIconSrc 会按项目名称自动匹配图标库。
 */
export function buildNavAppFromContainer(
  c: Container,
  fields: { name: string; lanUrl: string; url: string; id?: string }
): NavAppItem {
  return {
    id: fields.id || genNavAppId(),
    name: fields.name.trim(),
    icon: "",
    iconColor: "#3B82F6",
    url: fields.url.trim(),
    lanUrl: fields.lanUrl.trim(),
    kind: "self",
    titleColor: "#0F172A",
    urlBackups: [],
    lanBackups: [],
    isPublic: false,
    iconZoom: 100,
    description: c.description || "",
  };
}
