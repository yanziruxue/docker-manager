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
- Docker 已安装并运行（服务通过 docker 组访问 `/var/run/docker.sock`）
- systemd

## 安装

```bash
# 上传 zip 到 /opt 后：
cd /opt
unzip docker-manager-yanzi-linux-x64.zip      # 生成 docker-manager-yanzi/ 文件夹
cd docker-manager-yanzi
sudo bash install.sh
```

安装脚本会：

1. 创建系统用户 `docker-manager-yanzi`（不可登录）并加入 `docker` 组
2. 复制二进制到 `/opt/docker-manager-yanzi/`
3. 创建 `data/ logs/ config/` 子目录
4. 注册并启动 systemd 服务 `docker-manager-yanzi`
5. 旧版本自动备份为 `/opt/docker-manager-yanzi.bak.<时间戳>`

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
