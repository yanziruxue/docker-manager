/**
 * 应用版本号：构建期由 esbuild 的 define 注入（数据源 package.json）。
 * 开发模式（tsx 直接跑源码）下未注入，运行时用 typeof 检查兜底，
 * 详见 server/updater.ts 的 CURRENT_VERSION。
 */
declare const __APP_VERSION__: string;
