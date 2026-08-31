# syntax=docker/dockerfile:1
# ============================================================
# Docker Manager Yanzi — 多阶段构建
#
# Stage 1 (builder): node:22 中完成
#   前端构建(vite) → esbuild 打包 bundle.js → SEA 注入单文件二进制
# Stage 2 (runtime): debian slim + docker CLI + compose 插件
#
# 在装有 Docker 的 Linux 机器上构建:
#   bash deploy/docker/build-image.sh
#   或  docker build -f deploy/docker/Dockerfile -t docker-manager-yanzi .
# ============================================================

# ---------- Stage 1: 构建 SEA 单文件二进制 ----------
FROM node:22-bookworm-slim AS builder

# 国内网络可用 --build-arg NPM_REGISTRY=https://registry.npmmirror.com 加速
ARG NPM_REGISTRY=https://registry.npmjs.org

WORKDIR /build

# 依赖层（package.json 变更才触发重新安装）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --registry=${NPM_REGISTRY}

# 源码（.dockerignore 已排除 node_modules/dist/deploy 等）
COPY . .

# 1) 前端构建（vite build → dist/）
RUN npm run build:frontend

# 2) esbuild 打包（dist 内嵌 → deploy/linux/bundle.js）
RUN node scripts/build-binary.mjs

# 3) SEA 注入：Linux node 二进制 + bundle blob → 单文件可执行
RUN set -eux; \
    printf '%s\n' \
      '{' \
      '  "main": "/build/deploy/linux/bundle.js",' \
      '  "output": "/build/sea-prep.blob",' \
      '  "disableExperimentalSEAWarning": true,' \
      '  "useSnapshot": false,' \
      '  "useCodeCache": true' \
      '}' > /build/sea-config.json; \
    node --experimental-sea-config /build/sea-config.json; \
    mkdir -p /out; \
    cp "$(command -v node)" /out/docker-manager-yanzi; \
    npm i --no-save --no-audit --no-fund --registry=${NPM_REGISTRY} postject; \
    ./node_modules/.bin/postject /out/docker-manager-yanzi \
      NODE_SEA_BLOB /build/sea-prep.blob \
      --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2; \
    chmod 755 /out/docker-manager-yanzi; \
    ls -lh /out/docker-manager-yanzi

# ---------- Stage 2: 运行镜像 ----------
FROM debian:bookworm-slim AS runtime

# docker CLI + compose 插件 + SSH(远程引擎) + glibc 运行时库（SEA 二进制为 glibc 构建）
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         docker.io \
         openssh-client \
         libstdc++6 \
         ca-certificates \
         tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app
COPY --from=builder /out/docker-manager-yanzi /app/docker-manager-yanzi
RUN mkdir -p /app/data /app/logs /app/config

EXPOSE 5024

# 数据/日志/配置默认位于 /app/{data,logs,config}（生产模式自动生效）
# 可用环境变量 DATA_DIR / LOG_DIR / CONFIG_DIR 覆盖
CMD ["/app/docker-manager-yanzi"]
