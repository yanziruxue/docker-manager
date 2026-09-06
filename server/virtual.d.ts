/**
 * 虚拟模块类型声明
 *
 * virtual:embedded-dist — esbuild 打包时注入的前端静态文件映射。
 * 文件系统模式下此模块不存在，由 dynamic import 的 catch 分支处理。
 */
declare module "virtual:embedded-dist" {
  interface EmbeddedFile {
    data: string;
    mime: string;
  }
  const embedded: Record<string, EmbeddedFile>;
  export default embedded;
}
