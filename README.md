<div align="center">

<img src="docs/images/banner.svg" alt="Docker Manager Yanzi" width="100%"/>

**面向自建 NAS / 服务器的一体化 Docker 可视化管理面板（中文界面）**

单文件二进制 · 轻量部署 · 多引擎接入 · 应用内一键在线升级（OTA）

![Version](https://img.shields.io/badge/version-1.50.34-2563EB)
![Platform](https://img.shields.io/badge/platform-Linux%20x86__64-0D9488)
![Runtime](https://img.shields.io/badge/Node%2022-SEA%20单文件-7C3AED)
![Port](https://img.shields.io/badge/port-5024-D97706)

</div>

---

## 目录

- [功能总览](#功能总览)
- [功能特性](#功能特性)
- [技术架构](#技术架构)
- [安装与部署](#安装与部署)
- [常见问题](#常见问题)
- [目录结构（安装后）](#目录结构安装后)
- [说明](#说明)

---

## 功能总览

<img src="docs/images/features.svg" alt="功能总览" width="100%"/>

---

## 功能特性

### 多引擎接入

统一管理多台 Docker 主机，三种连接方式随时切换：

| 方式 | 说明 | 适用场景 |
|---|---|---|
| **本地 Socket** | 直连 `/var/run/docker.sock` | 与 Docker 同机部署，最快最稳（推荐） |
| **远程 TCP** | `tcp://` 连接远端 daemon，支持 TLS 自签证书 | 远端已开启 2375 / 2376 端口 |
| **远程 SSH** | 免装 agent，SSH 登录后在服务器本地执行 `docker` CLI | 仅有 SSH 权限的 NAS / 云主机 |

### 仪表盘

- 当前引擎的容器 / 镜像 / 堆栈数量与整体运行状态概览，系统运行时长。
- **磁盘监控四瓦片**：每块磁盘独立 `read / write MB/s` 曲线 + 利用率百分比，四瓦片共享悬停十字线与提示框。
- **网络曲线支持接口切换**：物理网卡、Docker vNIC（`veth` / `br-xxx`）均可单独查看。
- CPU 总体负载曲线，卡片折叠时保留关键指标。
- 温度监控接入 `coretemp` / `k10temp` / `zenpower` / `cpu_thermal` / `drivetemp` 等 sysfs 监控点，**零提权**。

### 容器管理

- 启停 / 重启 / 删除 / 强制停止，右键菜单统一操作（中英文随界面切换）。
- **详情页资源监控四卡**：CPU / 内存 / 网络 I/O / 磁盘 I/O 实时曲线，时间窗口可调（默认 30 秒）。
- **原生终端日志**：日志查看采用只读 xterm 终端渲染，完整保留 ANSI 颜色；服务端按 Docker 8 字节 multiplex 帧头做**字节级 demux**，彻底解决非 TTY 容器日志行首乱码（`□?`）。
- 端口映射展示（`宿主机:容器/协议`，IPv4 / IPv6 去重），WebUI 一键跳转。
- 交互式 Web 终端：浏览器内直接进入容器或宿主机执行命令（无需本地 SSH 客户端）。

### 堆栈（Stacks）管理

- 基于 docker-compose 的堆栈列表、启停、重建、删除。
- `docker-compose.yml` 在线编辑（YAML 高亮）、上传与下载。
- 编辑弹窗 **SETTINGS / LABELS 页签**：
  - SETTINGS：堆栈名称、描述、标签（与容器管理共用同一套标签库）、开机自启等全局配置；
  - LABELS：按服务逐个配置 WebUI 地址 / 端口、默认 Shell、描述、标签与图标。
- **自定义图标库**：在「设置中心 → 页面设置」绑定一个服务端图标目录后，按名称自动匹配堆栈 / 容器 / 服务图标（格式优先级 `png > jpg > ico`）；未绑定时自动回退原有 `icon.*` 方案，行为完全兼容。
- **图标输入自动匹配**：图标填入框输入名称即实时过滤图库（自定义目录 + 堆栈 `icon/` 目录），下拉点选即套用，交互与标签输入一致。

### 镜像管理

- 拉取 / 删除 / 批量清理悬空镜像，拉取进度与并发锁防重复。
- **国内网络拉取加固**：本地 Socket 引擎走 `docker pull` CLI；SSH / TCP 远程引擎走**服务器本地** `docker` CLI，由服务器 daemon 的 `registry-mirrors` 加速（绕开 Docker API 不套加速源的问题）。
- **镜像加速源管理**：「设置 → Docker 全局配置 → 镜像加速源」直接读写宿主机 `/etc/docker/daemon.json` 的 `registry-mirrors`，保留其余配置项，内容变化后询问重启 Docker。

### 数据卷与网络

- 数据卷列出、创建、删除，查看挂载点与占用。
- Docker 网络查看与管理，与容器 / 堆栈联动展示。

### 通知中心

- 操作结果、升级状态、备份与计划任务、异常事件的统一通知聚合，一键清空已读。

### 安全与会话

- 登录认证 + 首次初始化向导，多用户管理。
- 空闲自动登出（超时可配置）。
- 密钥统一加密存储，绝不入库、绝不落明文。

### 设置中心与 OTA 应用内升级

- 中 / 英文界面切换，明暗主题。
- **系统更新**：「设置中心 → 系统更新」点「检查更新」即可发现新版本并一键升级。
  - 升级仓库已**固定写死**为公开仓库 `yanziruxue/docker-manager`，无需填写仓库地址、无需 Token。
  - 升级过程**实时进度条**：下载（5%→40%）→ 解压（50%）→ 替换二进制（75%）→ 完成（100%）。
  - 国内网络自动回退：GitHub 资产 CDN（`objects.githubusercontent.com`）被墙时，自动改走 `gh-proxy.com` 镜像代理下载（进度条标注「直连 / 镜像」）；也可通过环境变量 `UPDATE_MIRROR` 追加自定义镜像。
- 备份计划：每周自动打包堆栈与配置（当天文件永不打包 / 不删），先验证备份可读再清理原始，按档位自动清理过期备份。

---

## 技术架构

<img src="docs/images/architecture.svg" alt="技术架构" width="100%"/>

- **前后端一体单文件二进制**：基于 Node 22 SEA（Single Executable Application）打包，前端静态资源 base64 内嵌，无外部依赖，下载即可运行。
- **三通道通信**：REST（常规请求）+ WebSocket（实时事件）+ SSE（资源监控流），SSE 断线自动重连。
- **数据存储**：全部位于安装目录下的 `data/`（运行时数据）、`config/`（settings.json）、`logs/`（按天日志），备份与迁移只需拷贝整个安装目录。
- **服务管理**：以 systemd 服务 `dockermanagementyanzi` 运行，专用非 root 账户（加入 `docker` 组），默认端口 `5024`。
- **升级安全**：OTA 仅替换二进制本身，不改动 `data/` 与 `config/`，旧版自动备份、可随时回退。

---

## 安装与部署

### 方式一：一键安装（推荐，无需手动下载）

在服务器上直接执行以下命令，脚本会自动下载最新 Release 并安装：

```bash
# GitHub Releases（公网可达，保底源）
curl -fsSL https://github.com/yanziruxue/docker-manager/releases/latest/download/quick-install.sh | sudo bash

# 自建 Gitea（内网直连快）—— 注意 Gitea 不支持 latest/download，须带 tag
curl -fsSL http://192.168.24.10:8024/yanzi/dockermanagementyanzi/releases/download/v1.50.22/quick-install.sh | sudo bash
```

- **下载源顺序**：自建 Gitea → GitHub Releases（脚本自动回退，任一可用即可完成安装）
- 指定版本：`curl -fsSL <上面的任一地址> | VERSION=1.50.34 sudo bash`
- 切换自建源：`GITEA_BASE=http://<Gitea 地址:端口> GITEA_REPO=<owner/repo> sudo bash quick-install.sh`
  （脚本默认 Gitea 入口＝内网 `http://192.168.24.10:8024`，仓库 `yanzi/dockermanagementyanzi`；
  ⚠️ **外网部署须覆盖** `GITEA_BASE` 为公网可达地址 —— 旧域名 `git.ziruxue.top` 已完全不通）
- ⚠️ Gitea **不支持** `releases/latest/download/<file>` 快捷路径（实测 404）⇒ 取脚本请带 tag，或直接用 GitHub 源
- 国内网络：GitHub 源内置 `gh-proxy.com` 回退；如需自定义镜像，可加 `UPDATE_MIRROR=https://你的镜像前缀 sudo bash ...`
- 仅支持 **Linux x86_64**，需 root 权限

### 方式二：手动安装

交付包为 `dockermanagementyanzi-linux-x64.zip`（含二进制 + 安装脚本，另有 `.deb` 格式）。简述如下：

```bash
# 将 zip 传到服务器 /opt 后：
cd /opt
unzip dockermanagementyanzi-linux-x64.zip
cd dockermanagementyanzi
sudo bash install.sh
```

安装脚本会创建不可登录的系统用户并加入 `docker` 组、注册 systemd 服务、自动备份旧版本，随后访问：

```
http://<服务器IP>:5024
```

管理命令：

```bash
systemctl status dockermanagementyanzi    # 查看状态
systemctl restart dockermanagementyanzi   # 重启
journalctl -u dockermanagementyanzi -f    # 实时日志
```

---

## 常见问题

**启动后报 EACCES（无法访问 docker.sock）**

刷新 systemd 用户组缓存后重启：

```bash
systemctl daemon-reexec && systemctl restart dockermanagementyanzi
```

**修改端口**

默认 5024，通过环境变量 `PORT` 覆盖：

```bash
sudo systemctl edit dockermanagementyanzi
# 写入:
# [Service]
# Environment=PORT=8080
sudo systemctl restart dockermanagementyanzi
```

**镜像加速源 / 拉取超时**

- **设置 → Docker 全局配置 → 镜像加速源**直接读写宿主机 `/etc/docker/daemon.json` 的 `registry-mirrors`：打开页面以文件内容为准回读，点 APPLY 写回（保留 `insecure-registries`、`log-driver` 等其它配置项），内容变化后弹窗询问是否重启 Docker，选「是」立即执行并展示 tail 输出。
- 写入需要 root 或免密 sudo。**重新执行 `install.sh` 会自动配置**：写入 `/etc/sudoers.d/dockermanagementyanzi`（仅放行 cat/tee daemon.json、mkdir /etc/docker、`systemctl|service restart docker`，写前 `visudo -c` 校验、失败自动回滚），并把 service 的 `NoNewPrivileges` 置为 `no`、`ReadWritePaths` 追加 `/etc/docker`。
  - 通过**应用内 OTA 升级**不会更新 `.service` 文件，需重跑一次 `sudo bash install.sh`；设置页检测到无权限时会给出可直接复制的授权命令，配好后点「重新检测权限」即可（无需重启服务）。
  - 容器内运行（无 systemctl）时无法重启宿主机 Docker，写入也会落在容器内路径，此时请在宿主机上手动配置。
- 注意 `fnnas` 等为 **mirror-only** 镜像源，只能作为 daemon 的 `registry-mirrors`，不能用于「拉取时改写镜像名」——改写会把 Docker Hub 镜像拼成 `fnnas/library/nginx` 导致 404。
  - 因此「拉取时改写镜像名」默认**关闭**（`rewriteImageNames=false`），加速源只写入 daemon.json 由守护进程生效。
- 远程 SSH / TCP 引擎的拉取由**远端主机自己的 daemon** 执行，需在**那台机器**上配置 `daemon.json`（设置页管理的是运行本服务的这台宿主机）。

**应用内升级报下载失败 / fetch failed**

- 通常是 GitHub 资产 CDN 在国内被墙。新版本已内置镜像回退（gh-proxy.com），正常会自动切换。
- 若仍失败，可在服务环境设置 `UPDATE_MIRROR=https://你的可用代理/`（完整前缀，以 `/` 结尾）后重启服务再试。
- 若当前运行的是**很旧的版本**（升级逻辑本身还不支持镜像回退），需先手动部署一次新版本（解压 zip 后 `sudo bash install.sh`），之后 OTA 才会走新逻辑。

**数据备份**

- 备份整个 `/opt/dockermanagementyanzi/` 即可（含 `data/` + `logs/` + `config/`），或单独拷贝 `data/` 与 `config/` 两个目录。
- 应用内备份计划每周自动打包一次堆栈与配置，当天文件永不打包 / 不删，先验证备份可读再清理原始文件。

---

## 目录结构（安装后）

```
/opt/dockermanagementyanzi/
├── dockermanagementyanzi     可执行文件
├── data/                    运行时数据（引擎配置 / 堆栈 / 备份等）
├── logs/                    日志（app-YYYY-MM-DD.log，按天分文件）
└── config/                  配置（settings.json）
```

---

## 说明

- 本项目为个人自用 / 自部署工具，升级二进制通过公开 GitHub Releases 分发。
- 应用内升级仅替换二进制本身，不改动你的 `data/` 与 `config/`，升级安全、可回退（旧版自动备份为 `/opt/dockermanagementyanzi.bak.<时间戳>`）。
