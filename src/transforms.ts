import type {
  Container,
  ContainerStatus,
  DockerImage,
  DockerVolume,
  Stack,
  StackContainer,
  StackStatus,
  PortMapping,
} from "./types";

/** 将时间戳转为相对时间描述 */
function timeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 0) return "刚刚";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/** 将字节转为人类可读大小 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/** 解析容器运行时间 */
function parseUptime(status: string): string {
  const match = status.match(/^Up (.+)$/);
  if (match) return match[1];
  if (status.startsWith("Exited")) return "已停止";
  return status;
}

/** 转换容器列表 */
export function transformContainers(raw: any[]): Container[] {
  return raw.map((c) => {
    const stateMap: Record<string, ContainerStatus> = {
      running: "running",
      exited: "stopped",
      paused: "paused",
      restarting: "restarting",
      created: "stopped",
      dead: "stopped",
    };

    // 端口映射：去掉 IP 前缀（0.0.0.0/:: 会产生重复条目），按 host:container/protocol 去重合并
    // 显示格式：宿主机端口:容器端口/协议（如 8807:8080/tcp）
    // 无宿主机映射（PublicPort 为空）的条目不显示
    const portMap = new Map<string, PortMapping>();
    for (const p of c.Ports || []) {
      if (!p.PublicPort || !p.PrivatePort) continue;
      const entry: PortMapping = {
        host: String(p.PublicPort),
        container: String(p.PrivatePort),
        protocol: (p.Type || "tcp") as "tcp" | "udp",
      };
      const key = `${entry.host}:${entry.container}/${entry.protocol}`;
      if (!portMap.has(key)) {
        portMap.set(key, entry);
      }
    }
    const ports: PortMapping[] = Array.from(portMap.values());

    const name = (c.Names?.[0] || "").replace(/^\//, "");
    const networks = c.NetworkSettings?.Networks || {};
    const networkKeys = Object.keys(networks);
    const ip = networkKeys.length > 0 ? networks[networkKeys[0]]?.IPAddress || "" : "";
    const networkMode = (networkKeys[0] || "bridge") as Container["networkMode"];

    return {
      id: c.Id?.slice(0, 12) || "",
      name,
      image: c.Image || "",
      imageId: c.ImageID || "",
      status: stateMap[c.State] || "stopped",
      ports,
      ip,
      uptime: parseUptime(c.Status || ""),
      autoStart: c.restartPolicy !== "no" && c.restartPolicy !== "—",
      restartPolicy: c.restartPolicy || "—",
      networkMode: (networkMode as any) || "bridge",
      createdAt: c.Created ? new Date(c.Created * 1000).toLocaleString("zh-CN") : "",
    };
  });
}

/** 转换镜像列表 */
export function transformImages(raw: any[]): DockerImage[] {
  return raw.map((img) => {
    const repoTag = img.RepoTags?.[0] || "<none>:<none>";
    const [repository, tag] = repoTag.split(":");
    const fullSha = (img.Id || "").replace("sha256:", "");
    const isDangling = !img.RepoTags || img.RepoTags.length === 0 || (repository === "<none>" && tag === "<none>");
    return {
      id: fullSha.slice(0, 12),
      repository: repository || "<none>",
      tag: tag || "<none>",
      size: formatBytes(img.Size || 0),
      createdAt: img.Created ? timeAgo(img.Created * 1000) : "",
      associatedContainers: [],
      associatedCount: img.Containers || 0,
      isDangling,
      sha256: fullSha,
    };
  });
}

/** 转换数据卷列表 */
export function transformVolumes(raw: any): DockerVolume[] {
  const volumes = raw.Volumes || [];
  return volumes.map((v: any) => {
    // Docker API 返回 UsageData: { Size: 字节数, RefCount: 引用容器数 }
    const usageData = v.UsageData;
    let sizeStr = "—";
    if (usageData && typeof usageData.Size === "number" && usageData.Size >= 0) {
      sizeStr = formatBytes(usageData.Size);
    }
    return {
      id: v.Name?.slice(0, 12) || "",
      name: v.Name || "",
      driver: v.Driver || "local",
      mountpoint: v.Mountpoint || "",
      size: sizeStr,
      createdAt: v.CreatedAt || "",
      associatedContainers: [],
      labels: (v.Labels && Object.keys(v.Labels).length > 0)
        ? Object.entries(v.Labels).map(([k, val]) => ({ key: k, value: String(val) }))
        : undefined,
      options: (v.Options && Object.keys(v.Options).length > 0)
        ? Object.entries(v.Options).map(([k, val]) => ({ key: k, value: String(val) }))
        : undefined,
      inUse: v.InUse !== false,
    };
  });
}

/** 转换堆栈列表 */
export function transformStacks(raw: any[]): Stack[] {
  return raw.map((s) => {
    const statusMap: Record<string, StackStatus> = {
      running: "running",
      stopped: "stopped",
      partial: "partial",
    };

    const containers: StackContainer[] = (s.containers || []).map((c: any) => ({
      name: c.name || "",
      image: c.image || "",
      tag: c.tag || "latest",
      status: c.status === "running" ? "running" : "stopped",
      network: c.network || "bridge",
      ip: c.ip || "—",
      ports: c.ports || "—",
      hasUpdate: c.hasUpdate || false,
    }));

    return {
      id: s.id || s.name,
      name: s.name || "",
      status: statusMap[s.status] || "stopped",
      totalContainers: s.totalContainers || 0,
      runningContainers: s.runningContainers || 0,
      uptime: s.uptime || "—",
      description: s.description || "",
      composeFilePath: s.composeFilePath || "",
      autoStart: s.settings?.autoStart ?? false,
      containers,
      hasBuild: s.hasBuild ?? false,
      hasUpdate: s.hasUpdate ?? false,
      locked: false,
      isIndirect: false,
      isGitSource: false,
      profiles: s.profiles || [],
      icon: s.icon || "",
      settings: {
        name: s.name || "",
        description: s.description || "",
        iconUrl: s.icon || "",
        defaultProfiles: s.settings?.defaultProfiles || [],
        externalComposePath: s.settings?.externalComposePath || "",
        externalEnvPath: s.settings?.externalEnvPath || "",
        autoStart: s.settings?.autoStart ?? false,
        forceRecreate: s.settings?.forceRecreate ?? false,
        dockerTimeout: s.settings?.dockerTimeout ?? 60,
        stopTimeout: s.settings?.stopTimeout ?? 30,
        autoUpdateEnabled: s.settings?.autoUpdateEnabled ?? false,
        autoUpdateMode: s.settings?.autoUpdateMode || "notify" as const,
        visible: s.settings?.visible ?? true,
      },
      envContent: s.envContent || "",
      webuiLabels: s.webuiLabels || [],
      composeContent: s.composeContent || "",
    };
  });
}

/** 转换活动日志 */
export function transformActivityLogs(raw: any[]): any[] {
  return raw.map((a) => ({
    id: a.id || "",
    timestamp: a.timestamp || "",
    type: a.type || "info",
    message: a.message || "",
  }));
}

/** 转换容器日志（原始字符串数组 → LogEntry 格式） */
export function transformLogs(rawLines: string[]): { timestamp: string; level: string; message: string }[] {
  const logs: { timestamp: string; level: string; message: string }[] = [];
  for (const line of rawLines) {
    // Docker 日志格式：2019-01-01T00:00:00.000000000Z message
    // 或者带 8 字节 header 的格式
    let text = line;
    // 去掉前 8 字节的 Docker stream header（如果有）
    if (text.charCodeAt(0) < 32 && text.length > 8) {
      text = text.substring(8);
    }
    // 尝试匹配时间戳前缀
    const tsMatch = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+(.*)$/);
    let timestamp = "";
    let message = text;
    if (tsMatch) {
      timestamp = tsMatch[1].replace("T", " ").replace(/Z$/, "").substring(0, 19);
      message = tsMatch[2];
    }
    // 简单的日志级别检测
    const lower = message.toLowerCase();
    let level = "info";
    if (lower.includes("error") || lower.includes("fatal") || lower.includes("exception")) level = "error";
    else if (lower.includes("warn") || lower.includes("warning")) level = "warn";
    else if (lower.includes("debug") || lower.includes("trace")) level = "debug";

    logs.push({ timestamp, level, message });
  }
  return logs;
}
