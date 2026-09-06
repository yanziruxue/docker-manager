/// <reference types="vite/client" />

/**
 * 应用版本号：构建期由 Vite / esbuild 的 define 注入，
 * 数据源为 package.json 的 version 字段。
 * SEA 二进制内没有 package.json，因此不能用运行时读取。
 */
declare const __APP_VERSION__: string;
