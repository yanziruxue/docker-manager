import type { Request, Response, NextFunction } from "express";

/** 嵌入式静态文件条目 */
interface EmbeddedFile {
  data: string; // base64 编码
  mime: string;
}

/** 嵌入式静态文件映射 */
export type EmbeddedDist = Record<string, EmbeddedFile>;

/**
 * 创建嵌入式静态文件中间件
 * 从内存中的 base64 数据直接响应，无需文件系统
 */
export function createEmbeddedStatic(
  embedded: EmbeddedDist,
) {
  const indexFiles = ["index.html", "/", ""];

  return (req: Request, res: Response, next: NextFunction): void => {
    // 只处理 GET/HEAD 请求，避免 API POST/PUT/DELETE 被错误返回 index.html
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }

    // API 路径直接放行
    if (req.path.startsWith("/api/")) {
      return next();
    }

    // 规范化请求路径，去掉开头的 /
    let filePath = req.path.replace(/^\//, "");

    // 根路径或空路径 → index.html
    if (indexFiles.includes(filePath)) {
      filePath = "index.html";
    }

    const file = embedded[filePath];
    if (file) {
      const buffer = Buffer.from(file.data, "base64");
      res.set("Content-Type", file.mime);
      res.set("Cache-Control", "public, max-age=3600");
      res.send(buffer);
      return;
    }

    // SPA fallback：非文件请求也返回 index.html
    if (!filePath.includes(".")) {
      const idx = embedded["index.html"];
      if (idx) {
        const buffer = Buffer.from(idx.data, "base64");
        res.set("Content-Type", idx.mime);
        res.send(buffer);
        return;
      }
    }

    next();
  };
}
