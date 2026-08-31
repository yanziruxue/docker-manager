/**
 * ============================================
 * 全局配置文件
 * 所有可配置的变量统一在此修改，前后端共享。
 *
 * 后端：  server/index.ts 直接 import
 * 前端：  vite.config.ts 直接 import（仅开发模式）
 *
 * ⚠️ 部署文件需手动同步：
 *    deploy/linux/install.sh           → 端口提示 / 目录创建
 *    deploy/linux/*.service            → Environment / WorkingDirectory / ReadWritePaths
 * ============================================
 */

import path from "node:path";

/** 后端 API 服务端口（开发 & 生产统一；生产可用环境变量 PORT 覆盖） */
export const BACKEND_PORT = Number(process.env.PORT) || 5024;

/** 前端 Vite 开发服务器端口 */
export const FRONTEND_PORT = 8088;

/**
 * 生产部署根目录（"当前文件夹"）：
 * systemd 服务的 WorkingDirectory 指向安装目录（如 /opt/docker-manager-yanzi），
 * 因此 process.cwd() 即应用安装目录。
 */
const APP_DIR = process.cwd();

/** 数据目录默认值：<安装目录>/data（引擎配置/堆栈/备份等运行时数据） */
export const DATA_DIR_DEFAULT = path.join(APP_DIR, "data");
/** 日志目录默认值：<安装目录>/logs */
export const LOG_DIR_DEFAULT = path.join(APP_DIR, "logs");
/** 配置目录默认值：<安装目录>/config（settings.json 等） */
export const CONFIG_DIR_DEFAULT = path.join(APP_DIR, "config");
