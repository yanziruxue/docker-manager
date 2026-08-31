# Docker Manager Yanzi — Docker 镜像部署

单文件 Node SEA 二进制（前后端一体）的容器化部署。镜像内完成全部构建（前端 → esbuild → SEA），**本机无需 node/docker 环境**，把源码包拷到装有 Docker 的 Linux 机器上一条命令出镜像。

## 目录结构

```
deploy/docker/
├── Dockerfile            多阶段构建（builder 产 SEA 二进制 → runtime 精简镜像）
├── docker-compose.yml    compose 一键部署
├── build-image.sh        构建脚本
└── README.md             本说明
```

## 一、构建镜像（在装有 Docker 的 Linux 机器上）

```bash
# 1. 解压源码包
unzip docker-manager-yanzi-docker-src.zip
cd docker-manager-yanzi-docker

# 2. 构建（输出 docker-manager-yanzi:latest）
bash deploy/docker/build-image.sh

# 国内网络 npm 慢时加 registry 加速：
bash deploy/docker/build-image.sh docker-manager-yanzi:latest \
    --build-arg NPM_REGISTRY=https://registry.npmmirror.com
```

构建过程（Dockerfile 内自动完成，约 3-5 分钟）：
1. `npm ci` 安装依赖
2. `vite build` 构建前端
3. esbuild 打 bundle.js（前端内嵌进后端）
4. SEA 注入 → 单文件二进制
5. 精简运行镜像（debian slim + docker CLI + compose 插件）

## 二、运行

**方式 A：compose（推荐）**

```bash
cd deploy/docker
docker compose up -d
```

**方式 B：单容器**

```bash
mkdir -p /opt/dsm/data /opt/dsm/logs /opt/dsm/config
docker run -d --name docker-manager-yanzi --restart unless-stopped \
  -p 5024:5024 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/dsm/data:/app/data \
  -v /opt/dsm/logs:/app/logs \
  -v /opt/dsm/config:/app/config \
  docker-manager-yanzi:latest
```

访问 `http://<服务器IP>:5024`。

## 三、数据布局

| 路径（容器内） | 挂载卷 | 内容 |
|----------------|--------|------|
| `/app/data`    | `./data`    | 运行时数据（engines.json、active_engine.json、stacks/、backups/） |
| `/app/logs`    | `./logs`    | 日志（app-YYYY-MM-DD.log） |
| `/app/config`  | `./config`  | 配置（settings.json） |

可通过环境变量 `DATA_DIR` / `LOG_DIR` / `CONFIG_DIR` 覆盖。

## 四、常用操作

```bash
docker compose logs -f            # 实时日志（compose 方式）
docker compose down               # 停止（数据保留在 ./data ./logs ./config）
docker save -o docker-manager-yanzi.tar docker-manager-yanzi:latest   # 导出离线镜像包
docker load -i docker-manager-yanzi.tar                               # 另一台机器导入
```

## 五、说明与注意事项

- **容器内以 root 运行**：需要写挂载的 `/var/run/docker.sock`。若宿主机 docker 组 gid 固定，可在 compose 里改 `user: "1000:<docker组gid>"` 非 root 运行。
- **compose 功能**：镜像已装 docker CLI 与 compose 插件（来自 Debian docker.io 包），堆栈的 up/down 等操作在容器内通过 socket 执行。若 `docker compose version` 异常，可自行在镜像内补装插件。
- **SSH 远程引擎**：已装 openssh-client，可在容器内管理远程 Docker 主机（需网络可达）。
- **端口**：默认 5024，`PORT` 环境变量可覆盖（需同步 ports 映射）。
- **安全提示**：此镜像持有宿主机 Docker 管理权限，仅部署在可信内网，勿暴露公网。
