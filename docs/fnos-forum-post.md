<!--
飞牛 fnOS 论坛发帖用 Markdown（Discourse 语法）
使用方法：
1. 复制下方正文到论坛发帖编辑器；
2. 按【图 N】占位顺序，把 docs/images/ 与 docs/images/pages/ 里对应的 SVG/PNG 拖进编辑器（论坛会自动转成上传链接）；
   注意：论坛若不支持 SVG，可先用浏览器打开 SVG → 截图成 PNG 再上传；
3. 建议标题：换了飞牛后不习惯原生 Docker？我写了一个以「堆栈」为中心的中文 Docker 管理面板
-->

# 换了飞牛后不习惯原生 Docker？我把 Unraid 的 Compose 体验「搬」过来了 🐳

## 缘起

之前在 Unraid 上一直用自带的 **Compose（堆栈）组件**管理容器，形成了以「堆栈」为中心的使用习惯。后来 NAS 换成飞牛（fnOS），对原生 Docker 的命令行方式不习惯，也缺一个顺手的、以堆栈为核心的图形化界面——于是自己写了一个：**Docker Manager Yanzi**。

【图 1：docs/images/banner.svg】

> 面向自建 NAS / 服务器的一体化 Docker 可视化管理面板（中文界面）
> 单文件二进制 · 轻量部署 · 多引擎接入 · 应用内一键在线升级（OTA）

## 它能做什么（全部页面一览）🧭

【图 2：docs/images/pages/dashboard.svg】

**📊 仪表盘** — 处理器逐核占用、内存、显卡、容器图标墙、网络速率（网卡可切换，含 Docker vNIC）、每块磁盘独立读写曲线；全部实时曲线 + 悬停十字线，时长可调；温度监控零提权。

【图 3：docs/images/pages/containers.svg】

**📦 容器管理** — 搜索 / 状态筛选 / 自定义列 / 导出清单；彩色标签 + 所属堆栈交叉展示；一键打开容器 WebUI；详情页四卡资源曲线、只读终端日志（字节级 demux，彻底无乱码）、浏览器内交互终端。

【图 4：docs/images/pages/stacks.svg】

**🧩 堆栈管理（灵魂页面）** — 以 docker-compose 堆栈为中心，交互蓝本来自 Unraid Compose：整栈启停 / 重建 / 更新检测；YAML 在线编辑（高亮 / 上传 / 下载）；SETTINGS 页配名称、标签、图标（输入名称自动匹配图库）；LABELS 页逐服务配 WebUI、Shell、图标。

【图 5：docs/images/pages/images.svg】

**💿 镜像管理** — 本地 / 未使用 / 悬空分类；拉取进度实时显示；保护标记防误清理；tar 离线导入；后台定时检查镜像更新；**国内拉取加固**（加速源直接读写 daemon.json）。

【图 6：docs/images/pages/volumes.svg】

**🗄️ 数据卷** — 关联容器交叉展示、孤儿卷筛选批量删、卷内容导出快照备份。

【图 7：docs/images/pages/networks.svg】

**🌐 网络** — bridge / host / macvlan / null 四驱动标识、新建网络、与容器堆栈联动。

【图 8：docs/images/pages/notifications.svg】

**🔔 通知中心** — 镜像更新 / 容器异常 / 备份计划 / 应用升级统一聚合，滚动加载历史，支持 Webhook 推送。

【图 9：docs/images/pages/settings.svg】

**⚙️ 设置中心** — 12 分区：多引擎管理、镜像加速源、标签库、页面设置（含自定义图标库目录绑定）、镜像更新调度、**周/月/年三级自动备份**、Webhook、日志、硬件信息、**应用内 OTA**（实时进度条，国内自动切镜像源）。

【图 10：docs/images/pages/login.svg】

**🔐 登录页** — 多用户、找回码自助恢复、空闲自动登出、中英文 + 明暗主题。

## 部署有多简单 🚀

单文件二进制（Linux x86_64），一条命令装完，systemd 托管、专用非 root 账户：

```bash
curl -fsSL https://github.com/yanziruxue/docker-manager/releases/latest/download/quick-install.sh | sudo bash
```

装完访问 `http://<NAS_IP>:5024` 即可，首次进入引导创建管理员。升级走应用内 OTA，只替换二进制、不动数据配置。

也支持接入**远程主机**：SSH 免装 agent、TCP + TLS，一个面板管多台机器。

## 技术形态 🛠

- Node 22 SEA 打包为**单文件二进制**，前端资源内嵌，无外部依赖，下载即跑；
- REST + WebSocket + SSE 三通道，资源监控服务端 1s 聚合推送；
- 数据全在安装目录（data / config / logs），备份迁移 = 拷目录；
- 开源：GitHub `yanziruxue/docker-manager`（README 有完整功能表与 FAQ）。

## 求反馈 🙏

欢迎飞牛的兄弟们试用拍砖，堆栈工作流用不顺手的地方、想加的功能，直接回帖或提 issue。

---

<!--
配图清单（发帖时按序上传）：
图1  docs/images/banner.svg
图2  docs/images/pages/dashboard.svg
图3  docs/images/pages/containers.svg
图4  docs/images/pages/stacks.svg
图5  docs/images/pages/images.svg
图6  docs/images/pages/volumes.svg
图7  docs/images/pages/networks.svg
图8  docs/images/pages/notifications.svg
图9  docs/images/pages/settings.svg
图10 docs/images/pages/login.svg
-->
