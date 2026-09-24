# Docker Manager Yanzi — Linux 二进制安装包

单文件 Node SEA 二进制（前后端一体），安装到 `/opt/docker-manager-yanzi`，systemd 服务名 `docker-manager-yanzi`。数据、日志、配置全部保存在安装目录下的子目录，备份/迁移只需拷贝整个安装目录：

```
/opt/docker-manager-yanzi/
├── docker-manager-yanzi     可执行文件
├── data/                    运行时数据（引擎配置/堆栈/备份等）
├── logs/                    日志（app-YYYY-MM-DD.log，按天分文件）
└── config/                  配置（settings.json）
```

## 包内容

```
docker-manager-yanzi.zip
└── docker-manager-yanzi/
    ├── docker-manager-yanzi          Linux x64 单文件二进制（Node 22 SEA，ELF）
    ├── install.sh                    安装脚本（装到 /opt，注册 systemd 服务）
    ├── uninstall.sh                  卸载脚本（--keep 保留数据 / --purge 全删）
    ├── docker-manager-yanzi.service  systemd 单元文件
    └── README.md                     本说明
```

## 系统要求

- Linux x86_64（glibc，如 Debian/Ubuntu/CentOS 等）
- systemd
- Docker + Docker Compose：**需自行预先安装**。`install.sh` 不代装 Docker，
  检测到缺失会打印安装指引并**停止安装**（不改动系统）。

## 安装

```bash
# 上传 zip 到 /opt 后：
cd /opt
unzip docker-manager-yanzi-linux-x64.zip      # 生成 docker-manager-yanzi/ 文件夹
cd docker-manager-yanzi
sudo bash install.sh
```

安装脚本会：

1. 检测 Docker / Compose：缺失即提示并停止（`--ignore-docker` 可跳过检查）
2. 创建系统用户 `docker-manager-yanzi`（不可登录）并加入 `docker` 组
3. 复制二进制到 `/opt/docker-manager-yanzi/`
4. 创建 `data/ logs/ config/` 子目录
5. 注册并启动 systemd 服务 `docker-manager-yanzi`
6. 旧版本自动备份为 `/opt/docker-manager-yanzi.bak.<时间戳>`

可选参数：

```bash
sudo bash install.sh --ignore-docker     # 跳过 Docker 检查，仅装应用（容器管理不可用）
```

## 先装 Docker（本包不代装）

`install.sh` 会先检查 Docker CLI、docker 守护进程与 Compose。任一项缺失即打印安装指引并**停止安装**，不修改系统：

```
━━━ 检查 Docker 依赖 ━━━
[WARN]  未检测到 Docker 与 Docker Compose

请先安装 Docker 与 Docker Compose（本安装包不负责安装 Docker）：

  Debian / Ubuntu:
    curl -fsSL https://get.docker.com | sh
    # 国内网络可加镜像：
    curl -fsSL https://get.docker.com | sh -s -- --mirror Aliyun

  RHEL / CentOS / Rocky / AlmaLinux:
    dnf -y install dnf-plugins-core
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin

  装完后启用服务并确认可用：
    systemctl enable --now docker
    docker --version && docker compose version

  然后重新执行本脚本：
    sudo bash install.sh

[ERROR] 请先安装 Docker 与 Docker Compose，安装完成后再重新执行本脚本
```

装好 Docker 后重跑 `sudo bash install.sh`：脚本会创建 `docker` 组、把服务用户加进去，并保留单元里的 `SupplementaryGroups=docker`。

安装完成后访问：

```
http://<服务器IP>:5024
```

> 说明：zip 内已写入 Unix 可执行权限位，Linux 上用 `unzip` 解压即可。
> 若用 Windows 解压后再上传，执行前先 `chmod +x install.sh docker-manager-yanzi`。

## 管理命令

```bash
systemctl status docker-manager-yanzi    # 查看状态
systemctl restart docker-manager-yanzi   # 重启
journalctl -u docker-manager-yanzi -f    # 实时日志
```

## 权限修复（备份跳过文件时）

备份以系统用户 `docker-manager-yanzi` 运行。若某些文件属主是 root 或其他用户（例如早期用 root 手动跑过、或用 `cp -a` 从别处搬进 `data/`），备份会跳过它们并在界面提示：

```
qinglong/.stack-meta.json — 拒绝访问（EACCES）：权限 600，属主 root(uid 0)，当前进程 docker-manager-yanzi(uid 998)
```

「设置 → 备份」页会直接给出**一条命令**（已带真实安装路径），复制后在服务器执行即可——它先体检、再修正，一步完成：

```bash
sudo /opt/docker-manager-yanzi/docker-manager-yanzi fix-perms
```

需要更细的控制时，可选参数：

```bash
# 试运行：只列出将修改的清单，不落盘
sudo ./docker-manager-yanzi fix-perms --dry-run

# 顺带把目录/文件权限归一化为 0755/0644（默认不这么做）
sudo ./docker-manager-yanzi fix-perms --normalize-mode

# 只修指定目录
sudo ./docker-manager-yanzi fix-perms --path /opt/docker-manager-yanzi/data/dockercompose/qinglong

# 只体检、不修改（等价于界面上的「重新检测」）
sudo ./docker-manager-yanzi permission-check
```

要点：

- **默认只修正属主，不改权限位**——避免把 `0600` 的密钥文件放开成 `0644`。
- 目标属主自动识别为服务运行用户；即使在 `sudo` 下也不会误把数据目录 chown 给 root（可用 `--uid` 显式指定）。
- 备份自身带**自愈**能力：若文件属主正确、只是缺读位，备份时会自动补上属主读位后继续（只加 `u+r`，不改动 group/other 位与归属）。可在「设置 → 备份」关闭该行为。
- `fix-perms` 仅适用于 Linux 部署。

## 更新版本

```bash
# 用新二进制覆盖旧文件后重启
sudo systemctl stop docker-manager-yanzi
sudo cp -f docker-manager-yanzi /opt/docker-manager-yanzi/
sudo chmod 755 /opt/docker-manager-yanzi/docker-manager-yanzi
sudo systemctl start docker-manager-yanzi
```

## 卸载

```bash
sudo bash uninstall.sh                         # 交互式（询问是否保留 data/ 数据）
sudo bash uninstall.sh --keep                  # 保留 /opt/docker-manager-yanzi/data 数据
sudo bash uninstall.sh --purge                 # 连数据一起删除
```

## 常见问题

**机器上没装 Docker / 没装 docker-compose**

`install.sh` 只做检测：缺失时会打印安装指引并以退出码 1 结束，**不改动系统**（不会调用 apt/dnf，不会写源）。按指引装好 Docker 与 Compose、确认 `docker compose version` 能正常输出后，重跑 `sudo bash install.sh` 即可。

只想先把应用本体装起来（容器管理不可用）：`sudo bash install.sh --ignore-docker`

**启动后报 EACCES（无法访问 docker.sock）**

```bash
systemctl daemon-reexec && systemctl restart docker-manager-yanzi
```

**改端口**：默认 5024。设置环境变量 `PORT`：

```bash
sudo systemctl edit docker-manager-yanzi
# 添加:
# [Service]
# Environment=PORT=8080
sudo systemctl restart docker-manager-yanzi
```

**数据备份**：备份整个 `/opt/docker-manager-yanzi/` 即可（data/ + logs/ + config/ 全在里面），或单独拷贝 `data/`、`config/` 两个目录。
