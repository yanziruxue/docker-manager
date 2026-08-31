import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { BACKEND_PORT, FRONTEND_PORT } from "./server/config";

// 应用版本号：构建期注入，供前端展示（与 package.json 保持单一数据源）
const appVersion = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf-8")).version;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: FRONTEND_PORT,
    host: true,
    proxy: {
      "/api": {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
