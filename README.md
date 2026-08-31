# Docker Manager Yanzi

> 面向自建 NAS / 服务器的一体化 Docker 可视化管理面板（中文界面）。
> 单文件二进制、轻量部署、支持多引擎接入与应用内一键在线升级（OTA）。

---

## 功能特性

### 多引擎接入
统一管理多台 Docker 主机，三种连接方式：
- **本地 Socket**：直连 `/var/run/docker.sock`（与 Docker 同机，最快最稳）。
- **远程 TCP**：通过 `tcp://` 连接，支持 TLS 自签证书。
- **远程 SSH**：免装 agent，后端通过 SSH 登录后在服务器本地执行 `docker` CLI（适合只有 SSH 权限的 NAS / 云主机）。

### 仪表盘
- 概览当前引擎的容器数量、镜像数量、堆栈数量与整体运行状态。

### 容器管理
- 启停 / 重启 / 删除 / 强制停止。
- 实时日志查看、资源占用、端口映射展示（`宿主机:容器/协议`，IPv4/IPv6 去重）。
- WebUI 跳转（Globe 图标，直达容器暴露的 Web 服务）。

### 堆栈（Stacks）管理
- 基于 docker-compose 的堆栈列表、启停、重建、删除。
- 支持 `docker-compose.yml` 在线编辑、上传与下载。
- 右键菜单统一操作（中英界面可切换）。

### 镜像管理
- 拉取 / 删除 / 批量清理悬空镜像。
- 拉取逻辑针对被墙网络加固：本地 Socket 引擎走 `docker pull` CLI；SSH / TCP 远程引擎走**服务器本地** `docker` CLI，由服务器 daemon 的 `registry-mirrors` 加速（绕开 Docker API 不套加速源的问题）。

### 数据卷（Volumes）
- 列出、创建、删除数据卷，查看挂载点与占用。

### 通知中心
- 操作结果、升级状态、异常事件的统一通知聚合。

### Web 终端
- 内置浏览器终端，直接进入容器或服务器执行命令（无需本地 SSH 客户端）。

### 实时资源监控（SSE）
- 通过 Server-Sent Events 持续推送各引擎的 CPU / 内存 / 磁盘等指标，前端实时刷新，断线自动重连。

### 系统设置与 OTA 应用内升级
- 中文 / 英文界面切换。
- **系统更新**：在「系统设置 → 系统更新」点「检查更新」即可发现新版本并一键升级。
  - 升级仓库已**固定写死**为公开仓库 `yanziruxue/docker-manager`，无需填写仓库地址、无需 Token。
  - 升级过程**实时进度条**：下载（5%→40%）→ 解压（50%）→ 替换二进制（75%）→ 完成（100%）。
  - 国内网络自动回退：GitHub 资产 CDN（`objects.githubusercontent.com`）被墙时，自动改走 `gh-proxy.com` 镜像代理下载（进度条标注「直连 / 镜像」）；也可通过环境变量 `UPDATE_MIRROR` 追加自定义镜像。

---

## 技术架构

- **前后端一体单文件二进制**：基于 Node 22 SEA（Single Executable Application）打包，无外部依赖，下载即可运行。
- **三通道通信**：REST（常规请求）+ WebSocket（实时事件）+ SSE（资源监控流）。
- **数据存储**：全部位于安装目录下的 `data/`（运行时数据）、`config/`（settings.json）、`logs/`（按天日志），备份与迁移只需拷贝整个安装目录。
- **服务管理**：以 systemd 服务 `docker-manager-yanzi` 运行，默认端口 `5024`。

---

## 安装与部署

### 方式一：一键安装（推荐，无需手动下载）

在服务器上直接执行以下命令，脚本会自动下载最新 Release 并安装：

```bash
curl -fsSL https://github.com/yanziruxue/docker-manager/releases/latest/download/quick-install.sh | sudo bash
```

- 指定版本：`curl -fsSL https://github.com/yanziruxue/docker-manager/releases/latest/download/quick-install.sh | VERSION=1.6.0 sudo bash`
- 国内网络：脚本内置 `gh-proxy.com` 回退；如需自定义镜像，可加 `UPDATE_MIRROR=https://你的镜像前缀 sudo bash ...`
- 仅支持 **Linux x86_64**，需 root 权限

### 方式二：手动安装

交付包为 `docker-manager-yanzi-linux-x64.zip`（含二进制 + 安装脚本）。完整安装步骤见包内 `deploy/linux/README.md`，简述如下：

```bash
# 将 zip 传到服务器 /opt 后：
cd /opt
unzip docker-manager-yanzi-linux-x64.zip
cd docker-manager-yanzi
sudo bash install.sh
```

安装脚本会创建不可登录的系统用户并加入 `docker` 组、注册 systemd 服务、自动备份旧版本，随后访问：

```
http://<服务器IP>:5024
```

管理命令：

```bash
systemctl status docker-manager-yanzi    # 查看状态
systemctl restart docker-manager-yanzi   # 重启
journalctl -u docker-manager-yanzi -f    # 实时日志
```

---

## 常见问题

**启动后报 EACCES（无法访问 docker.sock）**
刷新 systemd 用户组缓存后重启：
```bash
systemctl daemon-reexec && systemctl restart docker-manager-yanzi
```

**修改端口**
默认 5024，通过环境变量 `PORT` 覆盖：
```bash
sudo systemctl edit docker-manager-yanzi
# 写入:
# [Service]
# Environment=PORT=8080
sudo systemctl restart docker-manager-yanzi
```

**镜像加速源 / 拉取超时**
- **设置 → Docker 全局配置 → 镜像加速源**直接读写宿主机 `/etc/docker/daemon.json` 的 `registry-mirrors`：打开页面以文件内容为准回读，点 APPLY 写回（保留 `insecure-registries`、`log-driver` 等其它配置项），内容变化后弹窗询问是否重启 Docker，选「是」立即执行并展示 tail 输出。
- 写入需要 root 或免密 sudo。**重新执行 `install.sh` 会自动配置**：写入 `/etc/sudoers.d/docker-manager-yanzi`（仅放行 cat/tee daemon.json、mkdir /etc/docker、`systemctl|service restart docker`，写前 `visudo -c` 校验、失败自动回滚），并把 service 的 `NoNewPrivileges` 置为 `no`、`ReadWritePaths` 追加 `/etc/docker`。
  - 通过**应用内 OTA 升级**不会更新 `.service` 文件，需重跑一次 `sudo bash install.sh`；设置页检测到无权限时会给出可直接复制的授权命令，配好后点「重新检测权限」即可（无需重启服务）。
  - 容器内运行（无 systemctl）时无法重启宿主机 Docker，写入也会落在容器内路径，此时请在宿主机上手动配置。
- 注意 `fnnas` 等为 **mirror-only** 镜像源，只能作为 daemon 的 `registry-mirrors`，不能用于「拉取时改写镜像名」——改写会把 Docker Hub 镜像拼成 `fnnas/library/nginx` 导致 404。
  - 因此 v1.5.0 起「拉取时改写镜像名」默认**关闭**（`rewriteImageNames=false`），加速源只写入 daemon.json 由守护进程生效；旧版已填加速源的配置会自动迁移为开启，保持原拉取行为。
- 远程 SSH / TCP 引擎的拉取由**远端主机自己的 daemon** 执行，需在**那台机器**上配置 `daemon.json`（设置页管理的是运行本服务的这台宿主机）。

**应用内升级报下载失败 / fetch failed**
- 通常是 GitHub 资产 CDN 在国内被墙。新版本已内置镜像回退（gh-proxy.com），正常会自动切换。
- 若仍失败，可在服务环境设置 `UPDATE_MIRROR=https://你的可用代理/`（完整前缀，以 `/` 结尾）后重启服务再试。
- 若当前运行的是**很旧的版本**（升级逻辑本身还不支持镜像回退），需先手动部署一次新版本（解压 zip 后 `sudo bash install.sh`），之后 OTA 才会走新逻辑。

**数据备份**
备份整个 `/opt/docker-manager-yanzi/` 即可（含 `data/` + `logs/` + `config/`），或单独拷贝 `data/` 与 `config/` 两个目录。

---

## 目录结构（安装后）

```
/opt/docker-manager-yanzi/
├── docker-manager-yanzi     可执行文件
├── data/                    运行时数据（引擎配置 / 堆栈 / 备份等）
├── logs/                    日志（app-YYYY-MM-DD.log，按天分文件）
└── config/                  配置（settings.json）
```

---

## 说明

- 本项目为个人自用 / 自部署工具，升级二进制通过公开 GitHub Releases 分发。
- 应用内升级仅替换二进制本身，不改动你的 `data/` 与 `config/`，升级安全、可回退（旧版自动备份为 `/opt/docker-manager-yanzi.bak.<时间戳>`）。
