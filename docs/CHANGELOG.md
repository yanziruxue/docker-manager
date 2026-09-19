# 版本记录

> 本文件是项目的**唯一权威进度文档**：完整版本变更日志 + 当前进度 + 开发报告。
> 原 `开发进度总结.md`（2026-08-12 历史快照）已并入此处并删除。

## 维护约定（每次改代码后必做）

1. 改 `package.json` 的 `version`（规则见下方「版本号规则」）。
2. 在本文件「版本变更日志」区**顶部**新增 `## vX.Y.Z — 日期` 段落，每条改动必须写清三项：
   - **已完成**：改了什么、为什么改、涉及文件、如何验证；
   - **未完成 / 已知限制**：本次没做完或受环境所限的事项（没有就写「无」）；
   - **下一步**：基于本次改动的后续计划（没有就写「无」）。
3. 同步更新下方「开发进度总览」的**当前版本行**、模块状态、待办与下一步。
4. 发布后补记 Release 链接与源码 commit SHA。

---

## 开发进度总览

> 最后更新：2026-09-19

### 当前状态

| 项 | 值 |
|---|---|
| 当前版本 | **v1.23.6**（**已发布**）；UI 精简——移除「本机设备」卡片标题下的说明文字。上一版 **v1.23.5**（已发布）：systemd 服务单元一致性自检——OTA 不更新 `/etc/systemd/system/` 下的单元，落后时在卡片提示缺失指令并提供一键复制的 root 修复命令 |
| 版本号规则 | Major 人工发布；Minor 新功能；Patch 修复/优化/UI。v1.22.0 因新增「镜像更新→通知中心」与「硬件指纹作主键」两项新能力归为 Minor |
| 最新 Release | [v1.23.6](https://github.com/yanziruxue/docker-manager/releases/tag/v1.23.6)（UI 精简；含 `quick-install.sh` asset）；上一版 [v1.23.5](https://github.com/yanziruxue/docker-manager/releases/tag/v1.23.5) |
| 源码分支 | `main`（当前发布点 `89adaa6754931a3d879a8d47d86e9cced59377ce`；上一版 `22117a0325c6fffc5264dfa159a17155eb6d3091`） |
| 部署注意 | **改过 `deploy/linux/*.service` 的版本，OTA 后必须重跑 `install.sh`**（或在「设置 → 本机设备」页复制一键修复命令）——OTA 只替换二进制，不更新单元文件 |
| 交付包 | [v1.23.6.zip](https://github.com/yanziruxue/docker-manager/releases/tag/v1.23.6)（42,925,881 B，SHA-256 `ae054b1ca17de744ab2d7cc085387bea09093ab66bdaf0e5498de28d19b00165`）；上一发布版 `v1.23.5.zip` 42,925,949 B SHA-256 `91c08943a3379e4508cfd07466a5dbb41d7af425fd5c8f7a4b56ffbc60e5599c` |
| 架构 | REST + WS + SSE 三通道；Socket / TCP / SSH 三种引擎 |
| 目标平台 | Linux x64（SEA 单可执行文件），Unraid / 自托管 NAS |

### 模块完成状态

| 模块 | 状态 | 说明 |
|---|:---:|---|
| 多引擎管理 | ✅ | Socket / TCP / SSH，CRUD + 连接测试 + 持久化 |
| 仪表盘 | ✅ | 统计卡片 + 资源监控 + 活动时间线 |
| 容器管理 | ✅ | 列表 / 详情 / 启停 / 日志 / 资源监控 / Web 终端 / CSV 导出 |
| 堆栈管理 | ✅ | Compose 自动发现 / 创建（含**上传堆栈备份初始化**）/ 编辑 / 操作 / 更新检查 / 备份恢复 / 批量操作 |
| 镜像管理 | ✅ | 列表 / 筛选 / 拉取（**失败可重试**）/ 删除 / prune 未使用 / **导出下载 tar** / **上传 tar 导入** / **检查更新（真实 digest 比对，含「更新状态」列与单镜像检查）** |
| 数据卷管理 | ✅ | 列表 / 新建 / 删除 / prune / 详情 |
| 备份管理 | ✅ | 手动全量 + 堆栈级备份 / 恢复（含**上传备份文件直接恢复**）/ 导出（**zip** 格式，兼容历史 tar.gz）+ 自动备份调度器（周/月/年/Cron，含保留清理） |
| 权限诊断与修复 | ✅ | 备份期自愈 `u+r` + 结构化诊断（属主/权限位/一条修复命令）+ `fix-perms` CLI + 启动体检与界面提示 |
| 通知中心 | ✅ | 未读已读 + localStorage 持久化 |
| 系统设置 | ✅ | Docker 配置 / Compose 模式 / 通知 / 备份 / **镜像更新**（原「更新调度器」）/ 列显隐 / 本机设备（硬件指纹 6 维 + 完整硬件详情卡片，含 **主板型号 / 产品序列号 / 系统UUID**，只读） |
| Web 终端 | ✅ | xterm.js + WebSocket + 多 Shell 检测 |
| 登录鉴权 | ✅ | 单管理员 + scrypt + httpOnly 会话（绝对过期）+ 密码找回码 |
| 镜像更新（原更新调度器） | ✅ | 后台定时检查镜像版本（每天 / 每周 / 每月，非 Cron）+ 结果落盘缓存 + 镜像页「检查更新」共用同一份数据 |
| OTA 自升级 | ✅ | GitHub Releases 单一源，拉取 + 自替换 + systemd 重启，gh-proxy 镜像兜底，**支持中途取消** |
| Linux SEA 部署 | ✅ | 单可执行文件 + systemd + install/uninstall 脚本；**OTA 后自动自检服务单元是否落后**（含缺失指令与一键修复命令） |
| Docker 部署 | ✅ | 多阶段 Dockerfile |
| **操作日志系统** | 🔨 **约 60%** | `server/logger.ts` 已建好但**未接入** `docker.ts`（仍是 `console.log`）；前端仅 localStorage 版 `opLog.ts`（500 条） |
| 中心统计服务 | ⏸ **暂缓** | 遥测上报端已完成（端点 `docker-yanzi.ziruxue.top`）；中心服务由独立后端实现，本项目不做 |
| 堆栈图标本地上传 | ⬜ 未开始 | 目前仅支持图标 URL |

### 已完成（累计里程碑）

- **v1.13.0** 登录鉴权与账户管理（单管理员）。
- **v1.14.0** 密码找回码（18 位、忽略大小写、10 分钟限流）。
- **v1.15.0** 用户活跃度遥测（双标识 install/active 上报）。
- **v1.15.16** 更新调度器落地为真实后台定时检查。
- **v1.15.17 / 1.15.18** 会话机制改造：滑动过期 → 最终定为**绝对过期**（到点即退）+ 跨重启持久化 + 前端会话心跳。
- **v1.15.19** 一键填入模板新增「指针处」位置。
- **v1.15.20** 一键填入模板扩展为 5 个位置（新增 environment 下 / volumes 下）+ 自动缩进；登录页 UI 微调。
- **v1.16.0** 备份功能完整落地：接线「立即备份/恢复/导出」+ 新增 `server/backup.ts` 全量备份模块 + 自动备份调度器（周/月/年/Cron + 保留清理），并修好「更新调度器从未真正启动」。
- **v1.16.1** 备份下载链路改为 fetch → Blob（带错误提示），修复 `restoreStack` 备份目录不一致与 tar 在 Windows 下的路径解析问题。
- **v1.16.2** 修复「系统设置」角标提示有更新但「系统更新」页空白：更新信息提升为 App 单一数据源（角标与更新页同源）。

### 未完成 / 已知限制

| 项 | 说明 |
|---|---|
| 操作日志未落后端 | `docker.ts` 仍用 `console.log`，未走 `createLogger("Docker")`；设置页无日志级别 UI |
| 会话超时改设置不回退 | 修改「会话超时」只对**下次登录**生效，当前会话仍按旧值 |
| 前端心跳延迟 | 心跳周期 60s，页面自动退出时刻 = 超时时刻 + 最多 1 分钟 |
| 镜像拉取依赖宿主配置 | App 内 `registryMirror` 必须留空，实际走宿主机 `/etc/docker/daemon.json` 的 registry-mirrors |
| OTA 不含 service 更新 | OTA 不更新 `.service` 文件，老部署需重跑 `install.sh` |
| 备份文件名秒级粒度 | 同一秒内对同一 `kind+tag` 连续备份会同名覆盖（前端按钮已禁用，正常操作不触发） |

### 下一步计划

1. **操作日志收尾**：`docker.ts` 接入 `createLogger("Docker")` 替换 `console.log`；设置页加日志级别 Select（debug/info/warn/error）+ journalctl 查看说明。
2. **堆栈图标本地上传**（可选，视需求）。
3. 视使用情况决定中心统计服务是否自建。

### 构建与发布（速查）

```
源码 → npm run build:frontend（dist/）
     → node scripts/build-binary.mjs（deploy/linux/bundle.js）
     → node --experimental-sea-config deploy/linux/sea-config.json（sea-prep.blob）
     → 复制「原始 Linux node」为 deploy/linux/docker-manager-yanzi + postject 注入
     → python deploy/linux/make-package.py（zip）→ cp 到 build-upload/
     → node scripts/push-via-api.mjs（推源码，绕过 git 端口封锁）
     → npm run release（创建 GitHub Release）
```

⚠️ 三个坑：① 绝不用 `bash build.sh`（会复制 Windows node.exe）；② `sea-config.json` 的 `main`/`output` 必须是 Windows 绝对路径 `D:/...`；③ `make-package.py` 产物在 `deploy/linux/`，发布用 `build-upload/` 那份，别漏 `cp`。详细流程见 `docs/发布与OTA升级指南.md`。

---

## 版本号规则

格式：`Major.Minor.Patch`（如 `1.1.0`）

| 位置 | 名称 | 递增条件 |
|------|------|----------|
| 第一位 | 主版本 Major | **人工定义** — 重大架构变化、不兼容更新 |
| 第二位 | 次版本 Minor | 功能增加 — 新功能模块、新页面（**新字段不算 Minor**） |
| 第三位 | 补丁 Patch | 修复、优化、UI 改动 |

递增约定：
- 一次发布中同时含 Minor 与 Patch 时，按**最高级别**递增，低级别归零（例：`1.0.3` + 新功能 → `1.1.0`）
- Major 由人工决定，不自动递增
- 同一天内的多次改动合并为一个版本，逐条记录在版本下

---

## v1.23.6 — 2026-09-19（已发布）

> UI 精简：移除「本机设备」卡片标题下方的说明文字。

### ✅ 已完成

- **`src/components/ActivityPanel.tsx`**：删除标题 `本机设备` 下的说明文字「设备唯一标识与硬件指纹（用于安装量 / 活跃度统计，自动静默上报）」（连同其 `<p>` 元素），并去掉标题上多余的 `mb-1` 间距，避免留下悬空外边距。
- 该文案仅为页面说明，**不涉及接口、字段与指纹逻辑**；`GET /api/telemetry/status`、`hardware` / `details` 结构均无改动。
- **验证**：前端 `tsc --noEmit` 通过；新产物 `index-BTls4NNc.js` 中该文案**已无命中**，卡片标题「本机设备标识」仍在。

### ⚠️ 未完成 / 已知限制

- 无。

### 📌 下一步

- 无。

### 发布记录（2026-09-19）

- **Release**：[v1.23.6](https://github.com/yanziruxue/docker-manager/releases/tag/v1.23.6)（assets：`docker-manager-yanzi-linux-x64-v1.23.6.zip` + latest 别名 `…-linux-x64.zip` + `quick-install.sh`）
- **源码 commit**：`89adaa6754931a3d879a8d47d86e9cced59377ce`（`main`，97 文件）
- **交付包**：`docker-manager-yanzi-linux-x64-v1.23.6.zip` — 42,925,881 B，SHA-256 `ae054b1ca17de744ab2d7cc085387bea09093ab66bdaf0e5498de28d19b00165`
- **构建校验**：前后端 `tsc` 双绿；前端产物 `index-BTls4NNc.js`（+ `index-aXNdmFyW.css`）已内嵌；二进制 ELF magic `7f 45 4c 46`、129,764,544 B；单元模板（1985 B）与 `/system/service-unit` 自检均在包内
- **部署注意**：本版**未改动 `deploy/linux/*.service`**，OTA 直接覆盖二进制即可，无需重跑 `install.sh`

---

## v1.23.5 — 2026-09-19（已发布）

> 修复一个**结构性隐患**：`/etc/systemd/system/docker-manager-yanzi.service` 由 `install.sh` 安装，而**在线升级（OTA）只替换二进制、从不更新它**。于是 v1.23.4 依赖 `ExecStartPre` 的「DMI 镜像」在已升级的生产机上**静默失效**——用户只看到产品序列号/系统UUID 仍是「—」，无法判断是硬件没烧录、权限不足，还是服务单元没更新。本版把「单元是否落后」做成可见、可一键修复。

### ✅ 已完成

- **构建期嵌入 systemd 单元模板**：`scripts/build-binary.mjs` 新增 `virtual:embedded-service` 虚拟模块（新增 `readServiceTemplate()` + `embeddedServicePlugin()`），把 `deploy/linux/docker-manager-yanzi.service` 原文嵌进 bundle，banner 也标注嵌入字节数。SEA 二进制内没有仓库文件，不嵌入就无从比对。
- **新增 `server/unit-status.ts`**（只读）：`checkServiceUnit()` 解析「已安装单元 + `/etc/systemd/system/<unit>.d/*.conf` drop-in」的指令集合，与嵌入模板逐一比对，输出 `missing[]`（缺失指令）、`dropIns[]`、`mirrorDir`/`mirrorFiles`（DMI 镜像目录现状）、`upToDate`，以及一条**可直接粘贴的 root 修复命令**（`sudo tee <unit> <<'EOF' … EOF` + `daemon-reload && restart`，与 `install.sh` 行为一致）。
  - 只比对**指令集合**而非整文件哈希：运维手工加注释不应被误判落后；反斜杠续行会先合并，注释/空行/`[Section]` 段头忽略。
  - `applicable` 判定为「Linux 且已安装单元存在」——Windows 开发机 / 容器内不适用，避免误报。
- **后端暴露与启动自检**：`server/index.ts` 新增 `GET /api/system/service-unit`；启动体检（`setImmediate` 内）在单元落后时打印 `⚠️ 系统服务单元落后：缺少 N 条指令（RuntimeDirectory、ExecStartPre）`，并指向设置页。
- **前端提示**：`src/api.ts` 新增 `ServiceUnitStatus` 类型与 `fetchServiceUnitStatus()`；`src/components/ActivityPanel.tsx` 在「本机设备」卡片上方渲染琥珀色提示条——写明缺少的指令、受影响功能、「该文件由安装脚本写入、在线升级不会更新它」，并提供**复制修复命令**按钮（复用 `copyText()`）。另外「产品序列号 / 系统UUID」为空时的悬停提示改为按因区分：单元落后 / 单元已新但镜像未生成（需重启）/ 已镜像仍为空（BIOS 未烧录）。
- 验证：`npm run build` 全绿；`tsc -p server/tsconfig.json` 与前端 `tsc --noEmit` 双绿；前端产物 grep 到新文案；zip 内 `bundle.js` 含 `/run/docker-manager-yanzi/dmi-` 与单元模板标记。

### ⚠️ 未完成 / 已知限制

- 修复命令仍需用户手工在服务器执行（写 `/etc/systemd/system/` 需 root，应用自身没有该授权，也不应为此开 `sudoers`）。
- 单元比对是「模板指令 ⊆ 已安装指令」的子集判定：若运维把某条指令**改错值**（如路径写歪）而键名仍一致，本检查发现不了。

### 📌 下一步

- 无。本次发布后需要**重跑 `install.sh`（或使用界面里的复制修复命令）**才能让 v1.23.4 的 DMI 镜像真正生效。

### 📦 发布记录

- 日期：2026-09-19
- Release：[v1.23.5](https://github.com/yanziruxue/docker-manager/releases/tag/v1.23.5)（assets：`docker-manager-yanzi-linux-x64-v1.23.5.zip` / 无版本名别名 / `quick-install.sh`）
- 源码：`main @ 22117a0325c6fffc5264dfa159a17155eb6d3091`（97 个文件，含新增 `server/unit-status.ts`）
- 交付包：42,925,949 B，SHA-256 `91c08943a3379e4508cfd07466a5dbb41d7af425fd5c8f7a4b56ffbc60e5599c`
- 二进制：129,764,544 B，ELF magic `7f 45 4c 46`；内嵌校验通过（`1.23.5` / `/system/service-unit` / `RuntimeDirectory=docker-manager-yanzi` / `index-U24Mo9KV.js`）

---

## v1.23.4 — 2026-09-19（已发布）

> 修复 v1.23.3 新增的「产品序列号 / 系统UUID」在**非 root systemd 服务**下显示「—」的问题。根因：内核把 `/sys/class/dmi/id/` 下 `product_serial`、`product_uuid`、`board_serial` 的权限设为 **0400（仅 root 可读）**，服务进程以非 root 用户运行，直读必然失败；只有 `board_name` 是 0444 可读（故卡片只有「主板型号」显示正常）。修复方式：systemd 单元在启动前以 root 把这三个值镜像成世界可读副本，后端优先读副本。

### ✅ 已完成

- **systemd 单元增加 DMI 镜像步骤**：`deploy/linux/docker-manager-yanzi.service` 新增 `RuntimeDirectory=docker-manager-yanzi` 与一条 `ExecStartPre=+/bin/sh -c '...'`——`+` 前缀表示该命令以 root 提权执行并绕过沙箱（`PrivateTmp`/`ProtectSystem` 等不生效），把 `board_name` / `product_serial` / `product_uuid` 写入 `/run/docker-manager-yanzi/dmi-<field>`（root 创建、umask 022 即 0644，世界可读）。**刻意不写 `$VAR`**：systemd 会先做变量展开，`$f` 会被吃成空串。
- **后端优先读镜像副本**：`server/telemetry.ts` 的 `collectDmiIds()` 改为「先读 `/run/docker-manager-yanzi/dmi-<field>` → 回退 `/sys/class/dmi/id/<field>`」，两者皆空显示「—」。`collectBoardId()`（指纹用）**保持原样**——避免 `boardSerial` 从空串变为 `Default string` 导致 6 维指纹变化、设备被判定为新设备重报 install。
- 验证：`npm run build`（vite + tsc server）全绿；`systemd-analyze verify` 语义待 Linux 端验证（本机 Windows 无法跑）。

### ⚠️ 未完成 / 已知限制

- **需重跑 `install.sh`（或手动替换 `.service` + `daemon-reload` + `restart`）本机才生效**：OTA 只替换二进制、不更新 `.service`（长期限制）。
- 镜像只在**服务启动时**刷新一次；DMI 值静态不变，正常场景无影响。
- 若 `+` 前缀被 systemd 拒绝（极老版本 <231），`ExecStartPre` 会失败导致服务起不来；Debian 12（systemd 252）无此问题。

### 📌 下一步

- 无。

### 🚀 发布记录（2026-09-19）

- Release：https://github.com/yanziruxue/docker-manager/releases/tag/v1.23.4
- 源码 commit：`eb553f6b9a1daa2ff0d235cfdc7aa8357b4adfa8`（main）
- 交付包：`docker-manager-yanzi-linux-x64-v1.23.4.zip`（42,921,687 B，SHA-256 `bf6972c8aba10c7fb24ea6a3f04e7ed0346e2093a8f3b5c2931e826be60a00aa`）
- ⚠️ 本机需**重跑 `install.sh`**（或手动替换 `.service` + `daemon-reload` + `restart`）才会写入新的 systemd 单元——OTA 不含 `.service` 更新。

---

## v1.23.3 — 2026-09-19（已发布）

> 本机设备标识卡片新增 3 条 DMI 标识：**主板型号 / 产品序列号 / 系统UUID**。原卡片仅展示「主板」（序列号，本机因权限 400 恒为「—」），现补齐主板型号等可直接读取的标识字段。纯展示扩展，**不参与 6 维硬件指纹哈希，不影响统计主键**。

### ✅ 已完成

- **设备标识卡片新增 3 行 DMI 字段**：`server/telemetry.ts` 的 `DeviceDetails` 接口新增 `dmi: { boardName; productSerial; productUuid }`，并新增 `collectDmiIds()` 经 sysfs 直读 `/sys/class/dmi/id/{board_name,product_serial,product_uuid}`（权限 0444，普通用户可读；失败降级空串，不抛错）；`collectHardwareDetails()` 填充 `dmi`。
  - `src/api.ts` 的 `DeviceDetails` 接口同步新增 `dmi` 字段。
  - `src/components/ActivityPanel.tsx` 在「主板」行后新增 **主板型号 / 产品序列号 / 系统UUID** 三行（序列号与 UUID 用等宽字体，可 hover 查看完整值）。
  - 验证：`npm run build`（vite build + `tsc -p server/tsconfig.json`）全绿，无类型错误。

### ⚠️ 未完成 / 已知限制

- 产品序列号若 BIOS 未烧录，可能显示占位符（如 `Default string`）；此处**按 sysfs 原值展示**，不做特殊清洗（便于用户判断 BIOS 是否烧录）。
- 若某字段 sysfs 权限受限则显示「—」（本机 `product_uuid` 可读、`board_serial` 仍受限）。

### 📌 下一步

- 无。

### 🚀 发布记录（2026-09-19）

- Release：https://github.com/yanziruxue/docker-manager/releases/tag/v1.23.3
- 源码 commit：`d1e90c37ef5619d8854e60f829d3dbcde1eb50d0`（main）
- 交付包：`docker-manager-yanzi-linux-x64-v1.23.3.zip`（42,921,245 B，SHA-256 `1fad2f2db6471d1a383c1d6b2f3305e6a6a19f4e289cebf1af97c8db896ec74c`）

---

## v1.23.2 — 2026-09-19（已发布）

> GPU 识别兼容性修复：本机设备标识卡片的 GPU 行在裸机 systemd 服务（非 root 用户 `docker-manager-yanzi`）部署下原显示「—」。原 `collectGpu()` 依赖 `lspci`/`nvidia-smi`；现改为直接读取 `/sys/bus/pci/devices` 解析 PCI 显示控制器（class 0x03），**彻底摆脱对 `lspci` 的依赖**（`/sys/bus/pci` 权限 0444，普通用户可读），裸机非 root 服务也能稳定识别核显/独显型号。

### ✅ 已完成

- **GPU 采集改 sysfs 直读优先**：`server/telemetry.ts` 新增 `collectGpuFromSysfs()`（遍历 `/sys/bus/pci/devices/*`，按 PCI class `0x03` 过滤显示控制器，读 `vendor`/`device` 并解析 `/usr/share/misc/pci.ids`（或 `hwdata/pci.ids`）数据库拼出型号）+ `resolvePciName()`；`collectGpu()` 改为「sysfs 直读 → lspci 兜底 → nvidia-smi 兜底」的顺序。普通用户可读 `/sys/bus/pci`，故非 root systemd 服务下也能识别 GPU（如 `Intel Corporation Skylake GT2 [HD Graphics 520]`），不再依赖 `lspci` 是否可用。
  - 文件：`server/telemetry.ts`（仅改 GPU 采集逻辑，6 维指纹 `collectGpu()` 返回值仍作统计主键维度，sysfs 解析出的型号与 lspci 语义一致，不影响设备指纹哈希）。
  - 验证：`tsc -p server/tsconfig.json --noEmit` 全绿。

### ⚠️ 未完成 / 已知限制

- 主板序列号仍显示「—」：本机 `/sys/class/dmi/id/board_serial` 权限 `400`（仅 root），非 root 服务读不到；且该值本身是 BIOS 占位符 `Default string`，即便提权读到也无识别意义（方案 B 未采纳）。
- GPU 显存：核显/AMD 集显无独立显存，`nvidia-smi` 不存在时 `memory` 字段留空，卡片 GPU 行仅显示型号（不强行标注「共享内存」以免误导独显）。

### 📌 下一步

- 无（主板如需展示可另议 sudo 提权方案，但值为假、意义有限）。

### 🚀 发布记录（2026-09-19）

- Release：https://github.com/yanziruxue/docker-manager/releases/tag/v1.23.2
- 源码 commit：`f5b9fd0b83ec855172fa9fa83d6334d25346053a`（main）
- 交付包：`docker-manager-yanzi-linux-x64-v1.23.2.zip`（42,920,815 B，SHA-256 `45da03476aead085e32425a414d087b9bce6b8c2cba58e54dedacf60fb22fbdb`）

---

## v1.23.1 — 2026-09-19（已发布）

> 本机设备标识卡片明细区布局优化：从「宽屏双列」改为始终单列（每行一条），提升长哈希 / 长路径类字段的可读性。纯 UI 调整，无后端改动。

### ✅ 已完成

- **设备标识卡片单列布局**：`src/components/ActivityPanel.tsx` 的「本机设备标识」卡片明细区，容器由 `grid grid-cols-1 sm:grid-cols-2`（宽屏双列）改为 `grid grid-cols-1`（始终单列），并移除「标识文件」的 `span2` 跨列属性。现在运行环境 / 应用版本 / 架构 / 系统 / 标识文件 / 主板 / CPU / GPU / 内存 / 硬盘 **每条独占一行**。
  - 文件：`src/components/ActivityPanel.tsx`（仅改明细区容器类名与一处 `span2` 属性）。
  - 验证：`npx tsc --noEmit -p tsconfig.json`（前端）无错；`npm run build:frontend` 成功，新资产 `index-Corx5SJd.js` 含 `grid-cols-1 gap-y-2`。

### ⚠️ 未完成 / 已知限制

- 无（纯 UI 布局微调）。

### 📌 下一步

- 无。

### 🚀 发布记录（2026-09-19）

- Release：https://github.com/yanziruxue/docker-manager/releases/tag/v1.23.1
- 源码 commit：`4fbc23d6d424ba89338f240ca03a8f6212b6fd23`（main）
- 交付包：`docker-manager-yanzi-linux-x64-v1.23.1.zip`（42,920,193 B，SHA-256 `e72e1980447afbc92d6a3cf54e9c20144c19bdc0b30afd2a99d178192d4b2957`）

---

## v1.23.0 — 2026-09-19（已发布）

> 后台镜像更新检查（调度器）完成后通过 SSE 实时推送，前端即时刷新通知中心（此前仅手动检查/切页/刷新才拉取）；同时「本机设备标识」卡片改版为按「设备标识 / 运行环境 / 应用版本 / 架构 / 系统 / 标识文件 / 主板 / CPU / GPU / 内存 / 硬盘」展示完整硬件详情（新增富硬件详情采集，6 维指纹与统计主键不变）。

### ✅ 已完成

- **全局实时推送通道**：新增 `server/push.ts`——全局 SSE 广播中心（`addPushClient`/`removePushClient`/`broadcastPush`），客户端登录后只建一条 `EventSource`，不按引擎分片、不引入存储/队列。
  - 路由：`GET /api/push`（`server/index.ts`，与 `resource-stats/stream` 同款 `text/event-stream` 头 + `X-Accel-Buffering: no` 关代理缓冲，首帧发 `ready` 事件）；刻意放在 `index.ts` 而非 `scheduler.ts`，避免 `scheduler↔index` 循环依赖。
- **调度器完成即推送**：`scheduler.ts: runCheck()` 在落盘与写日志后，调用 `broadcastPush({ type:"image-update-checked", at, byEngine })`（含每引擎 `engineId/updates/checked`）。推送失败仅告警，不影响检查结果。
- **前端即时刷新**：`src/App.tsx` 登录并选定引擎后建一条全局 `EventSource("/api/push")`；收到 `image-update-checked` 且 `byEngine` 含当前 `activeEngineId` 时，调用 `refreshActivities(activeEngineId)` 重写活动日志，通知中心角标与列表实时出现「有可用更新」通知；切换引擎时重建连接绑定最新 `activeEngineId`。
- **设备标识卡片改版（完整硬件详情）**：`src/components/ActivityPanel.tsx` 的「本机设备标识」卡片按固定格式展示：设备标识（可显隐/复制）、运行环境、应用版本、架构、系统、标识文件、主板、CPU、GPU、内存、硬盘。新增后端 `collectHardwareDetails()`（`DeviceDetails`：CPU 型号/物理核数/逻辑线程数/最高频率、GPU 型号/显存、内存型号/总容量、硬盘序列号/型号/大小），数据仅本地展示、**不进入 6 维指纹哈希**（复用既有 `collectCpuId/collectGpu/collectMemory/collectDiskId/collectBoardId`），故不影响既有设备统计主键与安装量基线。卡片用 `details` 富字段渲染，主板序列号/硬盘序列号仍取自既有的 6 维 `hardware`（同作指纹维度）。
  - 文件：`server/telemetry.ts`（新增 `DeviceDetails` 接口 + `collectHardwareDetails()`，挂到 `TelemetryStatus.details`）、`src/api.ts`（同步 `DeviceDetails` + `TelemetryStatus.details`）、`src/components/ActivityPanel.tsx`（重写卡片：移除 `HW_FIELDS` 隐私隐藏段与 `matchCount/envUnchanged/fmtDateTime` 死代码，新增 `Row` + `fmtCpu/fmtGpu/fmtMem/fmtDisk` 格式化）。
  - 验证：`npm run build`（vite + tsc server）全绿；`npx tsc --noEmit -p tsconfig.json`（前端）无错；dist 含「运行环境/标识文件/主板/应用版本/架构」等新串，`硬件指纹（部分维度隐私隐藏）` 旧串已消失。

### ⚠️ 未完成 / 已知限制

- 实时推送仅覆盖「通知中心活动」；镜像管理页「更新状态」列仍依赖进入页面/切引擎时读缓存（`loadImageUpdateStatus`），后台检查完成不会自动刷新该列（如需同歩实时，可在该事件里一并调用 `loadImageUpdateStatus`）。
- 推送为「发后即弃」：若前端当时未连接（页面关闭/断网），错过该次事件，需等下次拉取（与活动源非实时本质一致）。
- 推送通道未做事件类型白名单，后续新增实时事件（如备份完成）复用同一 SSE 即可，前端按需扩展 `type` 分支。
- 富硬件详情在容器/虚拟化环境可能缺失：dmidecode / lspci / nvidia-smi 在容器内通常无权限或不存在，主板序列号、内存型号、GPU 型号/显存等字段会显示「—」，仅 CPU（/proc/cpuinfo + nproc）、硬盘（lsblk）等基础信息可稳定采集。

### 📌 下一步

- 无（可选：如需镜像管理页「更新状态」列也随后台检查实时刷新，可在该事件里一并调用 `loadImageUpdateStatus`）。

### 🚀 发布记录（2026-09-19）

- Release：https://github.com/yanziruxue/docker-manager/releases/tag/v1.23.0
- 源码 commit：`d7b3aad9f57f910d332c5f1e100962d5bc4552a1`（main）
- 交付包：`docker-manager-yanzi-linux-x64-v1.23.0.zip`（42,920,286 B，SHA-256 `6c072f280e358483623e662e46e3fb1bd1bfc5fb974319c9806e6be2cf6b7eb4`）

---

## v1.22.0 — 2026-09-19

> 两处改动：① 镜像更新结果接入通知中心（不另存事件流，复用活动日志「从引擎实时状态派生」的既有架构）；
> ② 设备唯一标识改为**硬件指纹**（主板+CPU+内存+硬盘+显卡+安装的系统 6 维哈希）作为统计主键，**取消随机设备 UUID**。

### ✅ 已完成

- **镜像更新结果接入通知中心**：`/api/engines/:id/activity` 在返回活动日志时，读取本引擎的镜像更新缓存（`getImageUpdateCache`），对每个 `hasUpdate === true` 的镜像派生一条 `warning` 级活动（`镜像 <repo:tag> 有可用更新`），经统一时间倒序后取最近 20 条返回。
  - 文件：`server/index.ts`（activity 路由）；复用 `scheduler.ts: getImageUpdateCache`，不引入 docker.ts↔scheduler 循环依赖。
  - 设计依据：通知中心活动本身即从实时状态派生（容器运行/停止/暂停、最近拉取镜像），镜像更新通知沿用同一模型，无需新增存储或 SSE；缓存与镜像管理页「更新状态」列同源（`image-update-cache.json`），单镜像/全量检查、手动/调度器结果一致。
- **前端手动检查后即时刷新**：镜像管理页「检查全部更新」/右键「检查更新」完成后，调用 `fetchEngineActivity` 重新拉取活动日志并写入 `activities`，使通知中心角标与列表即时反映新出现的「有可用更新」通知（此前仅切引擎/刷新页面才会拉取）。
  - 文件：`src/App.tsx`（`refreshActivities` 回调 + 在两个 `handleCheck*` 中调用）；`src/api.ts` 复用已有 `fetchEngineActivity`。
- **设备唯一标识改为硬件指纹，取消设备 UUID 作为统计主键**：
  - 统计主键 = 本机硬件指纹（主板 `boardSerial` + CPU + 内存 + 硬盘 `diskUid` + 显卡 GPU + 安装的系统 `system` 共 6 维 sha256 哈希）；不再生成/持久化随机 `device_uuid` 作为标识。
  - `getDeviceInfo()` 重写为「硬件指纹一致即同一设备、不一致即新设备（重新按当前硬件生成标识并重报 install）」，删除原「≥3 维匹配沿用 UUID」逻辑与 `isEnvUnchanged`/`countMatches` 双参函数。
  - `collectHardwareFingerprint()` 由 3 维（cpu+board+disk）扩展为 6 维（system+cpu+gpu+memory+disk+board），虚拟环境仍统一归零。
  - 上报载荷 `device_uuid` / `hw_fingerprint` 值改为硬件指纹；`hardware` 由 7 维精简为 6 维（移除 `deviceUid`）；`collectBoardId` 仍借 `product_uuid`（主板硬件 UUID）作「主板」维度。
  - 前端 `ActivityPanel`「本机设备」卡片：统计主键标签由「设备 UUID」改为「设备标识（硬件指纹，统计主键）」，`/7 项匹配` 改为 `/6 维已识别」，硬件指纹列表移除「设备 UID」行；`api.ts` 的 `DeviceHardware`/`TelemetryStatus` 同步为 6 维、`uuid`→`deviceId`。
  - 文件：`server/telemetry.ts`、`src/api.ts`、`src/components/ActivityPanel.tsx`。
  - 验证：`tsx` 直跑 `getTelemetryStatus()` 产出 64 位 hex `deviceId`、不崩溃；`npm run build`（vite+tsc server）全绿。

### ⚠️ 未完成 / 已知限制

- 调度器后台定时检查产生的结果**不会实时推送**到已打开的通知中心，需在下一次活动日志拉取（切引擎、刷新页面、或手动检查触发刷新）时才出现——与现有活动源非实时推送的设计一致，本期不做 SSE 推送。
- 通知条目随缓存刷新：镜像已拉取新版本但未再次「检查更新」前，缓存仍标记 `hasUpdate`，通知持续存在（与「更新状态」列行为一致）。
- 硬件指纹含「安装的系统」维度：系统大版本/内核升级会改变 `deviceId`，服务端据此计为新设备（符合「标识采用安装的系统」的设计；若只想按固定发行版去重，需后续把 system 粒度收窄为发行版名）。
- **虚拟化环境**：6 维统一归零，所有同质虚拟机指纹相同 → 安装量会被低估（与取消随机 UUID 的取舍一致，真实 NAS/Unraid 物理机主板/硬盘序列号可区分）。
- 升级到本版后首次启动：旧 `device.info` 无 `deviceId` 字段 → 按新设备重新注册并补报一次 install（新标识基线的正常代价）。

### 📌 下一步

- 无（可选：若需要后台检查也实时出现在通知中心，再为 activity 增加 SSE 推送）。

### 🚀 发布记录（2026-09-19）

- Release：https://github.com/yanziruxue/docker-manager/releases/tag/v1.22.0
- 源码 commit：`e756d8707d678712829080e0eac82faba76b2d4d`（main）
- 交付包：`docker-manager-yanzi-linux-x64-v1.22.0.zip` 42,918,836 B / SHA-256 `7634e5edf4a73d7ec7b014d13915032b55b4654bd121e9c978be7eebbe475ccf`
- 资产：版本名 zip + latest 别名 `docker-manager-yanzi-linux-x64.zip` + `quick-install.sh`

---

## v1.21.2 — 2026-09-19

> 本版**累积三批改动**：① 移除「在容器列表中显示」设置（09-17 打包，未发布）；
> ② `quick-install.sh` 下载进度（09-17，未发布）；③ 镜像更新检查接通 + 改名（09-19）。
> 前两批从未发布，故按项目「同发取最高级/未发布批次并入」惯例统一并入本版，**v1.21.2 一次发布**。

- **已完成**

  - **① 移除「在容器列表中显示」设置（彻底删除该功能）**：堆栈的 `settings.visible` 开关从全部 UI 下线，并清理底层字段。
    - **根因**：该设置**从未被实现**——后端只在 `server/docker.ts` 写入默认值 `visible: true`，
      容器列表（`Containers.tsx`）与任何接口都**不读该字段**。卡片上「关闭后，此堆栈的容器不会出现在容器管理页面」
      的描述与实际行为不符，属**误导性摆设**，故按「彻底删除」处理。
    - **改动点**：
      1. `src/pages/Stacks.tsx` — 编辑堆栈弹窗 → settings 页签内的整张设置卡片（标题 + 副标题 + `Toggle`）；
      2. `src/pages/Stacks.tsx` — 堆栈**右键菜单**「在容器列表中显示 / 隐藏」项（连同其前置分隔符）；
      3. `src/pages/Stacks.tsx` — 堆栈列表名称旁的 `EyeOff` 隐藏角标；
      4. `src/pages/Stacks.tsx` — 随之成为死代码的 `Eye` / `EyeOff` 图标 import；
      5. 字段定义与读写三处一并清除：`src/types.ts`（`StackSettings.visible`）、
         `src/transforms.ts`（API → 前端映射行）、`server/docker.ts`（堆栈默认 settings）。
    - **数据兼容**：旧堆栈 settings 中已落盘的 `visible` 键**惰性残留无害**（后端不校验字段白名单，
      读取端已不再引用），**无需迁移**；弹窗内 `settings` 状态仍以 `stack.settings` 初始化并原样回传，
      **不会导致其他设置项丢失**。
    - **验证**：双端 `tsc --noEmit` 全绿；`grep` 全量复检 `src/` + `server/` 中 `visible` / `EyeOff` 引用归零
      （其他页面里合法使用的 `Eye` 不受影响）；目标文案全量归零；打包后冒烟确认内嵌资产已无该文案。
    - 涉及文件：`src/pages/Stacks.tsx`、`src/types.ts`、`src/transforms.ts`、`server/docker.ts`。

  - **② 一键安装脚本展示实际下载进度（MB）**：`curl -fsSL .../quick-install.sh | sudo bash` 全程不再「静默卡住」。
    - **根因**：原脚本第 ~106 行 `do_download "$u" "$out" 2>/dev/null` 把 curl 的 **stderr 进度输出丢掉了**，
      无 TTY 时 curl 又不自绘进度条 → 下载 40MB 期间终端**零输出**，用户误以为挂死。
    - **改动点（`scripts/quick-install.sh`）**：新增 `size_of()` / `fmt_mb()` / `remote_size()`(HEAD 取 Content-Length)
      / `progress_text()` / `render_progress()`；`do_download()` 改为**后台 curl/wget `-s`/`-q` + 前台每秒轮询已下载字节**
      （退出码写临时文件回传），彻底移除 `2>/dev/null`。
      - TTY：单行 `\r` 原地刷新 `已下载 12.4 MB / 42.9 MB · 29% · 1.8 MB/s`；
      - 非 TTY（管道/CI）：每 10% 打一行，避免刷屏。
      - 开始时打印 `包大小: 42.9 MB`；结束时打印 `下载完成：42.9 MB，用时 23s，均速 1.8 MB/s`。
    - **顺带修掉一个真 bug**：`remote_size()` 原写成 `n="$(curl -fsIL … | awk …)"`，在 `set -euo pipefail` 下
      **HEAD 请求失败会直接中止整个安装脚本**。改为 `|| true` + case 兜底，失败时返回 `0`（进度退化为「已下载 x MB」）。
    - **验证**：本地 HTTP 桩（`python -m http.server` 供 35MB 文件 + shell 函数覆写 `curl`/`wget` 造慢速/失败场景）
      **35/35 PASS**，含 6 组场景与 1 组「不可达地址不得中止脚本」的回归守护。
    - 注意：该脚本由 Release asset（`/releases/latest/download/quick-install.sh`）分发，**不在 zip 内**，改它不需重打 zip。

  - **③ 镜像管理「检查更新」真正接通后端 digest 比对（原「没反应」）**
    - **根因**：`src/App.tsx` 的 `handleCheckAllUpdates` **从未调用任何后端检查接口**——只做了
      `fetchEngineImages()` 重新拉列表 + 重算关联容器，数据与原来完全一致。而真正的比对逻辑
      `server/docker.ts: checkAllImageUpdates()` 当时**只被 `server/scheduler.ts` 的定时任务调用**，
      `server/index.ts` 里**没有任何 HTTP 路由暴露它** → 点击必然「没反应」。
    - **连带发现**：① `checkAllImageUpdates` 返回的逐镜像 `details` 被 `runCheck()` **直接丢弃**，无落盘也无回传；
      ② 镜像列表**没有「有更新」展示位**（`DockerImage` 无 `hasUpdate`，表格无对应列）；
      ③ 单条镜像右键「检查更新」调的是**全局** `onCheckAllUpdates`，语义错误；④ 前端无任何结果反馈，失败静默。
    - **改动点**：
      1. `server/docker.ts` — `checkAllImageUpdates(engine, onlyRef?)` 支持**单镜像检查**；`ImageUpdateDetail`
         新增 `refs: string[]`（同一 digest 上的全部 `repo:tag`，解决**多 tag 镜像非首标签匹配不到**的问题）。
      2. `server/scheduler.ts` — 新增**镜像更新结果缓存**：`ImageUpdateCacheEntry` + `image-update-cache.json`
         （`loadImageCache` / `persistImageCache` / `saveImageCache(merge)`）；新增导出
         `checkEngineImages(engineId, onlyRef?)` 与 `getImageUpdateCache(engineId)`；`runCheck()` 顺带写入缓存
         （**定时调度与手动检查共用同一份数据**）。
      3. `server/index.ts` — 新增 `POST /api/engines/:id/images/check-updates`（body `{ref?}`，未连接/引擎不存在分别 500/404）
         与 `GET /api/engines/:id/images/update-status`（读缓存，未检查过返回 `null`）。
      4. `src/api.ts` / `src/types.ts` — 新增 `checkImageUpdatesApi` / `getImageUpdateStatusApi` 及
         `ImageUpdateDetail` / `ImageUpdateSummaryView` / `ImageUpdateStatusView`。
      5. `src/App.tsx` — `handleCheckAllUpdates` 改为真正调接口；新增 `handleCheckImageUpdate(ref)`；
         `toRefMap()` 把明细摊平成 `{repo:tag → 是否有更新}`；进入镜像页 / 切引擎时读缓存（不重跑比对）。
      6. `src/pages/Images.tsx` — 新增**「更新状态」列**（`有更新` 琥珀 / `最新` 绿 / `未检查` 灰，列顺序在「创建时间」之后）；
         顶部**汇总条**（有更新=琥珀、全部最新=绿、失败=红并显示原因）；右键菜单「检查更新」改为**按该镜像检查**。
    - **设计一致性**：`checkEngineImages` 返回的**始终是该引擎的全量视图**（单镜像检查也与缓存合并），
      前端**直接替换**、不做二次合并，避免前后端两套合并规则分叉。
    - **系统设置页改名**：`更新调度器` → **`镜像更新`**（侧栏页签 + 页标题；副标题补充「可在镜像管理页手动检查更新」）。
    - **顺带修掉一个真 bug**：`server/index.ts:177` 用了未加 `typeof` 保护的裸 `BUILD_BINARY`
      （该常量由 esbuild `define` 注入，仅打包时存在）→ **`npm run dev:server` / `dev:all` 直接 `ReferenceError` 崩溃**。
      已改为 `typeof BUILD_BINARY !== "undefined" && BUILD_BINARY`（与同文件 L98 一致；SEA 构建语义不变）。
    - **验证**：双端 `tsc --noEmit` 全绿（前端 `tsc` 当场抓出 `useEffect` 依赖数组在 `const` 声明前求值导致的
      TDZ 错误并已修正）；`npm run build` 通过。
      - 后端 **27/27 PASS**：① 路由/鉴权冒烟 8/8（未登录 401、引擎不存在 404「引擎不存在」、
        未连接 500「引擎未连接」、无缓存返回 `null`）；② 假 Docker API（本机无可用 Docker 引擎，
        用 `tcp://` 桩实现 `/_ping` `/version` `/images/json`）跑真实链路 **19/19 PASS**——
        本地构建镜像（无 RepoDigests）被跳过、`checked=2`、`refs` 带出全部标签、缓存落盘、
        单镜像检查合并后不丢其它镜像、无效 ref 报「不可检查」而非静默成功。
      - 前端**组件级浏览器验证**（真实 `Images` 组件 + 项目 Tailwind + Playwright，打桩 `fetch`）：
        **15/15 PASS、0 pageerror**。覆盖表头「更新状态」存在与顺序、5 行徽标逐行正确
        （含 nginx 同一 digest 两标签**均**显示有更新 = `refs` 摊平生效、悬空镜像=未检查）、
        汇总条文案与琥珀/红色配色、失败态仍正常渲染表格。
    - 涉及文件：`server/docker.ts`、`server/scheduler.ts`、`server/index.ts`、`src/api.ts`、`src/types.ts`、
      `src/App.tsx`、`src/pages/Images.tsx`、`src/pages/Settings.tsx`、`scripts/quick-install.sh`。

- **未完成 / 已知限制**
  - 「隐藏堆栈容器」若后续确需，须**重新设计**并在后端容器列表接口真正落地过滤逻辑（当前为纯 UI 摆设，无任何过滤实现）。
  - 镜像检查依赖各 registry 的**匿名 manifest 请求**：私有仓库 / 需鉴权的 registry 取不到远程 digest 时，
    该镜像**不计入 checked 且不进 details**（前端显示「未检查」，不误报为「最新」）——这是既有的保守行为，本次未改。
  - 远程 digest 请求固定走 `https://`，**不支持明文 HTTP 私有 registry**（既有实现，本次未改）。
  - `quick-install.sh` 的进度条**依赖服务端返回 `Content-Length`**；缺失时退化为「已下载 x MB」无总量/百分比。
  - 本机 Windows 无可用 Docker 引擎（socket 模式指向 `/var/run/docker.sock`），**真实 registry digest 拉取未在本地联网验证**，
    仅通过假 Docker API 验证到「明细/缓存/合并」链路；`hasUpdate` 的真假判定沿用 v1.15.16 起已在生产使用的同一函数。

- **已发布**：[v1.21.2 Release](https://github.com/yanziruxue/docker-manager/releases/tag/v1.21.2)；
  源码 commit `5c208d4ea8ac4c49bdc910eae871581461601d91`；交付包 `docker-manager-yanzi-linux-x64-v1.21.2.zip`
  （42,918,883 B，SHA-256 `0befb453dd4f925daa7e7457e179adf7b5099caf07d56727403461fae1dd6341`）；
  含 asset `quick-install.sh`（经 `/releases/latest/download/quick-install.sh` 分发，不在 zip 内）。
  后续可考虑把镜像更新结果接到通知中心（有更新时产生一条通知）。

---

## v1.21.1 — 2026-09-17

- **已完成**
  - **导入镜像显示进度**：上传 tar 导入镜像从「转圈等一个 JSON 响应」改为**两阶段实时进度 + 实时输出**。
    - **上传 tar 阶段（精确百分比）**：进度来自 `XMLHttpRequest.upload.onprogress` 的已上传字节 / tar 总字节。
      为此 `uploadImageApi` 从 `fetch` 换成 XHR —— **`fetch` 观测不到请求体上传进度**
      （`ReadableStream` 请求体 + `duplex:"half"` 在 Safari/Firefox 不可用）。
    - **导入（docker load）阶段**：服务端把 `docker load` 的输出**逐行随产随发**（NDJSON），前端在
      `readyState=3` 阶段增量读取 `responseText` 解析，实时显示层进度行与 `Loaded image: …`；
      能解析到字节时显示百分比（复用既有 `parsePullTailSizes`，同为 `<hash>: … MB/MB` 格式），
      **解析不到时显示不确定态条纹而不伪造百分比**（`docker load` 不预先公布层总量）。
    - **进度弹窗**：`ImageImportPanel`（`src/pages/Images.tsx`）——两阶段进度条 + 实时代码块输出 + 导入结果；
      终态显示「导入成功（镜像名）/ 导入失败（原因）」。原「结果弹窗 + 工具栏转圈」被其取代。
    - **可取消**：进行中提供「取消导入」，`AbortController` 中断上传 → 请求体中断 → 服务端随之结束
      `docker load` 子进程（沿用既有 `input.on("close")` 逻辑）。
    - 新增 `tailwind.config.js` 的 `indeterminate` 关键帧（不确定态进度条滑动条纹）。
    - 涉及文件：`server/docker.ts`、`server/index.ts`、`src/api.ts`、`src/pages/Images.tsx`、`tailwind.config.js`。
  - **上传更新包显示进度（系统设置 → 系统更新）**：本地更新包（.zip）上传从「转圈等一个 JSON 响应」改为**实时上传进度 + 文件大小**。
    - **上传进度条**：`uploadUpdateZipApi`（`src/api.ts`）从 `fetch` 换成 `XMLHttpRequest`——
      **`fetch` 观测不到请求体上传进度**（`ReadableStream` 请求体 + `duplex:"half"` 在 Safari/Firefox 不可用），
      改用 `XMLHttpRequest.upload.onprogress` 上报「已发送字节 / 总字节」，发送完毕后 `upload.onload` 拉满到文件总字节
      （规避个别浏览器 `lengthComputable` 缺失导致卡 99%）。
    - **UI**：`src/pages/Settings.tsx` 新增 `uploadProgress` / `uploadFileName` 状态；上传期间在「上传更新包」按钮下方
      显示蓝色进度条 + `文件名 · 已发送 MB / 总 MB · 百分比%`，完成后清空；401 仍派发 `auth:unauthorized` 并 reject。
    - **后端无需改动**：`POST /api/system/update/upload` 仍是 `express.raw` 缓冲整包，客户端 XHR 的 `upload.onprogress`
      直接测网络发送字节，与服务端接收解耦，与镜像导入上传同源模式。
    - 涉及文件：`src/api.ts`、`src/pages/Settings.tsx`。
  - **接口契约变更（`POST /api/engines/:id/images/load`）**：响应由「单个 JSON」改为**逐行 NDJSON**
    （请求体一边上传、`docker load` 一边解包，两者并发，只有随产随发才能呈现进度）：
    - `{"type":"progress","line":"…"}` / `{"type":"done","output":"…","images":[…]}` / `{"type":"error","error":"…"}`；
    - 响应头带 `Content-Type: application/x-ndjson`、`X-Accel-Buffering: no`（关反代缓冲，NAS 场景多为 nginx 反代）；
    - **取舍**：响应头一旦发出就无法再用 HTTP 状态码表达失败（与 `saveImageToFile` 同一取舍），
      因此**引擎不存在仍以 404 + JSON 在发头之前返回**，之后的一切失败走流内 `error` 事件；
    - `loadImageFromStream` 新增 `onOutputLine` 回调，且 **stdout / stderr 都接**——不同 docker 版本
      把 `Loading layer` 与 `Loaded image` 分别写在两个流上，只接一个会漏进度；行切分同时兼容
      `\n`（分层完成）与 `\r`（原地刷新进度条），并丢弃连续重复行。
  - **修复（本次实测踩到，已写入记忆）**：路由一度用 `req.on("close")` 判定「客户端断开」，
    但 Node 里**请求体读完后 `req` 同样会触发 `close`** → 所有进度被静默丢弃、响应体恒为空、
    请求挂到客户端超时。改为看**响应侧**状态：`res.on("close")` 中 `!res.writableFinished` 才算真断开，
    写前再判 `res.writableEnded || res.destroyed`。
  - **验证**：
    - 前后端 `tsc --noEmit` ✅。
    - 接口冒烟（esbuild 打包 `server/index.ts` 后跑真实服务）：未鉴权 → **401**；引擎不存在 →
      **404 + `application/json`**（发头之前）；真实上传 → **200 + `application/x-ndjson` + `chunked`**，
      流内先 `progress` 再 `error`（沙箱无 docker），**0.15s 返回**（修复前是挂满 25s 超时、响应体为空）；
      **慢速上传中途强制断开后进程存活、接口仍 200**（无 EPIPE / 无卡死）。
    - 前端组件级真实渲染（真实 `Images` 组件 + 项目 Tailwind CSS + Playwright/Chromium，
      以打桩 `XMLHttpRequest` 脚本化「上传进度 → docker load 输出 → 完成」全流程）：
      工具栏「上传镜像」✅、进度弹窗出现 ✅、两阶段进度条 ✅、上传百分比与字节 ✅、
      `docker load` 输出 tail 实时追加 ✅、终态「导入成功 + 镜像名」✅、无 JS 异常 ✅。
- **未完成 / 已知限制**
  - **沙箱无 Docker 守护进程 → 导入成功路径未实机联调**：`docker load` 真实输出的行格式
    （尤其非 TTY 下是否给出 `MB/MB` 字节）只在有 docker 的机器上才能最终确认；
    解析不到字节时会安全降级为不确定态条纹，不会显示错误的百分比。
  - **反代若缓冲响应体**（未透传 `X-Accel-Buffering` 的场景），进度会退化为「完成时一次性出现」；
    已做兜底：此时用最终合并输出补全 tail，不会出现输出区空白。
  - Windows 上本地开发时，`docker` 不存在会让 `cmd.exe` 以 **GBK** 输出错误信息，前端 tail 显示为乱码；
    这是既有现象（原先的结果弹窗同样如此），Linux 部署下 `docker` 输出为 UTF-8，不影响交付环境。
  - 导入失败后未提供「重试」（需重新选择文件）；如需可后续保留 `File` 引用实现。
- **发布记录**：已发布 [v1.21.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.21.1)（tag `89f4bc1473764223ee4bd0afe866b48083b8d645`）；资产 `docker-manager-yanzi-linux-x64-v1.21.1.zip`（42,917,760 B，SHA-256 `9d1ddc7c16a804d13cbf52b1e54721baf03ff11aba694582eeb757f7c84bfa3f`）+ 无版本别名 `docker-manager-yanzi-linux-x64.zip` + `quick-install.sh`。
- **下一步**：生产实测镜像「下载 → 上传」闭环与更新包上传进度，确认进度行格式。

## v1.20.0 — 2026-09-17

- **已完成**
  - **镜像导出（下载）**：镜像列表行内菜单新增「下载镜像」，把选中镜像导出为 tar（`docker save`）。
    - 后端新增 `saveImageToFile(engine, imageRef)`（`server/docker.ts`）+ `GET /api/engines/:id/images/save?image=<ref>`（`server/index.ts`）。
    - **先落地临时文件再 `res.download`，不直接 `docker save | res`**：直接流式下发时响应头已发出，`docker save` 失败（镜像不存在、daemon 不可达）只能表现为「下载到一半中断」，前端拿不到任何错误。落地后失败可回 JSON 错误。下载回调里清理临时文件。
    - **统一走 stdout 重定向，不用 `docker save -o <file>`**：SSH 引擎下 `-o` 是**远程**路径，文件会写到远端机器上，本地拿不到。
    - 前端走既有的 `downloadAsBlob()`（fetch → Blob → objectURL），与备份下载同一条鉴权链路，失败能弹出可读错误；不使用 `<a href="/api/...">` 顶层导航（失败零反馈）。
  - **镜像导入（上传）**：工具栏新增「上传镜像」，选择 `docker save` 导出的 tar 后导入该引擎（`docker load`）。
    - 后端新增 `loadImageFromStream(engine, input)` + `POST /api/engines/:id/images/load`。
    - **请求体直接管道进 `docker load` 的 stdin，不用 `express.raw` 缓冲**：镜像 tar 动辄数百 MB~数 GB，全量进内存会打爆服务端（`express.json` 默认上限仅 100kb，走 `application/octet-stream` 也会被绕过/拒绝）。前端显式声明 `Content-Type: application/octet-stream` 以保证不被 `express.json` 处理。
    - 客户端中途断开（`input` 未正常 `end`）时主动结束子进程，避免 `docker load` 一直等 stdin。
    - 导入结果通过既有 `CmdOutputModal` 展示 `docker load` 原始输出（含 `Loaded image: …`）。
  - **镜像拉取失败可重试**：拉取任务条与拉取结果弹窗在 `status === "error"` 时显示「重试」按钮，直接用失败任务的镜像名重新发起拉取（无需重新输入）。
    - 前端实现，复用既有 `startImagePullApi`；`startPull()` 增加 `imageOverride` 参数供重试直接调用。
    - 重试/拉取动作补写操作日志（成功/失败）。
  - **三种引擎连接统一收敛**：新增 `buildEngineDockerCmd(engine, dockerArgs)`，把「在指定引擎上跑一条 docker 子命令」的三种连接方式（socket / tcp / ssh）集中到一处，供 save/load 共用（避免各写一套分支）。
    - SSH 远程命令对**每个参数单独引号包裹**，避免镜像名中的特殊字符被远程 shell 解释；key 认证写临时私钥并追加 `BatchMode=yes`（私钥不可用时立即失败，不卡在密码提示）；password 认证用 `sshpass` 喂密码，**缺 sshpass 直接报错**（不做无声回退，避免「点了没反应」）。
    - 涉及文件：`server/docker.ts`、`server/index.ts`、`src/api.ts`、`src/pages/Images.tsx`。
  - **验证**：
    - 后端 `tsc --noEmit` ✅、前端 `tsc --noEmit` ✅。
    - 接口冒烟（esbuild 打包 `server/index.ts` 后跑真实服务）：未鉴权 `save` → **401**；缺 `image` 参数 → **400**（`镜像名不能为空`）；导出/导入在 docker 不可用时均返回**结构化 JSON 500**（含 `stderr` 原文），**不挂起**（`--max-time` 未触发）；`2MB` 流式 body 成功穿透到 `docker load`（未被 JSON 中间件拦截/413）。
    - 前端组件级真实渲染（用 esbuild 把**真实的 `Images` 组件**打包成静态页 + 项目自身 Tailwind CSS，Playwright + Chromium 驱动，`fetch` 打桩返回「失败 + 进行中」两条拉取任务）：工具栏「上传镜像」✅、`input[type=file]` 存在 ✅、失败任务条「重试」✅、进行中任务「取消」✅、行内下拉「下载镜像」✅（且保留「拉取 / 检查更新」）✅、无 JS 异常 ✅。
- **未完成 / 已知限制**
  - **本沙箱无 Docker 守护进程（`docker` CLI 亦不可用），save/load 的成功路径未实机联调**：仅验证了接线、鉴权、参数校验与失败路径。生产部署后需实测「下载 → 上传」闭环（建议用一个中小镜像，如 `hello-world`）。
  - SSH **password 认证**引擎依赖远端/本机 `sshpass`：缺失时导入/导出会明确报错（拉取路径此前已有同样的回退策略）。**SSH 引擎的 save/load 未实测**。
  - 上传接口未设体积上限（管理员专用接口 + 流式，不占内存）；如部署在受限反代后，需注意反代的请求体上限配置。
  - 导入未做「tar 是否为 docker 镜像」的事前校验，交由 `docker load` 判定（错误信息已提示「请确认上传的是 docker save 导出的 tar」）。
- **打包记录（2026-09-17，未发布）**
  - 交付包：`build-upload/docker-manager-yanzi-linux-x64-v1.20.0.zip`
    - 体积 **42,913,448 B**（40.9 MB），SHA-256 `e2940442179bf67100a5251f8b0b4b7f5c8500618ec45200498ba36f35e39099`
    - 同时输出无版本别名 `docker-manager-yanzi-linux-x64.zip`（兼容旧脚本）
  - 包内 5 个文件（权限位已归一）：`docker-manager-yanzi`(0o755) / `install.sh`(0o755) / `uninstall.sh`(0o755) / `docker-manager-yanzi.service`(0o644) / `README.md`(0o644)
  - 构建链：`vite build`（`index-DwNqWGHK.js` / `index-DOHv4ZsK.css`）→ `build-binary.mjs`（bundle.js 4,789,927 B）→ SEA blob → postject 注入（ELF magic `7f 45 4c 46` ✅）
  - 验证：前后端 `tsc --noEmit` ✅；前端新文案「上传镜像 / 下载镜像 / 重试」在 `dist/assets/index-DwNqWGHK.js` 命中；后端标识符 `images/save`、`images/load`、`saveImageToFile`、`loadImageFromStream`、`buildEngineDockerCmd`、版本号 `1.20.0` 在 bundle.js 命中；bundle.js 对 `index-DwNqWGHK.js` / `index-DOHv4ZsK.css` 各引用 1 次（确认打进的是本次新构建的前端，非旧 dist）。
  - ⚠️ 上一版的 `docker-manager-yanzi-linux-x64-v1.19.1.zip` 已被本包取代，若确认不再需要可删除（`deploy/linux/` 与 `build-upload/` 各一份，二者均已在 `.gitignore` 中）。
- **下一步**：发布 v1.20.0（推源码 + GitHub Release），发布后补 Release 链接、`main` commit SHA 与包 SHA-256；生产实测镜像「下载 → 上传」闭环。

## v1.19.1 — 2026-09-16（未发布，已并入 v1.20.0 一起打包）

- **已完成**
  - **修复 YAML / ENV 编辑器「高亮层与文字/选区错位」**（用户提供界面截图反馈：编辑器内出现白色方块切断选区、文字重影、长行行尾部错位）。
    - **根因一：两层排版参数不一致 —— `tab-size`。** `<textarea>` 显式设了 `tabSize: 2`，而 `<pre>` 高亮层从未设置，沿用浏览器默认 **8**。两层对同一个制表符的换算宽度差 6 列，含 `\t` 的行（`command:`、粘贴的外部 compose 等）字形相对光标/选区逐 tab 累加漂移。**实测同一行 2 个 `\t`：`<pre>` 用默认值渲染 221.58px，按正确值只有 135.81px，差 85.77px。**
    - **根因二：滚动同步依赖对方的可滚动范围。** `syncScroll()` 用 `pre.scrollTop/scrollLeft = ta.scrollTop/scrollLeft` 事后同步，而两者是**相互独立的滚动容器**：`<textarea>` 出现占位滚动条（竖向占用 `clientWidth`、横向占用 `clientHeight`）后其可滚动范围与 `<pre>`（`overflow:hidden`，不预留）不一致，赋值会被**钳位**在更小的最大值上 → 高亮文字与光标/选区横向错开约一个滚动条宽度、行号列在滚到底时整体错行。
    - **修复**：
      1. `<pre>` 补齐与 `<textarea>` **完全相同**的排版参数：`tabSize: 2` + `fontVariantLigatures: "none"` + `fontKerning: "none"`（后两项一并补齐，避免连字/字距微调引入亚像素差）；`<pre>` 改 `overflow-visible`（由外层 `overflow-hidden` 容器裁剪，不再依赖自身滚动范围）。
      2. 滚动同步改为 CSS **`transform` 平移**：`<pre>` 用 `translate(-scrollLeft, -scrollTop)`，行号列新增内层容器做 `translateY(-scrollTop)`。平移量与 `<textarea>` 滚动量严格相等，**与两端可滚动范围无关，结构上不可能被钳位**。
      3. 内容变化后（换行/删除会改变 `scrollTop`，且旧 `transform` 已过期）用 `requestAnimationFrame` 重新对齐一次。
    - **同步修复 `EnvEditor`**（同一套「透明 textarea + `<pre>` 高亮层」方案，存在完全相同的问题）。
    - 涉及文件：`src/components/YamlEditor.tsx`、`src/components/EnvEditor.tsx`。
  - **验证（组件级真实浏览器实测，非静态审查）**：用 esbuild 把**真实的 `YamlEditor`**（含项目自身 Tailwind 产物 CSS）打包成静态页，Playwright + Chromium 驱动：
    - 「复制 `<textarea>` 的 computed style 渲染同段文本 → 与 `<pre>` 逐行比对渲染宽度」：**40 行全部 0.00px 差**（含 3 行带 `\t` 的行）；`tabSize` 两层均为 2。
    - **对照实验**：把 `<pre>` 的 `tab-size` 强行改回 8（= 修复前状态），3 个含 tab 行立刻出现 **-45.70 / -91.41 / -45.70 px** 偏差 —— 直接证明该参数就是错位来源之一。
    - **滚动对齐**：容器收窄至 `clientWidth 490 / scrollWidth 968` 触发真实横向滚动（`scrollLeft = 478`），`<pre>` 的 `transform = translate(-478px, 0px)`，首字形坐标 **-462 与期望 -462 完全一致**（误差 0）；行号列偏移 0。
- **未完成 / 已知限制**
  - 未在真实弹窗（新建/编辑堆栈对话框）中做端到端手测，验证在独立组件验证台上完成（复用组件本身与项目 CSS，未修改验证对象）。
  - 勾选/选中时 `<textarea>` 仍会用「选中前景色」把被选文字重绘一遍（浏览器既有行为），与背后的高亮层叠加 —— 两层对齐后不再产生可见重影；未额外关闭该重绘。
  - `YamlEditor` 无固定高度（`minHeight` 仅为下限），当前布局下纵向滚动实际不触发（实测 `clientHeight == scrollHeight == 824`），行号列的 `translateY` 属纵深防御。
- **下一步**：随下次打包发布并入交付包。

## v1.19.0 — 2026-09-16

- **已完成**
  - **活跃度上报端点改为 `https://docker-yanzi.ziruxue.top`（连字符域名）**（用户要求）。
    - 后端 `server/telemetry.ts` 的 `TELEMETRY_ENDPOINT` 常量更新；同步移除 `server/settings.ts` 中 `DEFAULT_SETTINGS.telemetry` 块、`src/types.ts` 的 `TelemetryConfig` 类型与 `SystemSettings.telemetry` 字段。注意与旧 `docker.yanziruxue.top`（点域名）的差异——曾因点/连字符混淆导致一次替换失配。
    - 涉及文件：`server/telemetry.ts`、`server/settings.ts`、`src/types.ts`。
  - **遥测配置写入代码、页面不再暴露**（用户要求：不在页面修改、不显示「遥测设置」「上报状态」）。
    - `readConfig()` 改为硬编码 `{ enabled: true, endpoint: TELEMETRY_ENDPOINT, collectHwFingerprint: true }`，不再读 `getSettings()`；上报随活跃事件静默触发，不依赖本地配置开关。
    - 前端移除「概览（安装/活跃统计）」「上报状态」「遥测设置」三张卡片；`src/components/ActivityPanel.tsx` 重写为只读「本机设备标识」卡片，去掉 `telemetry/onPatch/onAfterSave` 三个 prop；`src/pages/Settings.tsx` 移除 `telemetry` 本地 state、初始化块与校验（含 URL 校验），标签「活跃度」→「本机设备」。
    - 涉及文件：`server/telemetry.ts`、`src/api.ts`、`src/types.ts`、`src/components/ActivityPanel.tsx`、`src/pages/Settings.tsx`。
  - **本机设备标识升级为 7 维硬件指纹，≥3 项匹配即认定硬件环境未变**（用户要求）。
    - `server/telemetry.ts` 新增 `DeviceHardware`（系统 / CPU / GPU / 内存容量+序列号 / 硬盘 UID / 主板序列号 / 设备 UID）、`collectHardwareAttrs()`、`countMatches()`、`isEnvUnchanged()`。设备 UUID 仍为统计主键，但其稳定性改由硬件环境连续性决定：无历史 → 新 UUID；有历史且 7 维中 ≥3 匹配 → 沿用旧 UUID；否则（<3 匹配）视为换机 → 重新生成。
    - GPU 采集 `lspci -nn`（VGA/3D/Display）→ `nvidia-smi` 兜底；内存容量取 `os.totalmem()` + `dmidecode` 序列号；全 0 序列号归零。`TelemetryStatus` 重构为 `{ uuid, virtualized, createdAt, appVersion, osVersion, arch, deviceFile, envUnchanged, matchCount, hardware }`。
    - `src/api.ts` 同步 `DeviceHardware` 与 `TelemetryStatus`；`ActivityPanel` 只读展示 7 维 + 「硬件环境：未变化/已变化（N/7 项匹配）」。
    - 涉及文件：`server/telemetry.ts`、`src/api.ts`、`src/components/ActivityPanel.tsx`。
  - **系统升级支持中途取消**（用户要求）。
    - `server/updater.ts` 新增 `cancelRequested` 标志 + `cancelUpdate()` + 内部 `resetCancel()/finalizeCancel()`；`performUpdate` / `performUpdateFromUpload` 开头复位；下载循环逐 chunk 轮询取消（命中即 `reader.cancel()` 停止读取并丢弃分片），`applyLocalZip` 在解压前 / 解压后 / 替换前三个安全点再次校验，命中即清理临时目录、状态回 `idle`、**不替换二进制、不重启进程**，可重新发起更新。新增 `POST /api/system/update/cancel` 路由；`src/api.ts` 新增 `cancelUpdateApi`；更新页进度卡在 downloading/extracting/replacing 阶段显示「取消升级」按钮。
    - 涉及文件：`server/updater.ts`、`server/index.ts`、`src/api.ts`、`src/pages/Settings.tsx`。
  - **从备份恢复支持直接上传备份文件**（用户要求）。
    - `server/backup.ts` 新增 `restoreUploadedBackup(buf)`：校验 zip 魔数/长度 → 落盘临时文件 → 解包 → 校验 `manifest.json` 的 `app === "docker-stack-manager"`（拒绝非本应用归档）→ 复用新抽出的 `applyRestoreFromStaging()` 恢复 → 清理临时文件。新增 `POST /api/backups/restore-upload`（`express.raw`，上限 300MB）；`src/api.ts` 新增 `restoreUploadedBackupApi`；备份管理页新增「上传备份并恢复」按钮（带覆盖确认）。
    - 顺带把 `copyTree` 从 `backup.ts` 导出（供 `docker.ts` 复用递归复制）。
    - 涉及文件：`server/backup.ts`、`server/index.ts`、`src/api.ts`、`src/pages/Settings.tsx`。
  - **新建堆栈支持上传堆栈备份初始化**（用户要求）。
    - `server/docker.ts` 新增 `createStackFromBackup(engine, buf, targetName)`：校验 zip → 解包 → 定位内部堆栈目录（唯一子目录优先 / 多目录按名匹配 / 兼容扁平备份）→ 读取 compose → 按目标名校验（复用命名规则 + 重复检测）→ `copyTree` 整体复制（含 env、图标、name/description）到 `COMPOSE_DIR/<name>/`。新增 `POST /api/engines/:id/stacks/from-backup`（`express.raw` + `?name=`，注册在通配堆栈操作路由之前）；`src/api.ts` 新增 `createStackFromBackupApi`；`CreateStackModal` 新增「堆栈备份」方法页（选名称 + 选 .zip），方法网格 `grid-cols-3` → `grid-cols-2 sm:grid-cols-4`。
    - 涉及文件：`server/docker.ts`、`server/index.ts`、`src/api.ts`、`src/pages/Stacks.tsx`。
  - **验证**：前后端 `tsc --noEmit` 全绿；`vite build` 通过（1604 模块）。
- **未完成 / 已知限制**
  - 遥测新端点 `docker-yanzi.ziruxue.top` 在开发沙箱内不可达（HTTP 000），未能实机联调；上报为 fire-and-forget，若端点路径不符会静默 404，部署后可在后端日志/统计端确认。
  - 旧 `settings.json` 中残留的 `telemetry` 键不再被读写，属惰性字段（未做迁移剥离）。
  - 升级取消主要覆盖下载阶段；解压（`spawnSync` 同步）与替换为瞬时窗口，命中率有限但已保证「取消即不替换、不退出」。
- **下一步**：观察生产端遥测上报是否命中新端点（后端日志 / 统计服务端）；如需支持「换机后沿用旧 UUID」的人工绑定，再评估。
- **发布记录**（2026-09-16）
  - Release：[v1.19.0](https://github.com/yanziruxue/docker-manager/releases/tag/v1.19.0)
  - 源码 commit：`8fd33d5a4699b6cb0a6383fe4b9cc0b04f6f0b99`（`main`）
  - 交付包：`docker-manager-yanzi-linux-x64-v1.19.0.zip`（42,909,800 B；SHA-256 `a7641c8eb9b1d91b6a78550ba4d7bc97d8cc58d9a9dde8aaf41ca978acf30f2f`）
  - 发布前验证：前后端 `tsc --noEmit` 全绿；`vite build`（1604 模块）；ELF magic `7f 45 4c 46`；bundle 内含 `1.19.0` / 新端点 / `system/update/cancel` / `restore-upload` / `from-backup`；内嵌前端为新构建资产 `index-BV7tYWfk.js`（含「本机设备标识 / 硬件环境」，无「遥测设置 / 上报状态」）；bundle 实跑冒烟：`/api/system/version`=1.19.0、`/api/telemetry/status` 返回 7 维 `hardware` + `envUnchanged/matchCount`、`POST /api/system/update/cancel` 返回「已请求取消升级」、两个上传接口对非 zip 数据正确拒绝（HTTP 400）。

---

## v1.18.3 — 2026-09-16

- **已完成**
  - **系统设置「菜单显示语言」默认值改为中文**（用户要求）。
    - 改动两处默认值 `"en"` → `"zh"`：`server/settings.ts` 的 `DEFAULT_SETTINGS.docker.menuLanguage`（服务端权威默认）+ `src/pages/Settings.tsx` 设置页本地初始 `data.docker.menuLanguage`（服务端数据未到达前的初始值）。其余回退点本就是 `"zh"`（`App.tsx` 的 `|| "zh"`、Stacks 组件默认参数 `menuLanguage="zh"`），无需改。未动 `DEFAULTS_VERSION`，避免触发「列布局」一次性迁移重置。已装实例因 v1.9.2 迁移已存 `menuLanguage=zh`，不受影响。
    - 涉及文件：`server/settings.ts`、`src/pages/Settings.tsx`。
  - **推荐加速源新增两条 1Panel 公益镜像源**（用户要求）。
    - `src/pages/Settings.tsx` 的 `RECOMMENDED_MIRRORS` 数组新增 `https://docker.1panel.live`（1Panel 镜像）与 `https://hub.1panel.dev`（1Panel Hub 镜像）；原 `https://docker.1ms.run` 已在列表、不重复添加。点击「推荐加速源」按钮时按 URL 去重，已存在的不会重复填入。
    - 涉及文件：`src/pages/Settings.tsx`。
  - **修「容器管理」多选后的批量按钮全部失效**（用户反馈：批量启动 / 停止 / 删除点了没反应）。
    - 根因：`src/pages/Containers.tsx` 的批量操作条里「批量启动 / 停止 / 重启 / 更新 / 删除」五个 `<button>` **完全没有 `onClick`**，纯静态按钮；且「批量更新」根本无对应后端 API（死按钮）。
    - 修法：新增 `batchAction(action)`（遍历 `selected` 调 `containerActionApi` 做 start/stop/restart，汇总成功/失败写操作日志 + 刷新）与 `batchDelete()`（遍历 `selected` 调 `removeContainerApi(id, true)` 强制删除含运行中的容器，执行后清空选择 + 刷新）；给「批量启动 / 停止 / 重启 / 删除」接上 `onClick`，**移除无 API 的「批量更新」死按钮**；新增「批量删除」`ConfirmDialog` 二次确认弹窗（防误删）。`selected` 存 `container.id`，与 `toggleSelect(container.id)` 一致。
    - 涉及文件：`src/pages/Containers.tsx`。
    - 附注：堆栈管理的批量按钮（`src/pages/Stacks.tsx` 782-786 行）在源码里 `onClick` 已接好、后端 `/api/engines/:id/stacks/batch/:action` 完整可用；若部署实例上也不生效，是 v1.18.2 二进制落后于源码，本次重建一并修正。
  - **发布**：源码 `main` @ `c0bf26e4b86a1f6db11cad7e1c12316a30935f21`；Release [v1.18.3](https://github.com/yanziruxue/docker-manager/releases/tag/v1.18.3)；asset = 版本化 `docker-manager-yanzi-linux-x64-v1.18.3.zip` + latest 别名 `docker-manager-yanzi-linux-x64.zip` + `quick-install.sh`；交付包 42,908,910 B / SHA-256 `21b1f5c10c9bbf7eecbc328eadc3a657341506d705bcb5d51b0b6321e7c50585`（旧包 v1.18.2 已从 `build-upload/` 清除）。
  - **验证**：前后端 `tsc --noEmit` 全绿；`vite build` 通过（1604 模块）。
- **未完成 / 已知限制**：无。
- **下一步**：无。

---

## v1.18.2 — 2026-09-15

- **已完成**
  - **修 `fix-perms` / `permission-check` 在 SEA 二进制下完全不生效**（用户反馈：执行后反而启动服务并 `EADDRINUSE` 崩溃）。
    - 根因：`server/index.ts` 的 CLI 分支按**固定下标**取参数（`process.argv.slice(1)` 首项）。而 SEA 单文件模式下 `argv = [exe, exe, ...用户参数]`——`argv[1]` 是 exe 自身路径而非子命令，于是命令名匹配失败，代码一路走到启动 HTTP，与已在 5024 端口运行的服务抢端口 → `EADDRINUSE` 崩溃。开发模式（`node dist/index.js`）布局又不同，写死下标必然顾此失彼。
    - 修法：**不按下标猜，改为扫描 argv**——跳过 exe 自身路径、脚本路径、任何含路径分隔符的项，取第一个已知子命令（`fix-perms` / `permission-check` / `--version` / `-v` / `version`）；第一个非路径 token 若不认识（如 `--path`）则判定为非 CLI 模式，交回服务启动流程。同时兼容 `./docker-manager-yanzi fix-perms` 与 PATH 直呼 `docker-manager-yanzi fix-perms`（后者 argv 里只有 basename、不含斜杠）。
    - 涉及文件：`server/index.ts`（CLI 分支重写）。
  - **修「左下角版本号停在上一版」**（用户反馈：更新页显示 v1.18.1、左下角显示 v1.18.0）。
    - 根因一：`server/serve-embedded.ts` 给包括 `index.html` 在内的所有内嵌资源统一加了 `Cache-Control: public, max-age=3600`。OTA 换完二进制后，浏览器 1 小时内不会重新请求 `index.html`，继续跑旧前端 bundle。→ **改为**：`index.html`（含 SPA fallback）下发 `no-cache, must-revalidate`；`assets/*` 文件名带内容 hash，保留 `max-age=3600`。
    - 根因二：左下角读的是**前端构建期注入的常量** `__APP_VERSION__`，而非真实运行的二进制版本。→ **改为**：`App.tsx` 登录后拉取 `/api/system/version` 并存 `runtimeVersion`，通过新 prop 传给 `Sidebar`，侧栏优先展示运行时版本、缺失才回退构建期常量。两者不一致的窗口被彻底消除。
    - 涉及文件：`server/serve-embedded.ts`、`src/App.tsx`、`src/components/Sidebar.tsx`。
  - **备份目录固定为 `<data>/backups`，移除「备份目录」设置项**（用户要求：写死，不允许自定义目录；旧备份自动迁移）。
    - 根因：旧 `resolveBackupDir()` 只认**绝对路径**，而 `settings.backup.backupPath` 的默认值偏偏是相对名 `docker-compose-backup-manager`，UI 提示却写着「相对路径可用」——三者互相矛盾，填任何相对值都被**静默忽略**、永远掉回 `<data>/backups`，表现为「目录写死且不可控」。
    - 修法：`resolveBackupDir()` 固定返回 `<DATA_DIR>/backups`，不再读取该设置；新增 `migrateLegacyBackups()` **在启动阶段把历史备份迁进来**（来源：旧 `backupPath` 解析值、`<data>/docker-compose-backup-manager`、`<安装目录>/docker-compose-backup-manager`；仅迁移 `.zip` / `.tar.gz` / `.tgz`，**同名不覆盖**，单份失败不影响其余，整体异常只告警不阻断启动）。设置字段标记 `@deprecated` 保留兼容，UI 输入框**彻底移除**（不再有任何可编辑入口）。
    - 涉及文件：`server/backup.ts`、`server/index.ts`、`server/settings.ts`、`src/types.ts`、`src/pages/Settings.tsx`。
  - **备份区 UI：周备 / 月备 / 年备 / 执行时序总览 四张卡片合并为一张**（用户要求）。
    - 合并为 `三级备份策略（周 / 月 / 年）`：每级为一段——标题行（图标 + 名称 + 「保留 N 份」或「未启用」标签 + 启用开关），展开后是原参数区（日期 / 时间 / 保留份数），三段之间用分隔线隔开，禁用时不再显示整块「已禁用」占位。
    - 卡片底部保留「执行时序总览」小节，改为**三列横排**紧凑卡片（原来三行竖排）：启用中显示具体时间与保留策略，未启用显示「未启用」并置灰；冲突规则说明保留为一行小字。信息量不变，纵向空间约为原来的 40%。
  - **发布**：源码 `main` @ `db560570`（95 文件）；Release [v1.18.2](https://github.com/yanziruxue/docker-manager/releases/tag/v1.18.2)；asset = `docker-manager-yanzi-linux-x64-v1.18.2.zip` + `quick-install.sh`；交付包 42,907,426 B / SHA-256 `99a3de26ec34bf339c3e1cc7666fe5d1164a4fde74e592b0e361319c6dfaba3f`（旧包 v1.18.1 已从 `build-upload/`、`deploy/linux/` 清除）。
  - **验证**：前后端 `tsc --noEmit` 全绿；`vite build` 通过。CLI 解析用**真实打包产物 + 模拟 argv** 覆盖 4 种形态（`SEA 绝对路径` / `SEA ./ 相对` / `PATH basename` / `dev 脚本路径`）——均正确命中子命令并退出；对照组「无子命令」正常启动服务，证明分支判定有效。备份目录实测：`<data>/docker-compose-backup-manager` 下的历史 zip **已自动迁移**到 `<data>/backups`，旧目录清空。打包产物冒烟：`index.html` 响应头为 `no-cache, must-revalidate`、`assets` 为 `max-age=3600`、`/api/system/version` 返回 `1.18.2`、未授权 401、首页引用前端产物 `index-1IG2zrDd.js`。前端 bundle 中「备份目录」0 命中、旧卡片标题 0 命中、「三级备份策略」1 命中（确认合并与移除均已落包）。
- **未完成 / 已知限制**：SEA 二进制的 CLI 行为无法在本机（Windows）直接执行验证——Linux ELF 二进制跑不起来，故采用「同一份源码 + 模拟 SEA argv 布局」验证，等价性由 argv 布局分析保证；真实 Linux 上执行 `sudo <exe> fix-perms` 仍建议首次加 `--dry-run` 观察输出。备份迁移只认 `.zip` / `.tar.gz` / `.tgz` 三种扩展名，手工放在历史目录里的其他格式文件不会被搬运。
- **下一步**：无。

---

## v1.18.1 — 2026-09-14

- **已完成**
  - **修「复制」按钮在 HTTP 部署下点了没反应**（用户反馈）。
    根因：`navigator.clipboard` **只在安全上下文**（HTTPS 或 `localhost`/`127.0.0.1`）存在。本项目是纯 HTTP 部署（`http://<IP>:5024`，后端无任何 TLS），从局域网 IP 打开时该属性是 `undefined`；而代码一律写作 `navigator.clipboard?.writeText(...)`，**可选链把「能力缺失」当作正常情况静默跳过**——不抛异常、控制台无报错、界面无提示，表现为「点了不管用」。
    - 新增 `src/lib/clipboard.ts`：`copyText(text)` 三级降级并**必定返回布尔值**（① `navigator.clipboard.writeText` → ② 隐藏 `<textarea>` + `document.execCommand("copy")`，HTTP 下依然可用 → ③ 返回 `false` 由调用方提示手动复制）；另提供 `selectNodeText(el)` 兜底选中文本。
    - 全前端 **7 处**同类调用全部替换（原为 6 处 `?.` 静默 + 1 处 try/catch）：`src/pages/Settings.tsx` 4 处（权限修复命令、daemon.json 权限提示、特权提示、备份跳过面板）、`src/components/ActivityPanel.tsx`（复制 UUID）、`src/components/CmdOutputModal.tsx`（复制命令输出）、`src/pages/Stacks.tsx`（复制转换结果）。**每处都带可见反馈**（成功「已复制」/ 失败「已选中，请 Ctrl+C」或 toast 提示），不再静默。
  - **权限面板简化为「一条命令」**（用户要求：只需要一个命令、检查并修复；不需要「复制修复命令」「复制全部命令」两个按钮）。
    - 移除逐条的「复制修复命令」与底部的「复制全部命令」，面板只保留：跳过项列表（相对路径 + 原因）+ **一条命令** + 「重新检测」。
    - 新增 `server/perms.ts: fixCommandLine()`：SEA 二进制下用 `process.execPath` 输出**真实绝对路径**的 `sudo <exe> fix-perms`（路径含空格自动加引号）；源码直跑时退化为占位符。刻意用不带 `--dry-run` 的 `fix-perms`——它先体检再修正，即「检查并修复一步完成」。
    - 该命令由服务端下发，避免前端硬编码安装路径：`POST /api/backups` 与 `GET /api/system/permission-check` 新增 `fixCommand` 字段（后者原 `advice` 字段移除）；`perms-cli.ts` 的 `permission-check` 输出也改为打印这一条命令。
    - `deploy/linux/README.md` 权限章节改写：主路径为一条命令，`--dry-run` / `--normalize-mode` / `--path` / `permission-check` 降为可选参数。
  - **验证**：前后端 `tsc --noEmit` 全绿；`vite build` 通过；`fixCommandLine()` 单测 4/4 PASS（dev 占位符 / SEA 绝对路径 / 不含 `--dry-run` / 含空格加引号）；实测 `POST /api/backups`、`GET /api/system/permission-check` 均返回 `fixCommand` 且未授权 401；前端产物中 `execCommand` 兜底与新文案均已落包，`复制修复命令`/`复制全部命令` 文案 **0 命中**（确认已移除）。
  - **发布前冒烟（跑打包产物 `bundle.js`，非源码）**：起服务 5095 → 首页引用的前端产物为 `index-RX3Jjis8.js`、内容含 `execCommand` 兜底（确认 SEA 包内嵌的是新版前端）→ 备份/体检接口返回 `fixCommand` → 未授权 401。测完停进程、清临时目录与 `smoke.cjs`/`_cookies.txt`。
  - **发布**：源码 `main` @ `4cb4d402`（95 文件）；Release [v1.18.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.18.1)；asset = `docker-manager-yanzi-linux-x64-v1.18.1.zip` + `quick-install.sh`；交付包 42,906,537 B / SHA-256 `b2bb5dec5beb713764cdb1a485bd846f7efe8476998f29d1b6f856b679d227b1`（旧包 v1.18.0 已从 `build-upload/`、`deploy/linux/` 清除）。
- **未完成 / 已知限制**：`document.execCommand("copy")` 已被标准废弃（浏览器仍支持），属兜底手段；若连它也失败，界面会选中文本并提示手动 `Ctrl+C`。真实「非安全上下文」行为无法在本地开发环境复现（本地走 `localhost` 属安全上下文），需在局域网 IP 访问下验证。
- **下一步**：无。

---

## v1.18.0 — 2026-09-14

### 新增：权限诊断与修复（备份不再只报一句 EACCES）

- **背景**：生产上「立即备份」跳过 `qinglong/.stack-meta.json（EACCES）`。提示只有一个错误码，看不出是**权限位**问题还是**属主**问题，也没有任何修复手段。诊断结论：备份链路里只有「读源文件」这一步需要源文件读权限——目标端 `/tmp` 暂存由本进程新建，写与清理都有 `chmodTree()` / `rmrf()` 兜底，因此 EACCES 必然来自**源文件对运行用户不可读**。
- **已完成**：
  - 新增 `server/perms.ts`：权限诊断（`lstatSync` 取 mode/uid，只需父目录 `x` 位）、`/etc/passwd` 解析用户名（`nologin` 专用用户也能显示名字，不依赖 `getent`）、自愈 `tryGrantOwnerRead()`、只读体检 `scanPermIssues()`、修复执行器 `fixPerms()`。
  - 新增 `server/perms-cli.ts` + `server/index.ts` 顶部 CLI 分支：`fix-perms` / `permission-check` / `--version`。
    - **默认只修正属主，不改动权限位**（避免把 `0600` 的密钥文件放开成 `0644`）；需要归一化时显式 `--normalize-mode`。
    - 支持 `--dry-run` / `--path <目录>` / `--uid <数字>` / `--help`。
  - `server/backup.ts`：**备份期自愈（L1）**——遇 EACCES 且属主是当前用户时，补 `u+r` 后重试一次（只加属主读位，group/other 位与 uid/gid 一律不动）；失败项生成结构化 `skippedDetails`（权限位 / 属主 / 目标 uid / 原因 / **可直接复制的修复命令**），并把日志升级为单行完整诊断。
  - 接口：`POST /api/backups` 新增 `skippedDetails` 与 `fixed`；新增 `GET /api/system/permission-check`（只读体检，结果缓存 60s，`?refresh=1` 绕过）。
  - 启动时执行一次**只读权限体检**，发现属主/权限异常即打 WARN 并给出一键修复命令（`setImmediate` 延后，不拖慢启动）。
  - 设置项 `backup.autoFixReadPerm`（默认开，设置页可关）；`settings.ts` 归并 `backup` 子对象，旧配置无该字段时按默认值补齐。
  - 前端：备份卡片新增**权限提示面板**（逐条展示剩余路径 / 原因 / 「复制修复命令」/「复制全部命令」/「重新检测」），并提供自愈结果提示（`已自动补正属主读权限 N 项`）。
- **关键坑（务必保留）**：`sudo` 执行时 `process.getuid()` 是 **0**，若直接拿它当目标属主，会把整个数据目录 `chown` 给 root，服务反而彻底读不了。因此目标属主判定为：非 root 运行时取自己的 uid；root 运行时取 `DATA_DIR` / 安装目录的属主；并提供 `--uid` 显式覆盖。另：SEA 以 **CJS** 打包（`format: "cjs"`），CLI 必须全同步，不能引入顶层 await。
- **验证**：前后端 `tsc --noEmit` 全绿；`vite build` 通过；端到端脚本覆盖「`--version` / `permission-check` / `fix-perms --dry-run` / 自愈后备份成功 / `skippedDetails` 结构 / 未授权 401」。
- **未完成 / 已知限制**：`fix-perms` 仅适用于 Linux 部署（Windows 无 POSIX 属主模型，命令会提示并直接返回）；属主漂移到其他用户（如 root）时应用无权修正，必须由用户用 `sudo` 执行；ZIP 不支持 socket / fifo / 设备文件（既有行为，未变）。
- **发布**：[Release v1.18.0](https://github.com/yanziruxue/docker-manager/releases/tag/v1.18.0)；源码 `main` @ `ee1ea304`（94 文件）；asset `docker-manager-yanzi-linux-x64-v1.18.0.zip`（42,904,669 B / 40.9 MB / 5 文件；SHA-256 `21897bc37cfd5fdedfcc3be153b959474c1c432cf7e33d6d88d5a8dac49c798e`）+ `quick-install.sh`。
- **验证补充**：`server/perms.ts` 单元测试 **15/15 PASS**（`modeString` / `currentUser` / `userNameOf` / `diagnosePerm` 的 self 与 parent 两条分支 / `formatIssue` 无 `uid N(uid N)` 冗余 / `isPermError` / 非 POSIX 平台 `scanPermIssues` 静默与 `tryGrantOwnerRead` 安全拒绝 / `fixPerms` 统计结构）；CLI 实测 `--version`→`1.18.0`、`fix-perms` 在 Windows 正确提示、`permission-check` 输出结构正常；服务端实测备份返回 `skippedDetails`/`fixed`、`GET /api/system/permission-check` 通过、未授权 401。**Windows 无 POSIX 权限语义，真实 EACCES 路径只能在 Linux 复现**，本地以单元测试覆盖诊断分支（属主不一致 / 缺读位 / 父目录缺 x）。
- **下一步**：无。

---

## v1.17.3 — 2026-09-14

### 变更：备份包格式改用 zip + 修复「立即备份」EACCES 报错

- **背景**：生产上点「立即备份」报 `EACCES, Permission denied '/tmp/dsm-backup-XXXX/dockercompose/<stack>'`。根因二重：
  1. `fs.cpSync` 会把**源目录的权限位原样复制**到 `/tmp` 暂存目录——某些堆栈目录是 0555（只读）时，暂存副本同样只读，随后 `finally` 里的 `fs.rmSync` 抛 EACCES；
  2. 该清理调用**没有被 try/catch 保护**，于是一个「清理失败」把整个备份请求变成 500（实际备份包可能已经生成），且报错指向 `/tmp` 暂存路径，完全看不出真正原因。
- **已完成**：
  - 新增 `server/zip.ts`：**零依赖** ZIP 读写（仅用 `node:zlib`，可被 esbuild 打进 SEA 单文件）。写入端归一化权限（目录 0755 / 文件 0644 / 符号链接 0777），读取端校验 CRC 并阻断路径穿越（`..`、绝对路径）。
  - `server/backup.ts`：全量备份 / 自动备份 / 配置导出改产 `.zip`（`all_*.zip`、`auto-<key>_*.zip`、`config-export_*.zip`）；`stageConfig()` 改为**逐个堆栈复制并隔离错误**——单个堆栈因权限/损坏失败只跳过它并记入 `skipped`，不再整体失败；新增 `chmodTree()`（递归修正暂存目录权限）与 `rmrf()`（清理失败先修权限重试、再失败仅告警，**绝不影响备份结果**）。
  - 新增 `copyTree()` 递归复制（**替换 `fs.cpSync`**）：Node v22.22.2 在 Windows 上对**含非 ASCII 字符的源目录名**做递归 `cpSync` 会直接段错误（实测「只读栈」这类名字必崩，生产 Linux 不受影响，但本地开发/预览会整个进程挂掉）。自研实现同时做到逐文件错误隔离 + 权限归一化。
  - `server/docker.ts`：堆栈级备份改产 `<stackName>_<ts>.zip`（归档内以堆栈名为顶层目录，与旧行为一致），恢复按扩展名分支。
  - **兼容旧备份**：`listBackupFiles()` / `pruneBackups()` 同时识别 `.zip` 与 `.tar.gz`；`restoreFullBackup()` / `restoreStack()` 对 `.tar.gz` 仍走 tar 解包。历史备份不会失效。
  - `server/index.ts` / `src/api.ts` / `src/pages/Settings.tsx`：`POST /api/backups` 返回 `skipped`，界面在有跳过项时提示具体堆栈名（而不是静默成功）。
  - 顺带修复：`/api/backups/export` 下载后只删了归档**文件**，专属临时**目录**（`/tmp/dsm-export-*`）从未清理，长期在 `/tmp` 里堆积空目录；现改为整目录删除。
- **验证**：前后端 `tsc --noEmit` 全绿；`vite build` 通过；本地 zip 端到端测试 **23/23 PASS**（全量/自动/导出产 zip、恢复往返内容一致、中文目录名、只读 0555 堆栈不报 EACCES、历史 tar.gz 可列出与恢复、路径穿越被拦截且未落盘、暂存目录无残留）。SEA 打包 + 双验证（ELF magic + 版本号）。
- **未完成 / 已知限制**：ZIP 不支持 socket / fifo / 设备文件（这类条目跳过，Compose 场景无影响）；单个文件不可读时只跳过该文件并计入 `skipped` 提示（会在界面上列出具体路径，避免静默出残缺备份）。
- **发布**：[Release v1.17.3](https://github.com/yanziruxue/docker-manager/releases/tag/v1.17.3)；源码 `main` @ `839e0e6b`（91 文件）；asset `docker-manager-yanzi-linux-x64-v1.17.3.zip`（42,894,578 B / 40.9 MB / 5 文件；SHA-256 `0f6c343283ef8fda1e4447884a8ce268d2b39b1420d55ef977febea62571d8ee`）+ `quick-install.sh`。发布前用**打包产物 bundle.js** 做过冒烟：认证 OK、「立即备份」返回 `all_*.zip` 且 `skipped: []`、列表/下载正常、未授权 401；同时清理了 `deploy/linux/` 下 v1.17.0/1.17.1/1.17.2 三个旧交付包（前两个含蓝奏云代码）。
- **下一步**：无。

---

## v1.17.2 — 2026-09-14

### 移除：蓝奏云 OTA 更新源（OTA 回归 GitHub 单一源）

- **背景**：v1.17.0 引入「蓝奏云优先」、v1.17.1 降级为「备用源」，但生产环境两次实测均未走通（文件夹页解析 / `ajaxm.php` 直链签名未取到）。且蓝奏云失败会被 `checkForUpdate` 静默吞掉、表现为「无更新」，排障成本高且误导。
- **已完成**：
  - 删除 `server/lanzou.ts`（文件夹页解析、`filemoreajax.php` 密码提交与 Cookie 透传、`ajaxm.php` 直链解析、流式下载）。
  - `server/updater.ts`：移除蓝奏云 import 与 `logger`；`checkForUpdate()` 简化为直接调用 `checkGitHubUpdate()`（**GitHub 为唯一更新源**）；`performUpdate()` 删除蓝奏云下载分支，回归「直连 + gh-proxy 镜像回退」；`UpdateInfo` 去掉 `source` 字段。
  - `src/types.ts`：`UpdateInfo` 同步去掉 `source`；`src/pages/Settings.tsx`：移除「蓝奏云 · 备用源 / GitHub · 主源」来源标签。
  - 顺带修复：`checkGitHubUpdate()` 选取 asset 的正则 `/linux-x64\.zip$/i` 匹配不到版本化包名（`…-linux-x64-vX.Y.Z.zip`），已放宽为 `/linux-x64.*\.zip$/i`。
- **保留**：zip 交付包版本化命名（`docker-manager-yanzi-linux-x64-v<version>.zip`）及其 `.gitignore` 规则。
- **验证**：前后端 `tsc --noEmit` 全绿；SEA 打包 + 双验证（ELF magic + 版本号）。
- **未完成 / 已知限制**：无。蓝奏云相关环境变量（`LANZOU_UPDATE_URL` / `LANZOU_FOLDER_PWD`）随之失效。
- **发布**：[Release v1.17.2](https://github.com/yanziruxue/docker-manager/releases/tag/v1.17.2)；源码 `main` @ `29ba234f`；asset `docker-manager-yanzi-linux-x64-v1.17.2.zip`（SHA-256 `4b53549b…a4cc`）+ `quick-install.sh`。同时清理 `build-upload/` 内含蓝奏云代码的旧包（v1.17.0 / v1.17.1）。
- **下一步**：无。

---

## v1.17.1 — 2026-09-14

### 调整：OTA 改为「GitHub 主源 + 蓝奏云备用源」，备用源主动参与检查

- **背景**：v1.17.0 引入「蓝奏云优先」OTA，生产环境实测未生效（蓝奏云文件夹解析/直链未走通）。
- **已完成**：`server/updater.ts` 的 `checkForUpdate()` 重构为「主源 + 备用源」：
  - **主源 GitHub**：查到可用更新即直接采用（不再请求备用源，省时）；
  - **备用源蓝奏云**：主源**无更新**或**不可用**时再查 —— 备用源有更新则采用，否则沿用主源结论；
  - 两源均失败时抛 GitHub 的错误（主源，便于定位）。
  - `performUpdate()` 仍按 `info.source` 分支下载，无需改动；更新页来源标签显示「GitHub · 主源 / 蓝奏云 · 备用源」。
- **保留**：`server/lanzou.ts`、`UpdateInfo.source`、zip 交付包版本化命名（`…-v<version>.zip`）。
- **验证**：前后端 `tsc --noEmit` 全绿。
- **未完成 / 已知限制**：蓝奏云链路仍未在生产验证成功；作为备用源，主源正常但无更新时会被查询。
- **下一步**：无。

---

## v1.17.0 — 2026-09-14

### 新增：蓝奏云 OTA（国内备用更新源）+ zip 交付包版本化命名

- **已完成**：
  - 新增 `server/lanzou.ts`：`LANZOU_FOLDER_URL`（写死 `https://yanziruxue.lanzoum.com/b0he7aaxc`，可用 env `LANZOU_UPDATE_URL` 覆盖）与 `LANZOU_FOLDER_PWD` 密码常量（可 env 覆盖）；`resolveLanZouUpdate()` 从「文件夹分享页」列出全部 zip → 按文件名 `-vX.Y.Z` 取语义版本最高 = 最新版 → 经 `ajaxm.php` 解析真实直链；`downloadLanZou()` 流式下载。带密码文件夹会向 `filemoreajax.php` 提交 `pwd` 并全程透传鉴权 Cookie（列表页 → 文件页 → 直链）。
  - `server/updater.ts`：`UpdateInfo` 增加 `source: "github" | "lanzou"`；`performUpdate()` 按 `source` 分支下载。
  - `deploy/linux/make-package.py`：交付包名加 `-v<version>`；`scripts/publish-release.mjs` 同步。
  - `src/types.ts` / `src/pages/Settings.tsx`：更新页显示「蓝奏云 / GitHub」来源标签。
- **验证**：前后端 `tsc` 全绿；SEA 打包 + 双验证（ELF magic + 版本号）通过。
- **未完成 / 已知限制**：蓝奏云直链解析受其页面改版影响，生产实测未走通（v1.17.1 已改回 GitHub 优先）。
- **下一步**：见 v1.17.1。

---

## v1.16.2 — 2026-09-13

### 修复：「系统设置」角标提示有更新，但「系统更新」页空白（须手动点检查更新才显示）

- **问题**：侧边栏「系统设置」显示红色角标「1」（代表检测到可用更新），但进入「系统设置 → 系统更新」页却什么都不显示，必须点一次「检查更新」才出现更新卡片。
- **根因**：更新信息存在**两份互不相通的状态**——
  - `App.tsx` 在登录后自动检查一次（受「自动检查更新」开关控制），用它驱动侧边栏角标（`appUpdateAvailable: boolean`）；
  - `Settings.tsx` 自己另有一份 `updateInfo: UpdateInfo | null`，初值 `null`，**只有** `handleCheckUpdate()` 会赋值。
  于是角标有提示、页面却空白；两份状态还会在「忽略版本 / 更新完成」时各清各的。
- **已完成**：把更新信息提升为 **App 单一数据源**（`appUpdateInfo: UpdateInfo | null`），角标与更新页共用同一份。
  - `src/App.tsx`：`appUpdateAvailable` 由布尔改为 `appUpdateInfo`（`appUpdateAvailable = !!appUpdateInfo?.hasUpdate` 派生，角标逻辑不变）；自动检查命中后 `setAppUpdateInfo(show ? info : null)`（被忽略的版本仍回 `null`，角标与更新页同时隐藏）；向 `Settings` 传 `updateInfo` + `onUpdateInfoChange`。
  - `src/pages/Settings.tsx`：移除本地 `updateInfo` state，改为受控 prop（`updateInfo` / `onUpdateInfoChange`）；「检查更新」「忽略版本」「更新完成」三处改为回调父级写入；`handleCheckUpdate` 不再在开始前清空 `updateInfo`（避免侧边栏角标闪烁），改由 `checking` 态提示进行中。
- **验证**：前后端 `tsc --noEmit` 全绿（EXIT=0）；代码链路核对 —— 侧边栏 `updateAvailable={appUpdateAvailable}` 与 `Settings updateInfo={appUpdateInfo}` 同源，均为 `App` 的 `appUpdateInfo`。
- **未完成 / 已知限制**：
  - 仅当「自动检查更新」开启时，进入页面才会**免点击**展示（该开关在截图中为开启状态）；关闭时仍需手动点「检查更新」——与角标行为保持一致。
  - 既有行为（非本次引入）：「忽略版本」写入的 `ignoredVersion` 需点 APPLY 保存后才持久化，未保存时下一轮「自动检查」可能再次提示。
- **下一步**：无。

---

## v1.16.1 — 2026-09-13

### 修复：备份文件无法下载（下载链路改为 Blob 取回）+ 堆栈级备份目录/tar 跨平台修正

- **问题（"备份后的备份无法下载"）**：
  - 前端「下载此备份」「导出全部配置」用的是 `<a href="/api/backups/...">` **直连顶层导航**。该写法一旦失败（401 / 500 / 反向代理拦截 / 被嵌在 iframe 沙箱中禁止下载）浏览器**不会给出任何提示**，用户体感就是"点了没反应"，且与项目其它下载（容器 CSV 导出走 fetch → Blob）实现不一致。
  - `server/docker.ts` 的 `restoreStack` 仍硬编码 `DATA_DIR/backups`，与 `resolveBackupDir()`（尊重 `settings.backup.backupPath`）不同步 —— 配置了自定义备份目录后，**堆栈恢复会找不到刚备份出的文件**。
  - `docker.ts` 的堆栈备份/恢复用 `run()`（内部 `shell: true`）调 tar：绝对路径会经 shell 转义被破坏；GNU tar 还会把 `-f C:\...` 的冒号误判为远程主机。
- **已完成**：
  - `src/api.ts`：新增 `downloadBackupApi` / `exportConfigApi`，内部走 `fetch(credentials: "include") → Blob → objectURL`，并解析 `Content-Disposition` 取真实文件名；失败时抛出带后端错误文案的 `ApiError`（401 时照旧派发 `auth:unauthorized`）。与容器 CSV 导出统一为同一套下载范式。
  - `src/pages/Settings.tsx`：`handleDownloadBackup` / `handleExportConfig` 改为 async，**成功/失败均有 toast**（失败会显示后端原因）；备份列表下载项下载期间转圈并禁用，避免重复点击。
  - `server/docker.ts`：`restoreStack` 改用 `backupFilePath()`（统一目录 + 防路径穿越）；`backupStack`/`restoreStack` 的 tar 调用统一改用 `backup.ts` 导出的 `runTar()`（`shell:false`）。
  - `server/backup.ts`：tar helper 由私有 `tar` 改为导出 `runTar`，并在内部把 `C:\...` 形式的绝对路径统一转正斜杠 —— 修复 Git/mingw 的 GNU tar 把 `-C C:\a\b` 重复转义成 `C\:\\a\\b` 而报 `Cannot open` 的问题（Linux 下为 no-op）。全项目 tar 调用点收敛到一处。
- **验证**：
  - 前后端 `tsc --noEmit` 全绿。
  - 用 esbuild 打包真实 `server/index.ts`（`BUILD_BINARY=false`）起独立实例 + 真实会话 Cookie 实测：登录 → 立即备份（630B）→ 下载返回 `HTTP 200` + `Content-Disposition: attachment` + 有效 gzip；`tar -tzf` 内容为 `dockercompose/<stack>/{docker-compose.yaml,name}` + `data/engines.json` + `manifest.json`；无会话下载返回 **401**；导出接口 200/599B。
  - 堆栈级备份/恢复端到端：建备份 → 删除堆栈目录 → 恢复 → compose 与 `.env` 内容完整还原。
  - 全量备份回归：create / list / prune（保留最新 N、其它前缀不动）/ 路径穿越拦截 / export / restore / delete 全部通过。
- **未完成 / 已知限制**：
  - 备份文件名时间戳为**秒级**（`tsCompact()`），同一秒内对同一 `kind+tag` 连续备份会**同名覆盖**（前端按钮已禁用，正常操作不会触发；未改文件名格式以免影响 `backupLabel` 解析）。
  - 远端（SSH/TCP）引擎的堆栈级备份仍不支持（堆栈目录不在本机），已有明确提示。
  - 若部署实例仍是旧版本（≤ v1.15.20 未含 `/api/backups/:name/download` 路由），需先升级才可下载。
- **下一步**：无。
- **发布记录（2026-09-13）**：
  - Release [v1.16.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.16.1)（**合并 v1.16.0 + v1.16.1 说明**；assets：`docker-manager-yanzi-linux-x64.zip` + `quick-install.sh`）。
  - 源码 commit：`main` @ [`cfe79caa`](https://github.com/yanziruxue/docker-manager/commit/cfe79caa1eed3a4af92060a55ff239760f2aeb7f)（基线 `243c89e5` → 本次 90 文件）。
  - 交付包 SHA-256：`946648a81cc638f96db9478541c650dbfc8ad2215384b66c08d29e250f1a2d7e`。

---

## v1.16.0 — 2026-09-13

### 备份功能完整修复：接活死按钮 + 全量备份/恢复/导出 + 自动备份调度器

- **问题（"备份不管用"根因）**：
  1. 设置页「立即备份 / 从备份恢复 / 导出全部配置」三个按钮**没有任何 `onClick`**（`Settings.tsx`），点了完全没反应。
  2. 自动备份**后端从未实现**：`autoBackupEnabled / weekly / monthly / yearly / simpleFrequency` 只存在于设置项；`server/scheduler.ts` 仅做镜像更新检查；`lastBackup` 全项目无写入点。
  3. `settings.backup.backupPath` 被忽略：`backupStack` 硬编码 `DATA_DIR/backups`。
  4. 堆栈级备份在**远程（SSH/TCP）引擎**上必失败（用本地 `fs`/`tar` 处理远程路径，报"堆栈目录不存在"）。
  5. 顺带发现：`startUpdateScheduler()` 一直被 import 但**从未调用**，镜像更新调度器从未真正启动。
- **改动**：
  - 新增 `server/backup.ts`（统一备份模块）：`createFullBackup`（打包 `dockercompose` 全部堆栈 + `config/settings.json` + `data/engines.json` + `active_engine.json` + `manifest.json`）、`restoreFullBackup`、`exportConfigArchive`、`listBackupFiles`、`deleteBackupFile`、`backupFilePath`、`pruneBackups`；`resolveBackupDir()` 尊重 `backupPath`（**绝对路径**生效，否则默认 `<data>/backups`）。tar 以「相对归档名 + `cwd=归档目录`」调用，规避 GNU tar 对 `C:\` 冒号的远程主机误判。
  - `server/index.ts`：新增 `POST /api/backups`（立即备份）、`POST /api/backups/:name/restore`（全量恢复）、`GET /api/backups/:name/download`（下载单个备份）、`GET /api/backups/export`（导出配置归档，下载后清理临时文件）、`GET /api/backup-scheduler/status`；`GET/DELETE /api/backups` 改走新模块；**`startUpdateScheduler()` + `startBackupScheduler()` 在 `listen` 回调中真正启动**。
  - `server/scheduler.ts`：新增自动备份调度器 —— mode 1 按 `weekly/day+time`、`monthly/dayOfMonth+time`（0=月末）、`yearly/MM-DD+time` 计算下次执行；mode 2 支持五段 Cron（通配/单值/列表/区间/步长）；到期创建 `auto-<key>_<ts>.tar.gz` 并按各档 `retention` 清理同前缀历史包；状态落盘 `backup-scheduler-status.json`。
  - `server/docker.ts`：`backupStack` / `restoreStack` 改用 `resolveBackupDir()`；远程引擎给出明确提示「远程引擎（ssh/tcp）暂不支持备份」；移除已迁移的 `listBackups` / `deleteBackup`。
  - `src/api.ts`：新增 `createBackupApi` / `restoreBackupApi` / `backupDownloadUrl` / `exportConfigUrl`。
  - `src/pages/Settings.tsx`：接活三个按钮（立即备份带 loading、恢复带选择弹窗与二次确认、导出下载）；新增「备份目录」输入项；备份列表支持**下载单个备份**、标签按 `手动全量备份 / 自动备份(key) / 堆栈名` 区分；「上次备份时间」改由列表最新一条推导；移除「备份目录不能为空」的过时校验（留空即默认目录）。
- **验证**：
  - 前后端 `tsc --noEmit` 全绿（EXIT=0）。
  - `server/backup.ts` 端到端冒烟（真实 tar，临时 DATA_DIR）：手动/自动备份生成、`pruneBackups` 保留清理、路径穿越拦截、导出归档生成、从备份恢复、删除 —— **全部通过**。
  - 调度器时间/cron 纯函数单测（抽取源码 + esbuild 转译 + data-URL 执行）：**13/13 PASS**（周/月/年下次时间、`0 3 * * 0` 与 `30 10 * * *` 下次时间、cron 字段通配/步长/区间/列表解析）。

- **未完成 / 已知限制**：
  - 恢复会覆盖 `dockercompose` 与 `settings.json` / `engines.json`，**引擎列表与设置的运行时生效需刷新页面 / 重启服务**（页面已提示刷新）。
  - 备份为「Compose 堆栈 + 应用配置」级全量，**不含镜像/容器/数据卷内容**（数据卷内容需另作文件级备份）。
  - 自动备份仅在服务运行期间按分钟评估；服务停机期间错过的时点不会补跑（只补跑一次最近到期项）。
- **下一步**：无。

---

## v1.15.22 — 2026-09-12

### 顶栏刷新按钮视觉反馈 + 删除页内冗余刷新按钮

- **问题**：顶栏「刷新」按钮（`TopBar.tsx`）虽绑定 `loadEngineData` 真实拉取全量数据，但点击后图标静止、无 loading 态，体感像「假的」；同时数据卷管理页（`Volumes.tsx:291`）还有一个独立「刷新」按钮，调用的是同一个 `loadEngineData`，与顶栏功能完全重复（不是「只刷本页」的差异化实现）。
- **改动**：
  1. 删除 `src/pages/Volumes.tsx` 顶部独立的「刷新」按钮（`onClick={onRefresh}`），并移除其独占的 `RefreshCw` 引入（避免未用告警）。`onRefresh` 属性仍保留并继续供「新建数据卷」弹窗创建后刷新列表使用（属操作后回调，非冗余可见按钮）。
  2. `src/components/TopBar.tsx` 新增 `refreshing?: boolean` 属性；刷新时图标加 `animate-spin`、按钮 `disabled` + `opacity-50` + `cursor-not-allowed`，`title` 切换为「刷新中…」。
  3. `src/App.tsx` 向 TopBar 传入 `refreshing={dataLoading}`（`loadEngineData` 执行期间 `dataLoading` 为 true，刷新完成归 false）。
- **范围说明**：`Containers` / `Stacks` / `Images` 页虽也接收 `onRefresh`，但仅作为弹窗/表单「操作后刷新列表」回调（新建、编辑、pull 等），并非独立可见刷新按钮，故**保留不动**；各页的「批量更新 / 检查更新 / 更新」等为独立业务按钮（pull 镜像等），亦保留。
- **验证**：前后端 `tsc --noEmit` 全绿（EXIT=0）；Grep 确认 `Volumes.tsx` 已无可见「刷新」按钮、`TopBar` 已含 `animate-spin` + `disabled` 分支。

- **未完成 / 已知限制**：未选引擎（`activeEngineId` 为空）时点击仍静默无操作（不旋转、无提示），因 `loadEngineData` 提前返回；如需空引擎提示可后续补 toast（本次未做，避免超出范围）。
- **下一步**：无。

---

## v1.15.21 — 2026-09-12

### 认证界面 `*` 必填标识范围界定

- **最终口径（经用户确认）**：
  - **登录主表单**（`用户名` / `密码`）—— **不显示 `*`**；
  - **初始设置向导**（`用户名` / `密码` / `确认密码`）—— **显示 `*`**（保留）；
  - **找回密码表单**（`用户名` / `找回码` / `新密码` / `确认新密码`）—— **显示 `*`**（保留）。
- `FormField`（`src/components/UI.tsx:371`）在 `required` 为 true 时渲染 `<span className="text-red-500">*</span>`；本次仅对登录主表单去掉 `required`，其余两处保持 `required`。必填校验逻辑全部不变（`submit()` 内仍拦截空值/格式/长度/一致性）。
- 涉及文件：`src/components/auth/LoginPage.tsx`（登录主表单去 `required`；找回密码表单保持）、`src/components/auth/SetupWizard.tsx`（保持）。
- **验证**：`tsc --noEmit` 前后端全绿（EXIT=0）；Grep 确认登录主表单 2 处 `FormField` 无 `required`，找回密码表单 4 处、初始设置向导 3 处保留 `required`。

- **未完成 / 已知限制**：无。
- **下一步**：无。

---

## v1.15.20 — 2026-09-12

### 一键填入模板：新增 environment / volumes 位置 + 自动缩进

- **新增两个填入位置**：系统设置 → Compose 管理 → 一键填入模板，位置选项由 3 种扩展为 5 种 —— **services 下 / environment 下 / volumes 下 / 指针处 / 末尾**。
- **「服务内」改名为「services 下」**，语义不变（services 下第一个服务内部）。
- **自动缩进**：填入时按目标层级自动重排缩进，无需在模板里手工敲空格 —— `services 下` 缩进 **4 空格**、`environment 下` 与 `volumes 下` 缩进 **6 空格**。实现上先去掉模板自身的最小缩进（保留块内相对层级），再统一加目标缩进；且**随文档实际缩进自适应**（如服务名缩进 4 的文档，属性自动给 6、子项给 8）。
- **父键自动创建**：目标服务没有 `environment:` / `volumes:` 键时，自动创建该键（服务属性层级）再插入子项。
- **行内写法保护**：`environment: {}` 这类行内写法无法追加子项，给出明确提示而非产出非法 YAML。
- **去重**：目标块内已存在完全相同的首行内容时跳过并提示。
- 涉及文件：`src/types.ts`（新增 `ComposeInsertPosition` 类型）、`src/lib/compose-template.ts`（**新建**：位置选项 + `normalizeInsert` + `insertPositionLabel` 共享给设置页与堆栈页）、`src/pages/Stacks.tsx`（`insertTemplateBlock` 重写 + `reindentBlock`）、`src/pages/Settings.tsx`、`server/settings.ts`（默认值 `service`→`services`，归一化迁移旧值）。
- **验证**：前后端 `tsc --noEmit` 全绿；逻辑单测 **19/19 PASS**（抽取 `Stacks.tsx` 真实源码经 esbuild 转译执行，含 end / cursor / 旧值 `service` 兼容回归）。

### 登录页 UI 调整

- 移除「用户名」「密码」标签右上角的 `*` 必填标识（仍保持必填校验，只是不再显示星号）。
- 登录卡片下方新增一行说明：`docker-manager-yanzi · 本地部署`（与找回密码页底部提示同款样式）。
- 涉及文件：`src/components/auth/LoginPage.tsx`。
- **验证**：`tsc --noEmit` 通过。

- **未完成 / 已知限制**：无。
- **下一步**：无。

---

## v1.15.19 — 2026-09-12

### 一键填入模板新增「指针处」填入位置

- **新增第三个位置**：系统设置 → Compose 管理 → 一键填入模板，填入位置由「服务内 / 末尾」扩展为「服务内 / **指针处** / 末尾」。
- **指针处**：插入到 Compose 编辑器光标（鼠标指针）所在行的**下一行**，缩进沿用模板自身的写法（与其它两种模式一致，不做强制缩进改写）。
- **值补全**：从光标位置向上推断所属服务名，模板中留空的 `container_name:` 等仍自动补全为当前服务名；光标停在服务名行本身时同样能识别。
- **未定位光标时**：从未点击过编辑器就点击「指针处」模板，提示「请先在编辑器中点击，定位要填入的位置」，不会误插到首行。
- **全部填入**：多个「指针处」模板连续填入时，插入位置随已插入行数递进，顺序与模板列表一致（不会倒序叠加）。
- 涉及文件：`src/types.ts`、`server/settings.ts`（模板归一化须放行 `cursor`，否则保存后被降级为 service）、`src/components/YamlEditor.tsx`（新增 `onCursorLineChange` 上报光标行）、`src/pages/Stacks.tsx`、`src/pages/Settings.tsx`。
- **验证**：前后端 `tsc --noEmit` 全绿；逻辑单测 9/9 PASS（抽取 `Stacks.tsx` 真实源码经 esbuild 转译执行，含 service / end 回归）。
- **未完成 / 已知限制**：无。
- **下一步**：无。

---

## v1.15.18 — 2026-09-10

### 会话超时改为绝对过期（到点自动退出）

- **修正语义**：「会话超时（分钟）」现在表示**登录时长上限**——自登录成功起算，满设定时长即失效并要求重新登录，**无论期间有无请求**，任何请求都不再续期。
- **服务端**（`server/auth.ts`）：`expiresAt` 在创建会话时固定为「登录时刻 + 超时」，鉴权时只做到期判断；移除 v1.15.17 引入的滑动续期与 Cookie 重复下发逻辑。
- **前端**（`src/App.tsx`）：新增会话心跳（每分钟探测 `/api/auth/me`）。即使页面静止、无任何业务请求，超时后也会自动回到登录页；仅明确的 401 触发登出，网络抖动或后端重启不会误判。
- **保留**：会话跨重启持久化（`sessions.json`，仅存 token 的 SHA-256 摘要）；重启后按**原到期时间**继续计时，不重置也不延长。
- **说明**：修改「会话超时」设置对当前已登录会话不生效，下次登录起生效。

---

## v1.15.17 — 2026-09-10

### 会话超时改为滑动过期 + 会话跨重启持久化
- **背景**：会话采用「内存 Map + 登录时一次性设定绝对过期」——①从登录起满 N 分钟必掉线，**与用户是否活跃无关**；②应用重启（OTA / 系统重启 / 崩溃重启）即清空全部会话。表现为「**未到设定的会话超时时间仍被要求重新登录**」。
- **改动**（`server/auth.ts` 重构）
  - **滑动过期（空闲超时语义）**：`getSessionUser()` 命中有效会话时把 `expiresAt` 续期为 `now + TTL`；`requireAuth()` 节流（≥60s）重下发 Cookie 同步 `maxAge`。→ 只要 TTL 分钟内有任意 `/api` 请求（容器列表 / 统计轮询天然触发）就保持登录；**停止访问满 TTL 分钟才过期**。
  - **跨重启持久化**：会话落盘 `<data>/sessions.json`，**键为 token 的 SHA-256 摘要**（内存与磁盘均不含明文 token），存 `tokenHash / userId / expiresAt`；模块加载时恢复未过期会话、丢弃过期项。→ 应用重启（含 OTA）后**免重新登录**。
  - **TTL 读取加 5s 缓存** + 导出 `invalidateSessionTtlCache()`；`server/index.ts` 的 `PUT /api/settings` 保存后调用 → 改「会话超时」**立即生效**（此前只对新登录生效）。
  - 写盘节流 30s（滑动续期高频，避免频繁 IO）；登出 / 创建会话 / 过期清理时立即写盘。
- **版本判定**：会话机制的行为修复与健壮性增强，非新功能模块 → **Patch**。
- **校验**：前端 + 后端 `tsc --noEmit` 全绿；`npm run build:frontend` 通过。
- **注意**：滑动过期下，只要页面开着且仍有接口轮询，会话就不会过期；关闭页面停止请求后，才会在设定的分钟数后过期。

## v1.15.16 — 2026-09-10

### 更新调度器落地为真实后台定时检查
- **背景**：原「更新调度器」仅有前端配置（Cron 字符串），后端无执行逻辑，且页面展示的检查时间 / 更新统计为硬编码假数据。本次完善为真正可按计划定时检查所有镜像版本的后台调度器。
- **改动**
  - `server/settings.ts`：`updateScheduler` 默认值改为 `{enabled:true, mode:"daily", hour:1, minute:0, dayOfWeek:1, dayOfMonth:1, autoPull:false}`（**默认开启，每天凌晨 1 点**）；旧 `checkFrequency`(Cron) 配置迁移为新模式（保留 enabled/autoPull，频率近似映射到每天 3:00）。
  - `src/types.ts`：`UpdateSchedulerConfig` 改为 `mode/hour/minute/dayOfWeek/dayOfMonth`，新增 `SchedulerStatus` / `SchedulerLastResult` / `SchedulerEngineResult`。
  - `server/docker.ts`：新增 `checkAllImageUpdates(engine)`（遍历镜像、按 RepoDigest 与远程 registry manifest digest 比较）+ `fetchRemoteDigest(ref)`（Docker Hub 带匿名 token；其他 registry 匿名优先、遇 401 按 WWW-Authenticate 取 token 重试；网络/超时跳过）。本地构建镜像（无 RepoDigests）跳过；多 tag 同 digest 去重。
  - `server/scheduler.ts`（新）：`startUpdateScheduler()` 每 60s 评估一次是否到检查时刻，按 `mode/hour/minute/dayOfWeek/dayOfMonth` 计算下次执行；`runSchedulerCheckNow()` 立即检查；`getSchedulerStatus()` 返回 lastCheck/nextCheck/统计；结果持久化到 `data/scheduler-status.json`。检查到更新且 `autoPull` 开启时自动拉取。
  - `server/index.ts`：注册 `GET /api/update-scheduler/status`、`POST /api/update-scheduler/check-now`；`server.listen` 后启动调度器。
  - `src/api.ts`：新增 `getSchedulerStatusApi()` / `runSchedulerCheckApi()`。
  - `src/pages/Settings.tsx`：调度器区块改为「每天 / 每周 / 每月」分段 + 时:分选择 +（每周星期 / 每月几号）+ 自动拉取；新增真实「检查状态」卡片（上次检查 / 下次检查 / 已检查数 / 有更新数 / 引擎数）+「立即检查全部」按钮。
- **版本判定**：完善既有「更新调度器」配置段（此前仅存配置无执行）→ **Patch**。
- **校验**：前端 + 后端 `tsc --noEmit` 全绿；`npm run build:frontend` 通过；SEA 注包 ELF magic 正常。
- **注意**
  - 频率不使用 Cron 表达式，按选项设置（每天 / 每周 / 每月 + 时:分）。
  - 国内网络访问 `registry-1.docker.io` 可能受限，检查失败会跳过该镜像并在「检查状态」中提示引擎错误；不影响整体。
  - 旧用户升级后若曾手动关过调度器，`enabled` 保持 false；新安装默认开启、每天 1:00 检查。

## v1.15.15 — 2026-09-10

### 容器管理页面取消右键打开容器弹窗
- **背景**：容器列表行此前绑了 `onContextMenu`，右键（并屏蔽浏览器原生菜单）直接打开容器详情弹窗；但「点击状态列」已是打开方式，右键入口冗余且易误触。
- **改动**：`src/pages/Containers.tsx`
  - 删除 `<tr>` 上的 `onContextMenu={(e) => handleContextMenu(e, container)}`。
  - 删除 `handleContextMenu` 函数（不再有右键打开逻辑，`e.preventDefault()` 一并移除，右键恢复浏览器原生菜单）。
  - 行 `className` 移除 `cursor-context-menu`（不再暗示右键可打开）。
  - 容器详情仍可通过「点击状态列」打开，ESC / 点遮罩关闭（v1.15.14 已加 `dismissable`）不变。
- **校验**：前端 + 后端 `tsc --noEmit` 全绿；`npm run build:frontend` 通过；SEA 注包 ELF magic 正常。

## v1.15.14 — 2026-09-10

### 弹窗 ESC 关闭 + 镜像清理悬空按钮移除 + 更新调度器假数据清理
- **背景**：①容器详情弹窗（`size="xl"`）与堆栈编辑弹窗（`size="full"`）均 `dismissable=false`，ESC 与点遮罩都无法关闭，只能点 X，体验割裂；②镜像管理「清理悬空」按钮与「清理未使用」功能重叠（后者含悬空），且易误删；③系统设置「更新调度器」仅有前端配置、无后端逻辑，却显示硬编码的「上次检查: 2026-07-29 03:00:12」与假的「更新统计 12/2/3」，误导用户。
- **改动**
  - `src/components/Modal.tsx`（无改动，说明机制）：`dismissable` 同时控制 ESC 与遮罩关闭，默认 `false`。
  - `src/pages/Containers.tsx`
    - 容器详情 `<Modal>` 加 `dismissable` → ESC / 点遮罩可关闭（打开方式保持「点击状态列」，行为不变）。
  - `src/pages/Stacks.tsx`
    - `StackEditorModal` 的 `<Modal>` 加 `dismissable` → ESC / 点遮罩可关闭。
  - `src/pages/Images.tsx`
    - 移除工具栏「清理悬空 (N)」按钮；保留「清理未使用 (N)」。
    - 移除对应的「清理悬空镜像」确认弹窗。
    - 删除 `handlePruneDangling` 与 `confirmCleanDangling` 状态（死代码）；`danglingCount/danglingSize` 仍用于顶部统计卡片显示，保留。
  - `src/pages/Settings.tsx`
    - 「更新调度器」：移除硬编码的「上次检查」时间戳与无 `onClick` 的「立即检查全部」按钮。
    - 移除「更新统计」卡片（硬编码 12/2/3 假数据）。
    - 保留「启用全局自动更新检查 / 检查频率 (Cron) / 自动拉取镜像」三项配置（纯前端存储，后端定时逻辑尚未实现，待后续补）。
- **校验**：前端 + 后端 `tsc --noEmit` 全绿；`npm run build:frontend` 通过；SEA 注包 ELF magic 正常。
- **说明**：「更新调度器」目前仍是无后端执行的纯配置项；若要真正启用后台定时检查/立即检查，需补 `server` 端 cron 调度逻辑——本次未做，已在代码注释与本文说明。

## v1.15.13 — 2026-09-09

### 容器/堆栈管理 9 列水平居中（与「容器」列一致）
- **背景**：容器/堆栈表格里，「容器数」「更新」这种结构化短字段早就是居中的（`text-center`）；但「图标」「状态」「标签」「端口映射」「运行时长」这几列文字/标签字段一直左对齐，看起来行列错位、单元格里贴左边一坨。
- **改动**
  - `src/pages/Containers.tsx`
    - **图标列**：`<th>` 由 `text-left` 改 `text-center`（保持 `w-14`）；`<td>` 内容由直放 `<div w-8 h-8>` 改 `<div flex justify-center><div w-8 h-8>`，图标在列内居中。
    - **状态列**：`<SortableTh label="状态">` 加 `align="center"`；`<td>` 包一层 `<div flex justify-center>`，居中包裹原有 status button（点击打开容器详情行为不变）。
    - **标签列**：`<SortableTh label="标签">` 加 `align="center"`；`<td>` 包 `<div flex justify-center>` 居中 `TagGroup`。
    - **端口映射列**：`<th>` 加 `text-center`；`<td>` 中 `<div flex flex-wrap>` 改 `<div flex flex-wrap justify-center gap-1>`，Tag 在列内居中显示。
  - `src/pages/Stacks.tsx`
    - **图标列**：`<th>` `text-left` → `text-center`；`<td>` 包 `<div flex justify-center>` 居中图标方块。
    - **状态列**：`<SortableTh label="状态">` 加 `align="center"`；`<td>` 包 `<div flex justify-center>`。
    - **标签列**：`<SortableTh label="标签">` 加 `align="center"`；`<td>` 包 `<div flex justify-center>`。
    - **容器列**：`<SortableTh>` 本就是 `align="center"` 不动；`<td>` 已有 `text-center` 不动——统一居中。
    - **运行时长列**：`<th>` `text-left` → `text-center`；`<td>` 加 `text-center`，纯文字居中。
- **保留**：所有点击/右键行为、排序、列显隐逻辑、表头排序箭头全部不变。
- **校验**：前后端 `tsc --noEmit` 全绿，`npm run build:frontend` 通过。

## v1.15.12 — 2026-09-09

### 堆栈管理「图标」「堆栈名称」拆分为两列，同步列显隐
- **背景**：堆栈管理主表格的图标和堆栈名称原本合在同一列（一行内左侧图标 + 右侧名称 + 描述）。合在一起时，单独隐藏名称会顺带把图标也藏掉，且把图标压缩在名称侧留白过多，列宽不好调。
- **改动**
  - `src/pages/Stacks.tsx`：`StackColumnKey` 增加 `"icon"`；`allStackColumns` 列表首项新增 `{ key: "icon", label: "图标" }`；表头新增独立图标 `<th>`；body 行同步新增独立 `<td>`（只放图标方块，复用现有 `w-8 h-8 rounded-lg bg-slate-100` + `Layers` fallback），名称 `<td>` 不再内嵌图标。
  - `src/pages/Settings.tsx`：系统设置「列显隐 → 堆栈管理」新增「图标」勾选项；`stackList` 默认可见列加上 `"icon"`（位置在最前）。
  - `server/settings.ts`：服务端默认值同步加上 `"icon"`。
- **校验**：前端 + 后端 `tsc --noEmit` 全绿，`npm run build:frontend` 通过。
- **说明**：旧用户升级后，列显隐仍保留在 `settings.json`（只保留用户实际勾选的项目）。`defaultsVersion=2` 不变——老用户若没主动隐藏过图标，会按 `settings.columnVisibility.stackList` 的实际值显示；若 `stackList` 缺少 `"icon"`，首次进入会看到名称左侧图标消失，可在设置页「列显隐」重新勾上。
- **表头补齐**（v1.15.12 同包内追加）：堆栈图标 `<th>` 由 `sr-only` 不可见改为显示「图标」文字，与容器管理 `<th>` 完全对齐（同样的 `text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 w-14`）；表头宽度由 `w-12` 调整为 `w-14` 与列内容对齐。

## v1.15.11 — 2026-09-09

### 容器详情弹窗尺寸回退为 xl（1152px）
- **背景**：v1.15.10 为与堆栈管理「编辑堆栈」统一，把容器详情弹窗做成了 `size="full"`（`max-w-[95vw] h-[90vh]`），实际观感过大；容器详情以信息展示为主，不需要编辑器级空间。
- **改动**：`src/pages/Containers.tsx` `ContainerDetailModal` 尺寸由 `full` 回退为 **`size="xl"`**（`max-w-6xl` = 1152px 宽，高度随内容、上限 90vh），同时内容区回退为原有结构：整体 `max-h-[60vh] overflow-y-auto`、日志区 `max-h-[50vh]`、终端页签直接渲染（不再包一层滚动容器）。
- **保留**：点击状态列打开容器详情、居中弹窗形式、`Modal` 的 `bodyClassName` 能力（堆栈编辑弹窗仍在用）。
- **验证**：前端 + 后端 `tsc --noEmit` 全绿，`npm run build:frontend` 通过。
- **说明**：堆栈管理「编辑堆栈」弹窗仍为 `size="full"`（内含 YAML 编辑器，需要足够高度），两页面仅「打开方式（居中弹窗）」统一，尺寸按内容需要各自取值。
- **备注**：v1.15.10 仅本地打包未发布，本版取代之。

## v1.15.10 — 2026-09-09

### 两处弹窗改为居中弹窗，容器详情改为点击状态列打开
- **背景**：v1.15.9 把容器详情改成了与堆栈管理「编辑堆栈」相同的底部升起抽屉（`mt-auto` + `rounded-t-xl`），实际使用中不如此前的居中弹窗直观；同时容器管理页打开容器详情只能右键，与堆栈管理「点状态列打开」的操作路径不一致。
- **改动**
  - `src/components/Modal.tsx`：新增可选 `bodyClassName`（默认 `flex-1 overflow-y-auto px-6 py-4`）。传 `flex-1 min-h-0 flex flex-col overflow-hidden` 时，弹窗内部可保持 flex 布局，页签各自滚动 —— 这是弹窗能替掉抽屉的前提。
  - `src/pages/Stacks.tsx`：`StackEditorModal` 由 `createPortal` 抽屉改为 `<Modal size="full">` 居中弹窗（`max-w-[95vw] h-[90vh]`、四角圆角、`slideUp` 动画）；Header / Tabs / Content / Footer 层级不变，Footer 补 `rounded-b-xl`。移除不再使用的 `createPortal` 导入。
  - `src/pages/Containers.tsx`：`ContainerDetailModal` 同样改为 `<Modal size="full">` 居中弹窗，内部保留 v1.15.9 的 flex 内容区（各页签自带滚动、日志区随高度自适应）。
  - `src/pages/Containers.tsx`：**状态列改为按钮**，点击直接打开容器详情（默认落到「基本信息」页签），样式与堆栈管理状态列一致（hover 蓝框 + 提示「点击状态列查看容器详情」）；右键打开的行为保留。
- **验证**：前端 + 后端 `tsc --noEmit` 全绿，`npm run build:frontend` 通过。
- **说明**：两个页面现在共用同一种打开方式 —— 居中弹窗 + 内部 flex 页签；弹窗关闭方式不变（右上角 X，不响应遮罩与 ESC）。

## v1.15.9 — 2026-09-09

### 容器详情弹窗改为与堆栈管理一致的「底部升起抽屉」样式
- **背景**：容器管理页的容器详情弹窗用的是通用 `Modal`（居中卡片 `size="xl"`，`max-h-[90vh]`），与堆栈管理页「编辑堆栈」的弹出方式（底部升起、90vw × 90vh）不统一，且日志/终端可用高度受限（日志区写死 `max-h-[50vh]`）。
- **改动**：`src/pages/Containers.tsx`
  - `ContainerDetailModal` 改为 `createPortal` 自定义层，复刻 `StackEditorModal` 的结构：`fixed inset-0 z-[1000] bg-black/40 flex flex-col` + 内容区 `modal-content ... max-w-[90vw] h-[90vh] mx-auto mt-auto rounded-t-xl flex flex-col`（`mt-auto` 实现底部升起，`rounded-t-xl` 只有顶部圆角）。
  - 内容区由「整体 `max-h-[60vh] overflow-y-auto`」改为 `flex-1 min-h-0 flex flex-col overflow-hidden`，四个页签各自持滚动容器：基本信息/资源监控/终端 `flex-1 min-h-0 overflow-y-auto`；日志页签改为 `flex-1 min-h-0 flex flex-col`，日志区由 `max-h-[50vh]` 改为 `flex-1 min-h-0`，随抽屉高度自适应。
  - 关闭方式不变（Header 右上角 X；不响应遮罩点击与 ESC，与堆栈编辑弹窗一致）。移除不再使用的 `Modal` 导入（页面仍用 `ConfirmDialog`）。
- **验证**：前端 + 后端 `tsc --noEmit` 全绿，`npm run build:frontend` 通过。
- **说明**：`XTermTerminal` 内部仍为 `height: 50vh; min-height: 300px`，在 90vh 抽屉内不会溢出（约 625px < 865px@961 视口），暂不调整。

## v1.15.8 — 2026-09-09

### 堆栈操作执行期间状态列显示「执行中」
- **需求**：堆栈在后台执行操作（启动 / 停止 / 重启 / 拉取 / 构建 / 强制更新 / 备份等）时，状态列仍显示操作前的旧状态，无法看出正在执行。
- **实现**：复用页面内已有的 `operatingStacks` 集合（SSE 流式操作开始即加入、成功或失败后移除并触发刷新），渲染状态列时优先取 `operating`，操作结束自动回到真实状态；容器子表状态列同理（按容器名）。
- **改动**：`src/components/Badge.tsx` 新增 `operating` 状态（蓝底「执行中」+ 呼吸点），`src/pages/Stacks.tsx` 状态列与子表状态列各 1 处。不涉及后端。
- **说明**：状态筛选下拉暂未加「执行中」选项（排序/筛选仍按底层真实状态），需要可再补。

## v1.15.7 — 2026-09-09

### 收尾：让 sr-only 复选框就地定位（v1.15.6 元凶的纵深防御）
- **背景**：v1.15.6 已通过「外壳加 `relative` + `html,body` 禁文档滚动」修复症状，实测 `viewport = doc = body = shell`（961）确认生效。但逃逸元素本身仍在：`Settings.tsx` 列显隐默认值里每个复选框的 `<input className="sr-only">`（Tailwind `sr-only` = `position:absolute; 1px + clip`），祖先链无定位元素时会按静态位置定位到文档深处（实测 `top: 1150`）。
- **修复**：给这些复选框的 `<label>` 加 `relative`，`sr-only` input 就地定位于 label 内，不再跑到 1150px 远，也不再依赖外壳兜底。1px + `clip` 视觉完全不变。
- **验证**：v1.15.6 实测数据 `viewport 961 = doc 961 = body 961 = shell 961`、`htmlOverflow/bodyOverflow = hidden`，浏览器级第二滚动条与底部空白均已消失。

## v1.15.6 — 2026-09-09

### 彻底修复「页面底部空白 + 右侧两个滚动条」
- **背景**：v1.15.5 补的 `min-h-0` 只解决了 flex 链内部，现象仍在。用户实测数据：`viewport 826` / `shell(#root 子) 826` / `main 770 且未溢出` / 页面内只有一个真实滚动容器（设置内容区 722/1265），但 **`documentElement.scrollHeight = 1252`（比视口高 426px）而 `body.scrollHeight = 826`**。
- **根因**：存在一个**逃逸的绝对定位元素**——它的祖先链中没有定位祖先（`position: relative/absolute/fixed`），于是包含块是「初始包含块」而非应用外壳。CSS 规则：**`overflow: hidden` 只裁剪以自己为包含块的后代**，裁剪不了这类元素。因此它撑高了文档 426px → 出现浏览器级（第二个）滚动条，并把外壳下方 426px 留成空白。
- **修复（双保险）**：
  1. `src/App.tsx`：应用外壳加 `relative`，为内部所有 `absolute` 元素建立包含块 → 一律被外壳的 `overflow-hidden` 裁剪，无法再撑高文档。位置计算不受影响（外壳与初始包含块同尺寸同原点）。
  2. `src/index.css`：`html, body { overflow: hidden; }`，应用为满屏布局（外壳 `h-screen` + 内部各自滚动），禁止文档级滚动，从根上消除第二个滚动条与视口下方空白。
- **说明**：登录页 / 初始化向导本身就是 `h-screen` 居中布局，不依赖文档滚动，不受此次改动影响；弹窗与下拉均为 `fixed` 或 portal 到 body，可正常显示。

## v1.15.5 — 2026-09-09

### 修复设置页双滚动条与底部大片空白
- **根因**：flex 布局链（App 外壳 → main → Settings 根 → 设置内容区）缺少 `min-h-0`。flex 项默认 `min-height: auto`，内容高于视口时 `flex-1` 的 main/内容区拒绝收缩、被撑到内容高度：外层 `h-screen overflow-hidden` 裁掉超出部分（底部出现大片空白），同时外层 main 与 Settings 内部两个滚动容器同时溢出（右侧出现两个滚动条）。
- **修复**：给 flex 链每一层补 `min-h-0`（`App.tsx` 内容列与 main、`Settings.tsx` 根与内容区），使高度逐层受控、全页只剩设置内容区一个滚动容器。
- **顺带**：默认列配置移除已删除的「状态(inUse)」列残留（服务端 defaults 与设置页前端默认值）。

### 登录/初始化回车提交改原生表单（兜底）
- 登录页、找回码重置页、初始化向导的表单容器改为原生 `<form onSubmit>`，提交按钮 `type="submit"`、辅助按钮 `type="button"`，移除对 `Input onKeyDown` 透传的依赖——即使透传再失效，浏览器原生回车提交也能登录。`Input` 的 `onKeyDown` 透传保留（v1.15.2）。

## v1.15.4 — 2026-09-08

### 数据卷页面移除「状态」列
- 移除表格「状态」（已关联/未关联）列及「列」设置中的对应勾选项；筛选、统计卡、清理未关联、删除按钮禁用等内部判定逻辑全部保留。

### 镜像列表与 docker images 对齐
- **现象**：`docker images` 显示 4 个镜像（含 `bookmarkhub-yanzi:latest`），页面只有 3 个。
- **根因**：Docker API `/images/json` 一个镜像一条记录、`RepoTags` 数组携带全部标签；原 `transformImages` 只取 `RepoTags[0]`，第二个标签被丢弃。
- **修复**：改为按 `RepoTags` 展开，每个标签一行（同 ID 多标签重复出现，与 docker images 口径一致）；仓库名解析改用 `lastIndexOf(":")` 从右侧切分，兼容带端口的 registry 地址（如 `registry:5000/app`）。
- **说明**：大小数字口径差异（页面 293.5MB = MiB，CLI 308MB = 十进制 MB）为单位换算不同，数值本身一致。

## v1.15.3 — 2026-09-08

修复（Patch）：数据卷「未关联」判定与计数、文案，及活跃度面板持久化（v1.15.0 遗留）。

### 数据卷：使用状态误判 + 计数恒 0
- **现象**：所有卷状态恒显示「使用中」，「清理未使用卷 (0)」计数恒 0（实际有未关联卷，清理时却能删掉），单个删除按钮恒禁用，「关联容器」列恒为「—」。
- **根因**：Docker API `GET /volumes` 列表**不返回 `InUse` 字段**，前端 `v.InUse !== false` 在字段缺失（undefined）时恒为 `true`；`associatedContainers` 前端写死空数组、后端也未计算。
- **修复**：后端 `getVolumes()` 并行拉取容器列表（含停止），按容器 Mounts 建「卷名 → 关联容器名」映射，给每个卷回填 `InUse` 与 `UsedBy`；前端改为 `inUse === true`、关联容器列读 `UsedBy`。
- **实际清理行为本就正确**（服务端 `pruneVolumes` 直接调 Engine API），本次修复的是界面判定与计数。

### 文案：未使用 → 未关联
- 按钮「清理未使用卷」→「清理未关联卷」；弹窗标题/正文、操作日志、输出弹窗、统计卡、筛选选项同步。
- 状态列「使用中 / 未使用」→「已关联 / 未关联」；列配置标签 →「关联状态」；删除确认文案同步。

### 活跃度面板（v1.15.0 遗留，`tsc --noEmit` 暴露）
- `Settings.tsx` 调用**不存在的** `handleSaveSettings`（正确为 `handleSave`）→ 面板触发保存时必然 ReferenceError。
- `ActivityPanel` 未声明/调用 `onAfterSave` prop → 开关/地址变更只改本地状态、**不持久化**；补上 prop 并在三个变更点成功后触发保存。
- 清理 `Activity` 图标重复导入、`telemetry` 校验可选链、`SystemSettings.telemetry` 改为必需（服务端 `defaultsVersion` 迁移保证存在）。前端 `tsc --noEmit` 现已全绿（vite 不做类型检查，此前错误未暴露）。

**涉及文件**：`server/docker.ts`、`src/transforms.ts`、`src/pages/Volumes.tsx`、`src/pages/Settings.tsx`、`src/components/ActivityPanel.tsx`、`src/types.ts`。

## v1.15.2 — 2026-09-08

修复（Patch）：登录页 / 初始化向导**按回车不提交**（`Input` 组件丢弃 `onKeyDown`）。

- **现象**：登录页输入账号密码后按回车无反应，只能点「登录」按钮；初始化向导同样如此。
- **根因**：`src/components/UI.tsx` 的通用 `Input` 组件只接收 `value/onChange/placeholder/type/disabled/className` 六个 props，**未把 `onKeyDown` 透传给底层 `<input>`**，因此 `LoginPage`/`SetupWizard` 里 `onKeyDown={(e) => e.key === "Enter" && submit()}` 被静默丢弃（`Images.tsx`、`Settings.tsx` 用的是原生 `<input>`，故不受影响）。
- **修复**：`Input` 新增可选 `onKeyDown` 并绑定到 `<input>`，一处修复 6 处回车提交（登录页 3 处 + 向导 3 处）；不传该 prop 的调用方行为不变。
- **涉及文件**：`src/components/UI.tsx`。

## v1.15.1 — 2026-09-08

修复（Patch）：YAML 编辑器列表项显示丢失短横后的空格，编辑堆栈 compose 时与磁盘原文不一致。

- **现象**：编辑堆栈时 `- TZ=Asia/Shanghai`、`- '5031:5031'` 等列表项显示为 `-TZ=Asia/Shanghai`、`-'5031:5031'`，与 `cat docker-compose.yaml` 原文对不上（**文件本身无误**，纯显示层问题）。
- **根因**：`YamlEditor.tsx` 高亮层 `highlightLine()` 的列表项正则 `/^(\s*)(-\s+)(.*)$/` 把「短横+空格」整体匹配消费，但输出 HTML 只渲染了短横、没有把短横后的空格拼回去。编辑器采用「textarea 透明文字 + `<pre>` 高亮层」叠层方案，用户看到的是高亮层 → 显示比原文少一个空格，且高亮层与透明文字从此错位 1 列（光标位置与可见文字对不准，与 v1.11.1 修复的 Delete 漂移同族）。
- **修复**：正则改为 `/^(\s*)(-)(\s*)(.*)$/`，短横后的空白单独捕获并 `escapeHtml` 原样拼回高亮层，保证与原文逐字符对齐。
- **涉及文件**：`src/components/YamlEditor.tsx`（1 处）。

## v1.14.0 — 2026-09-07

新增密码找回码（Minor）：设置 **18 位**找回码，忘记密码时可在登录页用它重置密码。

- **规则**：必须满 18 位；**仅支持字母和数字**（输入阶段即剔除其他字符）；**忽略大小写** —— 保留用户输入的原始大小写、**不强制转大写**，大小写差异在服务端比对阶段消除（`normalizeRecoveryCode` 统一转大写后参与哈希与校验），故 `abc…` 与 `ABC…` 等价；前端清洗只剔除非字母数字并截断 18 位，输入时显示 `n/18` 计数。
- **校验顺序**：先判非法字符、再判长度，避免「18 位里含符号」被误报成「未满 18 位」。
- **存储（`server/users.ts`）**：与密码同级保护 —— `scrypt` + 随机 16B salt，`timingSafeEqual` 校验；`users.json` 仅存 `recoveryHash`/`recoverySalt`，**明文不落盘、也不可回显**。
- **入口（两处，可选）**：① 首次部署向导「密码找回码」，留空可稍后补设；② 已登录后 `系统设置 → 用户 → 密码找回码` 可随时重设或清除。
- **找回流程**：登录页新增「忘记密码？使用 18 位找回码重置」→ 填用户名 + 找回码 + 新密码（≥6 位）+ 确认 → 重置成功后返回登录。
- **限流**：两次使用间隔 **10 分钟**（`RECOVERY_MIN_INTERVAL_MS`），命中返回 429 + `code: RECOVERY_COOLDOWN` 并提示剩余秒数；重设找回码会解除冷却。
- **安全**：重置接口为公开路由但错误文案统一为「用户名或找回码错误」，不泄露用户名是否存在；已登录接口 `GET/POST/DELETE /api/auth/recovery` 均需登录，其中设置找回码需校验当前密码（敏感操作二次验证）。
- **新增文件**：`src/lib/recovery-code.ts`（清洗/校验/分组展示）。

验证：`npm run build`（vite + 后端 tsc）通过；真实服务端冒烟全通过 —— 初始化带码 → 状态查询 hasRecovery=true → 小写码重置成功（忽略大小写）→ 立即再用 429 限流 600 秒 → 错误码 401 → 17 位/含符号 400 → 新密码登录成功 → 设码时密码错误 400、17 位 400、正确 200 → 重设解除冷却可立即使用 → 旧码失效 401 → 未登录访问 401 → 清除后 hasRecovery=false 且旧码失效 401；`users.json` 确认仅含 recoveryHash/recoverySalt，无明文。
- 大小写专项：设置 `AbCdEfGh12345678Xy` → 用全小写 `abcdefgh12345678xy` 重置成功；设置 `zZzZzZzZ12345678AB` → 用全大写 `ZZZZZZZZ12345678AB` 重置成功；18 位含符号报「仅支持字母和数字」而非「未满 18 位」。

## v1.15.0 — 2026-09-07

新增**用户活跃度监视**（按 `Linux应用安装量与活跃用户统计方案` 实现）。**仅本项目做上报端**（不上报中心 / 中心服务另行建设），上传地址暂定 `https://docker.yanziruxue.top`。

### 设备标识（双标识架构）
- **主标识 `device_uuid`**：`crypto.randomUUID()` + `/etc/<应用名>/device.info` 持久化（Linux 部署）；无写权限时降级到 `<CONFIG_DIR>/device.info`（Windows 部署）。同一台机器重启后 UUID 保持稳定。
- **辅标识 `hw_fingerprint`**：CPUID + 主板序列号 + 硬盘序列号拼接后 SHA-256，前 12 位展示给用户看（不全量回显）。`/proc/cpuinfo`、`dmidecode` 命令不可用时**整体置零**（容器/虚拟机环境优雅降级）。
- **风控策略**：`virtualized=true` 的指纹默认为 `000000000000`，仅参与去重而不作为唯一标识。

### 上报策略（默认开启，可关闭）
- **安装事件** `install`：进程启动后 10 秒首次上报，写入 `installReported=true` 持久化标记。
- **活跃事件** `active`：每日首次上报，落地 `lastActiveDate` 日粒度去重，避免重复计数。
- **心跳**：默认 6 小时一次，可关闭。
- **关闭即停**：设置项 `telemetry.enabled=false` 时 `report` 接口立即返回「遥测已关闭」，不发任何请求；`stats` 接口返回 `null`，页面降级展示。

### 上报载荷（POST `{endpoint}/api/telemetry/ingest`）
| 字段 | 用途 |
|---|---|
| `event` | `install` / `active` |
| `device_uuid` | 主标识（统计去重键） |
| `hw_fingerprint` | 辅标识（风控） |
| `app_version` / `os_version` / `arch` | 环境维度 |
| `virtualized` | 是否容器/虚拟机 |
| `client_ts` | 客户端事件时间（ISO） |
| `payload` | `{}`（预留） |

### 新增路由（均需登录）
- `GET /api/telemetry/status` — UUID、指纹短码、虚拟化标志、设备文件路径、最后上报时间/错误
- `POST /api/telemetry/report` — 立即触发 install + active
- `GET /api/telemetry/stats` — 后端代理拉取远端聚合（远端未就绪返回 `null`）

### 设置页「活跃度」分区
- **概览卡片**：远端聚合统计（安装总数、新增设备、DAU/MAU），未就绪时降级为「等待中心服务就绪」
- **本机标识**：UUID（前 8+•••+后 4 掩码，显示/复制/重置）、硬件指纹 12 位、虚拟化标志、首次识别时间
- **配置表单**：总开关、上报地址（默认 `https://docker.yanziruxue.top`）、是否采集硬件指纹
- **手动上报**按钮（带结果反馈）+ **设备文件路径**展示

### 设置项 + 默认值
```json
"telemetry": {
  "enabled": true,
  "endpoint": "https://docker.yanziruxue.top/api/telemetry/ingest",
  "collectHwFingerprint": true
}
```

### 涉及文件
- 新增：`server/telemetry.ts`（设备/指纹/上报全模块）、`src/components/ActivityPanel.tsx`（活跃度面板）
- 改动：`server/index.ts`（启动心跳 + 三路由）、`server/settings.ts`（默认值）、`src/types.ts`（TelemetryConfig/SystemSettings）、`src/api.ts`（TelemetryStatus/Stats/report/status/stats）

### 验证
`npm run build`（vite + 后端 tsc）通过；真实服务端冒烟 6 项全通过 —— init 后 `device_uuid` 自动生成、虚拟化标志正确、硬件指纹前 12 位生成、关闭遥测后 `report` 立即返回「遥测已关闭」、`stats` 关闭时返回 `null`、持久化文件 `device.info` 落盘到 `/etc/docker-manager-yanzi/device.info`（Linux）或 `<CONFIG_DIR>/device.info`（Windows），重启后 UUID 保持稳定。

## v1.13.0 — 2026-09-07

新增登录鉴权与账户管理（Minor）。参考 bookmarkhub 的「登录与账户管理」设计，按本项目（个人自托管 NAS 工具）定位裁剪为 **单管理员模式**，不做多用户与角色。

- **登录门卫 AuthGate（`src/App.tsx`）**：启动并发请求 `GET /api/auth/init-status`（是否已初始化）与 `GET /api/auth/me`（是否已登录），三态分流 —— 未初始化 → `SetupWizard`；未登录 → `LoginPage`；已登录 → 主应用。
- **账户存储（`server/users.ts` + `<data>/users.json`）**：密码用 Node `crypto.scrypt` + 随机 16 字节 salt 哈希，`timingSafeEqual` 防时序攻击；**仅存 hash 与 salt，无明文**。
- **会话（`server/auth.ts`）**：32 字节随机 token 存服务端内存 Map；Cookie `docker-manager-yanzi_session`（`httpOnly` + `sameSite=lax`）；TTL 取自 `设置 → 用户 → 会话超时`（默认 30 分钟）；服务重启即失效，需重新登录。
- **鉴权守卫**：`app.use("/api", …)` 对除 `/api/auth/*` 外所有接口强制登录（未登录 401）；终端 WebSocket `/ws/terminal` 建连时校验会话，未登录拒绝（1008）。
- **前端联动**：`request()` 统一 `credentials: "include"`；非鉴权接口返回 401 时派发 `auth:unauthorized`，App 监听后回登录页；主数据加载 effect 改为依赖登录态，登录后才拉取（修复「未登录时预先拉取必然失败且登录后不重试」）。
- **顶栏**：显示当前用户名 + 登出按钮。
- **系统设置**：「用户与权限」更名为 **「用户」**；原只读用户名占位卡片替换为「当前账户」（用户名取自登录账户 + 会话超时分钟数）与「修改密码」（原密码 + 新密码 + 确认，≥6 位）。`UserConfig.username` 降级为历史可选字段，不再展示/编辑。

验证：
- `npm run build`（vite + 后端 tsc）通过。
- 冒烟测试（临时 DATA_DIR/CONFIG_DIR + 独立端口）：init-status=false → 未登录 `/api/engines` 401 → init 建号成功并下发 Cookie → 带 Cookie `/api/engines` 200 → me 返回用户 → 错误原密码改密 400、正确原密码 200 → 登出后 me 401 → 新密码登录成功、旧密码 401 → 已初始化再 init 409；`users.json` 仅含 hash/salt。
- ⚠️ 现有部署升级后首次启动会进入初始化向导，需先创建管理员账号。

## v1.12.5 — 2026-09-07

- 拉取镜像进度显示优化（Patch）：修复「启动堆栈拉取镜像」（CmdOutputModal）与 compose 拉取时逐帧刷屏打印日志的问题。
  - 根因：`stackActionStream` 的 `onData` 把 `docker compose pull` 每个数据块（含 `\r` 原地刷新的层进度帧）直接推送，前端累积显示 → 同一镜像层每次大小变化都追加新行。
  - 后端新增按层 id 去重的行缓冲（`displayLines` + `layerIdOf`/`appendDisplayLine`），按 `\r/\n` 切帧（修复 `\r` 刷新两帧粘连），同一层 id 原地覆盖、只更新大小，不再持续打印新行；每次推送聚合后的完整快照（覆盖式）。
  - 前端 `runStackActionStream` 的 `onChunk` 由累积（`buf += text`）改为覆盖式（`buf = text`）显示快照。
  - 普通镜像拉取（Images 页 PullOutputPanel）本就走 pull task 的 `pushOutput` 按层去重，不受影响；本次改动使其与堆栈拉取行为一致。
  - 验证：`npm run build`（vite + 后端 tsc）通过。

## v1.12.4 — 2026-09-07
### 堆栈管理页 列显隐 与 容器子表 列显隐 解耦（Patch）
- **根因**：此前工具栏「列」按钮本应控制堆栈管理主页，却错误驱动了容器子表的列显隐（其默认值来自 `设置 → 列显隐默认值 → 堆栈管理（实际为容器子表）`）。
- **主页列显隐真正控制主页**：工具栏「列」按钮改为控制堆栈管理主页主表格（`name/status/tags/containers/uptime/update`），新增独立状态 `visibleStackColumns`，列表项来自 `设置 → 列显隐 → 堆栈管理`。
- **容器子表列显隐独立控制子表**：弹窗内「显示列」切换仅控制弹窗内容器列表（`name/image/status/network/ip/ports/update`），来自 `设置 → 列显隐 → 容器子表`（原 `stacks`）。两者完全解耦，互不干扰。
- **设置项拆分**：`columnVisibility` 新增 `stackList`（主页）键，原 `stacks` 键明确为容器子表；类型 `ColumnVisibility`、前后端 `DEFAULT_SETTINGS` 同步；旧配置无 `stackList` 时回退默认值，不破坏已有设置。
- **提示文案移动**：「点击状态列弹出容器子表」（Info 图标）由「全部状态」视图每行右侧的「说明」列，移至工具栏「列」按钮**左边**，并移除原每行「说明」列（避免重复）。
- 验证：前端 `tsc --noEmit` 通过；`npm run build`（vite + 后端 tsc）通过。

## v1.12.3 — 2026-09-07
### 容器子表改为弹窗 + 点击状态列触发（Patch）
- **容器子表由行内展开改为弹窗展示**：移除原「左键行展开/收起」的内联容器子表与展开箭头列；新增 `containersModal` 状态。
- **触发方式改为点击状态列**：状态列 `StatusBadge` 包进可点击按钮，点击即弹出该堆栈的容器子表弹窗（`Modal` 组件，size=lg，可点遮罩/ESC 关闭）。弹窗内保留 Profiles 展示、列显隐切换（与系统设置 → 列显隐 → 堆栈管理联动）、容器右键菜单（启动/停止/重启/终端等）。
- **「全部状态」视图行内说明**：当状态筛选为「全部状态」时，每行右侧新增「说明」列，提示「点击状态列弹出容器子表」（带 Info 图标）；切换其它状态筛选时该列自动隐藏，保持表头与数据列对齐。
- 左键点击行不再触发展开（仅右键菜单保留全部操作）；空容器堆栈弹窗内显示「该堆栈暂无容器」占位。
- 验证：前端 `tsc --noEmit` 通过；`npm run build:frontend` + SEA bundle 通过。

## v1.12.2 — 2026-09-07
### Compose 模板支持「末尾」填入 + 标签随机色/RGB 手动（Patch）
- **Compose 管理：模板新增「填入位置」开关（服务内 / 末尾）**
  - `ComposeConfig.templates` 由 `string[]` 改为 `ComposeTemplate[]`（`{ content: string; insert: "service" | "end" }`）；`server/settings.ts` 默认值与合并逻辑向后兼容旧 `string[]`（自动归一化为 `{content, insert:"service"}`）。
  - 栈编辑器右侧一键填入面板每项显示位置徽标（服务内/末尾）；`insertTemplateBlock` 新增 `insert` 参数：`end` 模式把模板**追加到 compose 文本最后一行**，`service` 模式保持插入第一个服务内部；两者均保留手动缩进、支持多行、值留空自动补全（末尾模式无服务名上下文，`container_name` 不补全）。
  - 系统设置「Compose 管理」模板项改为：内容多行 textarea + 服务内/末尾切换按钮 + 删除。
- **标签管理：默认随机色 + 手动 RGB**
  - 新建标签默认色改为随机（`randomTagColor()`，HSL 固定饱和度/亮度保证鲜明可读），不再轮换固定色板。
  - 每个标签行新增手动 RGB 控件：原生取色器 + R/G/B 数值输入（0–255），改动实时换算 hex 写入 `color`；`hexToRgb` / `rgbToHex` 工具加入 `components/TagPicker.tsx`。
- 左键堆栈项目维持现状（展开/收起容器子表），按用户确认不修改。
- 验证：前后端 `tsc --noEmit` 通过。

## v1.12.1 — 2026-09-07
### 一键填入模板：支持多行 + 手动缩进 + 值留空自动补全（Patch）
- **「编辑堆栈 → Compose」页右侧一键填入模板重构**
  - 取消强制 4 空格缩进层级：填入时不再自动计算 `svcIndent+2` 并加空格，改为**完整保留模板自身的缩进（用户手动输入空格）**，插入到 `services` 下第一个服务内部。
  - 支持**多行内容**：每个模板项可为一段 compose 文本（如 `labels:` 带子项），原样逐行插入。
  - **值留空自动补全**：模板行 `key:` 后无值时，按已知键填入默认（`restart→unless-stopped`、`network_mode→bridge`、`container_name→服务名`、`privileged→false`、`tty→true`、`stdin_open→true`、`init→true`、`stop_grace_period→10s`）；未知键留空原样保留。
  - 去重逻辑收敛到「服务块内同名 key 已存在则跳过并提示」（不再依赖固定缩进层级判断）。
- **系统设置「Compose 管理」模板编辑器**
  - 模板项由单行 `Input` 改为多行 `textarea`（`resize-y`，随内容高度自适应），可输入多行；说明文案同步更新（缩进手动输入、值留空自动补全）。
  - 栈编辑器右侧模板面板按钮由 `truncate`（单行截断）改为 `whitespace-pre-wrap break-words`，多行模板可完整显示。
- 验证：前后端 `tsc --noEmit` 通过；核心插入/补全/去重逻辑单测通过。

## v1.12.0 — 2026-09-07
### 复合增强：Compose 管理页 / ENV 编辑器 / 后台拉取可见 / 多项修复（Minor）
- **系统设置新增「Compose 管理」页**
  - 维护「编辑堆栈 → Compose」页右侧的一键填入模板（`compose.templates: string[]`，存 settings.json）。每项一行 compose 属性（如 `restart: unless-stopped`），填入时自动放到 services 下第一个服务内部（4 空格缩进层级）。
  - `src/pages/Settings.tsx` 新增 `compose` 分栏（图标 FileCode2），维护模板列表（新增/编辑/删除）；`src/types.ts` 新增 `ComposeConfig{ templates: string[] }`；`server/settings.ts` 增加默认值（`network_mode: ` / `restart: ` / `container_name: `）与合并（字符串归一化、容错旧配置）。
  - `src/App.tsx` 把 `settings.compose.templates` 透传为 `<Stacks composeTemplates={...} />`；`Stacks.tsx` 的 `StackEditorModal` 接收后在 Compose 编辑器右侧渲染模板面板，点击模板行即插入到光标处（或 services 首个服务缩进层级）。
- **ENV 编辑器（语法高亮 + 校验）**
  - `src/components/EnvEditor.tsx` 新建（类比 YamlEditor 的 textarea + 背后高亮层叠加）：高亮 `KEY=VALUE` / `export KEY=VALUE` / 行内与行尾 `#` 注释；状态栏实时校验，非法行（缺 `=`、KEY 非法字符、重复 KEY）标红并提示行号与原因；支持行号。
  - `Stacks.tsx` 编辑堆栈 ENV 选项卡由普通 textarea 替换为 `<EnvEditor />`。
- **编辑堆栈 Compose 编辑器增强（行号 + 模板面板 + 格式化去 null）**
  - `src/components/YamlEditor.tsx` 左侧新增行号 gutter（滚动与 textarea 同步），便于定位长 compose 文件。
  - `format`（一键格式化）修复：js-yaml `dump` 会把用户写的空值键 `postgres:` 输出成 `postgres: null`；后处理正则把行尾裸 `null` 还原为空值，避免误导（js-yaml 对字符串 `"null"` 输出带引号 `'null'`，故裸 `null` 必为真空值，可安全还原）。
- **Compose 转换只保留 docker run → Compose 单向**
  - `src/lib/compose-convert.ts` 重写：去掉 compose→run 反向（用户只要 run→compose），`convert()` 仅调用 `dockerRunToCompose()`。
  - 修复两个解析 bug：① 行尾 `\` 续行——原先先合并续行再剥注释，会把 `  \  # 注释` 的注释文本混进 token 流；改为**先按行剥离行内注释（引号内 `#` 不截断）再合并续行**。② `#` 注释误当 command 数组项——注释剥离后不再进入 command 解析。
- **compose up 后台运行时镜像页显示拉取信息**
  - 根因：原先堆栈 `up`/`pull` 走流式执行，层进度只在堆栈弹窗内显示，镜像管理页看不到后台拉取。
  - `server/docker.ts` `stackActionStream` 为含拉取语义的步骤（up/pull/build）懒注册合成拉取任务 `ensureStackPullTask`（首次出现层进度行才建，避免普通 up 留任务条）；把 compose 层进度行归一化成 `id: status` 喂给 `handleCliPullLine`，与镜像页原生拉取任务共用同一套展示/轮询/超时清理。镜像管理页实时可见后台拉取的层明细。
- **镜像拉取层明细同 ID 原地更新（去重）**
  - 根因：原先层进度用 `task.layers.push` 追加，同一层 ID 反复出现会生成多条记录、大小不累计。
  - `PullTaskInternal` 新增 `layerMap: Map<id, PullLayerInfo>`，`handleCliPullLine` / `startApiPull` 改为按层 ID 原地更新（不存在才插入），`task.layers` 始终唯一；拉取进度条大小按层累加正确。
- **容器日志默认实时滚动**
  - `Containers.tsx` 日志页 `logPaused` 默认 `false`（打开容器日志即自动滚动到最新）。
- 验证：前后端 `tsc --noEmit` 通过；`npm run build:frontend` 通过。

---

## v1.11.1 — 2026-09-06
### YamlEditor 删除键修复（Patch）
- 现象：编辑堆栈 Compose 页面的 YamlEditor 中，光标置于两个字符之间按 Delete，删除的不是光标右侧字符而是左侧字符（例如 `/mnt/d/...` 光标在 `/mnt/` 与 `d` 之间，Delete 后变成 `mntd/...`）。原因是 YamlEditor 用 `color: transparent` 隐藏 textarea 文本——`color: transparent` 会让部分浏览器（WebKit/Blink）的 `selectionStart`/`caret` 位置发生漂移，于是 Delete 按偏移后的 selectionStart 删除，导致删错字符。
- `src/components/YamlEditor.tsx`：textarea 改用 `-webkit-text-fill-color: transparent`（内联 style）+ 保留 `caret-color` 显示光标，**去掉** `text-transparent`（即 `color: transparent`）——这是 CodeMirror/编辑器叠加层的成熟做法，让文本透明却不干扰光标与选区定位，Delete/Backspace 重新按正确 selection 操作。
- 同时去掉高亮 `<pre>` 末尾无条件拼接的 `\n`：该 `\n` 让 pre 比 textarea 多出 1 行，scrollHeight 不一致，在长文本滚动时高亮层与 textarea 字符级错位。现在 `dangerouslySetInnerHTML` 直接渲染 `highlighted`，行数严格匹配 textarea。
- 验证：前后端 `tsc --noEmit` 通过。

---

## v1.11.0 — 2026-09-06
### YAML 编辑器（语法高亮 + 实时 Lint + 格式化）+ 其它弹窗自动关闭（Minor）
- 需求 1：编辑堆栈（新建/编辑 Compose 文件）页面替换为专业 YAML 编辑器——支持语法高亮、实时 YAML Lint 校验（错误时状态栏提示「YAML 格式错误」并给出行号/列号/原因）、Tab 插入 2 空格、`yaml.dump` 一键「格式化（同时规范化缩进 / 自动修正缩进）」；状态栏空时显示「（空）」，合法显示「YAML 格式正确」绿色，错误显示「YAML 格式错误」红色 + 详情。
- 新增组件 `src/components/YamlEditor.tsx`：基于「textarea（透明文字 + 可见 caret）+ 背后 `<pre>` 高亮层」的轻量叠加方案，零额外构建链依赖；高亮覆盖键/值/列表项/注释/字符串/数字/布尔/标点，全文本经 `escapeHtml` 防注入；滚动同步、Tab 缩进、`format` 用 `js-yaml@^4.1` 的 `load`/`dump`。
- `src/pages/Stacks.tsx`：编辑堆栈 + 新建堆栈两个 Compose 编辑器替换为 `<YamlEditor />`，移除原先的「仅判断非空」假校验；`onValidChange` 回调给 `setYamlValid` 留作后续扩展点；新建弹窗编辑器在 `creating` 时整体置灰禁用（pointer-events-none）。
- 新增依赖 `js-yaml@^4.1.0`（dependencies）+ `@types/js-yaml@^4.0.9`（devDependencies）。
- 需求 2：「其他弹窗也实现自动关闭功能」——之前只有含 `up` 的堆栈操作结果弹窗自动关闭；现在 `runStackActionStream` 取消 `actions.includes("up")` 限制，所有堆栈操作（up/down/pull/restart/build/构建并启动/强制更新）完成后均按 `autoCloseDelay` 自动关闭；同时给删除堆栈、备份堆栈、批量操作三类非流式结果弹窗也写入 `autoCloseDelay`，使其同样享受倒计时 + 取消按钮。`CmdOutputModal` 已有倒计时逻辑（v1.10.0）无需改动，倒计时仅在 `streaming` 为假时启动，故非流式弹窗打开即开始倒数。
- 验证：前后端 `tsc --noEmit` 通过；`npm run build:frontend` 通过。

---

## v1.10.1 — 2026-09-06
### LABELS 页图标支持 SVG（Patch）
- 需求：堆栈编辑器中 LABELS（Web UI Labels）页的「图标」字段此前仅支持 URL 文本，无法使用 SVG；现与 SETTINGS 页堆栈图标对齐，支持 SVG 代码与本地 SVG 文件。
- 复用 `src/pages/Stacks.tsx` 既有的 SVG 机制（`isInlineSvgIcon` / `svgToDataUri` / `validateSvgCode` / SVG 代码编辑器弹窗），将其从仅作用于 `settings.iconUrl` 泛化为「图标目标」（`IconTarget` = 堆栈图标 或 某个 LABELS 服务图标）。
- LABELS 图标字段现提供：内嵌 SVG 时显示「内嵌 SVG 图标（体积）」展示条 + 编辑代码 / 清除；否则显示 URL 输入框（直接粘贴 SVG 代码自动转 data URI）+ 上传本地图片（含 `.svg`，读取为 data URI 内联）+ SVG 代码按钮（打开编辑器粘贴 / 预览）。
- LABELS 图标不托管于服务器（与堆栈图标经 `uploadStackIconApi` 服务端落盘不同），本地文件经 `FileReader` 转 `data:` URI 内联进 `webuiLabels[].iconUrl`，无需后端改动；容器列表图标列与 WebUI 入口均以 `<img src>` 渲染，SVG data URI 可直接显示。
- 验证：前后端 `tsc --noEmit` 通过。

---

## v1.10.0 — 2026-09-06
### 操作结果弹窗自动关闭 + 弹窗设置页（Minor）
- 需求：启动堆栈等操作完成后，结果弹窗显示倒计时并在设定秒数后自动关闭；用户可点「取消自动关闭」保持弹窗打开，关闭时间可配置。
- 前端 `src/components/CmdOutputModal.tsx`：命令输出弹窗新增自动关闭逻辑——`data.autoCloseDelay > 0` 且操作完成（`streaming=false`）时启动每秒倒计时，归零调用 `onClose`；左下角显示「N 秒后自动关闭」+「取消自动关闭」按钮；执行中 / 未配置延迟 / 已取消时不显示。
- 前端 `src/pages/Stacks.tsx`：`runStackActionStream` 在 `actions` 含 `up`（启动 / 构建并启动 / 强制更新等以启动结尾的操作）完成时，于 `onDone`/`onFail` 的 `patchOutput` 写入 `autoCloseDelay`（来自 settings，默认 5）；停止 / 重启 / 拉取 / 构建等其它操作不自动关闭。
- 前端 `src/pages/Settings.tsx`：系统设置新增「弹窗设置」分栏（Timer 图标），含「操作结果弹窗自动关闭时间（秒）」数字输入（最小值 0，0=不自动关闭）。
- 类型 `src/types.ts`：`SystemSettings` 新增 `modal: ModalConfig`（仅 `autoCloseDelay: number`）。
- 服务端 `server/settings.ts`：`DEFAULT_SETTINGS` 新增 `modal.autoCloseDelay = 5`，`getSettings` 合并 `modal` 段；老配置无该段时由默认值补齐（无需 bump defaultsVersion）。
- 验证：前后端 `tsc --noEmit` 通过。

---

## v1.9.2 — 2026-09-06
### 堆栈管理「列」按钮移到「新建堆栈」左侧（Patch）
- 需求：与其他页面（容器 / 镜像 / 数据卷）工具栏布局保持一致——筛选控件在左，「列」按钮紧邻主操作按钮左侧。
- `src/pages/Stacks.tsx`：把列显隐下拉从左侧筛选区（搜索框 / 状态筛选旁）移到右侧操作区，排在「新建堆栈」按钮前；下拉仍 `right-0` 右对齐、点击外部关闭。

---

## v1.9.1 — 2026-09-03
### 拉取进度弹窗恢复总进度条与镜像层明细（Patch）
- 需求：v1.9.0 拉取弹窗仅显示 tail 日志，用户反馈需要直观拉取进度。
- 前端 `src/pages/Images.tsx`：
  - `PullOutputPanel` 改为接收完整 `task: PullTask`，新增 `calcPullProgress(layers)` 汇总各层字节进度；已完成层（`Pull complete` / `Already exists` / `Download complete`）无 size 时不计入总量，避免进度被拉低。
  - 顶部新增总进度条 + 百分比 + `已下载 / 总大小` 小字；颜色随任务状态：进行中蓝、成功绿、失败红。
  - 中部新增「镜像层」折叠列表（max-h 180px 滚动），每行展示层短 ID、状态、mini 进度条与当前/总字节。
  - 底部保留终端风格 `outputTail` 日志区域与自动滚底。
  - 拉取中 / 完成态两处分支均改为 `<PullOutputPanel task={activePullTask} />`。
- 后端无需改动：`server/docker.ts` 的 CLI/API 两条拉取路径已持续维护 `PullLayerInfo[]` 并通过 `toPublicInfo` 返回。
- 验证：前后端 `tsc --noEmit` 通过；`npm run build:frontend` 通过。

### 容器详情弹窗移除「删除」按钮（Patch）
- 需求：容器详情弹窗内的删除入口（一次点击 → 二次「确认删除」）误触风险高，删除统一走列表右键菜单。
- `src/pages/Containers.tsx`：删除 `deleteConfirm` state、`handleDelete` / `confirmDelete` 函数、`actionLoading === "delete"` 的「删除中...」文案与红色进度条分支；保留列表右键菜单删除与批量删除。

### 镜像引用不再直接铺开 sha256 摘要（Patch）
- 现象：容器 `c.image` 在未打标签时是完整摘要 `sha256:c554630a4967a9f8341580e59b...`，列表里又长又无意义。
- 新增 `shortImageRef()`（`src/transforms.ts`）：`sha256:` 开头裁成 12 位短摘要并去前缀，正常镜像名原样返回。
- 应用于容器管理「镜像」列、容器详情弹窗头部镜像名、堆栈展开容器子表「镜像」列（`title` 保留完整值）。

### 容器日志页签新增「清空」按钮（Patch）
- `src/pages/Containers.tsx` 日志工具栏：新增「清空」（`setLogs([])`），清空当前已加载日志；日志为空时按钮禁用。切换页签会按 `[tab, engineId, container.id]` 依赖重新拉取。

### 菜单显示语言默认改为中文（Patch）
- `server/settings.ts` `docker.menuLanguage` 默认 `"zh"`；`Settings.tsx`（默认设置 + 选择器回退）、`App.tsx`、`Stacks.tsx` 回退值同步为 `zh`。
- **一次性迁移**：老配置多半已存了 `"en"`，仅改默认值不生效，故在 `getSettings()` 增加 `defaultsVersion` 版本号（当前 2），不匹配时把 `menuLanguage` 重置为 `zh`（用户后续手动改的选择正常保存）。

### 各页面默认可见列收敛（Patch）
- 容器管理：默认隐藏「镜像」「运行时长」「重启策略」→ `["icon","name","status","tags","ports","actions"]`
- 镜像管理：默认隐藏「SHA-256」→ `["repository","tag","id","size","createdAt","associatedContainers","actions"]`
- 数据卷管理：默认隐藏「驱动」→ `["name","mountpoint","size","createdAt","associatedContainers","inUse","actions"]`
- 堆栈管理（新增）：展开容器子表默认列 `["name","status","network","ip","ports","update"]`，**「镜像」默认隐藏**
- `types.ts` `ColumnVisibility` 新增 `stacks: string[]`；设置页「列显隐」新增「堆栈管理（容器子表）」分组；`App.tsx` 向 `Stacks` 传 `defaultVisibleColumns`。
- 同上一并走 `defaultsVersion` 一次性迁移，升级后老配置直接套用新默认列。

### 堆栈管理：「基本/高级视图」切换改为列显隐（Patch）
- 移除工具栏的「基本视图 / 高级视图」分段控件与 `viewMode` 状态，改为与其他页面一致的「列」下拉（`Columns` 图标，点击外部关闭）。
- 展开容器子表的 7 列（容器名称 / 镜像 / 状态 / 网络 / 容器 IP / 端口 / 更新）全部纳入显隐控制，原「高级视图」才出现的列现在可单独勾选。
- 展开堆栈后不再显示 compose 文件绝对路径（原 `FolderTree + stack.composeFilePath` 整块移除）。

### 弹窗不再因点击外部区域关闭（Patch）
- `src/components/Modal.tsx`：`dismissable` 默认值由 `true` 改为 `false`——点击遮罩与 ESC 都不再关闭，只能点右上角 X 或底部按钮，避免误触丢失编辑内容（堆栈新建 / 编辑、compose 编辑器等表单弹窗此前已显式传 `false`）。
- 同步清理：`src/pages/Stacks.tsx` 堆栈编辑器自定义全屏遮罩去掉 `onClick={onClose}` 与内部 `stopPropagation`。
- 容器详情弹窗此前无关闭按钮（只能点遮罩/ESC），补一个右上角 X 关闭按钮。
- 查看类弹窗（堆栈日志 `dismissable`）保持原有行为。

---

## v1.9.0 — 2026-09-02
### 全局彩色标签库：系统设置新增「标签管理」页（Minor）
- 需求：给「堆栈管理 → 编辑 → LABELS」的服务条目打彩色标签，容器管理 / 堆栈管理列表同步显示并支持按标签排序；标签库在系统设置里统一维护（全局增删改换色）。
- 数据模型：
  - `types.ts` 新增 `ResourceTag { id, name, color: "#rrggbb" }`；`Container.tags` / `StackWebUILabel.tags` / `SystemSettings.tags` 均为该类型的可选数组。
  - `server/settings.ts`：`DEFAULT_SETTINGS.tags = []`；`columnVisibility.containers` 默认列在「状态」后插入 `"tags"`；加载历史设置时若已有列配置缺 `"tags"` 则自动插到「状态」之后——老用户升级无需手动勾选即出现「标签」列。
- 前端 `components/TagPicker.tsx`（全站复用的标签组件）：
  - `TAG_PALETTE` 12 色内置色板（红 → 粉）+ `normalizeTagColor`（非法值回退 slate）+ `hexWithAlpha`（hex → rgba，供浅色底/描边）。
  - `TagChip` 单颗彩色标签（色点 + 名称 + 可选 ✕ 移除）；`TagGroup` 紧凑标签组（超限折叠 `+N`，表格单元格用）；`TagSelect` 多选下拉（chips 展示当前已选、点开复选框面板、点外部/Esc 关闭、空库引导「请先到系统设置 → 标签管理创建」）。
- 前端 `pages/Settings.tsx`：
  - 侧边栏与页内新增「标签管理」页签（`TagsIcon`），页内说明「标签挂在堆栈管理 → 编辑 → LABELS 的每个服务条目上，容器/堆栈列表同步显示并支持排序」。
  - 「标签库」卡片：每行 12 色色板快速换色（当前色描 ring）+ 名称输入 + 实时 `TagChip` 预览 + 删除按钮；「新建标签」按序号轮换色板取色（id 由 `t${Date.now().toString(36)}${rand}` 生成）；空状态与提示条「删除标签不影响已部署容器，对应 chip 会从容器/堆栈列表消失」。
  - 保存沿用系统设置整体保存（`tags` 随 `settings.json` 落盘，存在本机设置中）；校验：标签名称非空、不得重复。
- 验证：前后端 `tsc --noEmit` 通过。
- 判定：新增设置页面 + 全局标签库功能模块 → **Minor**。v1.8.5（8 项 Patch）未发布即并入本次含 Minor 的发布，按最高级别递增 → **v1.9.0**（原 v1.8.5 条目全部并入本版）。

### 堆栈 LABELS 打标签：每服务标签选择器 + 持久化 + 容器页同步显示（并入 v1.9.0）
- 需求：堆栈内的每个服务（容器）都在 LABELS 页打标签；容器管理页同步显示该标签；容器管理页与堆栈管理页均展示标签。
- 前端 `pages/Stacks.tsx`：
  - `StackEditorModal` 接收 `tagLibrary`；LABELS 页每个服务条目的「标签」行改用 `TagSelect` 多选（改动写入 `webuiLabels[i].tags`，随「保存设置」经 `saveStackSettingsApi` 持久化到堆栈目录 `.stack-meta.json`，不改 compose 文件本身）；新增空条目与「自动识别服务」默认空标签。
- 前端 `App.tsx` `loadEngineData`（每次引擎数据加载时执行）：
  - 把 `webuiLabels[i].tags` 上的标签快照按 `id` 对齐全局标签库 `settings.tags` 重新解析——库内重命名/改色即时同步到界面，被删除的标签自动失效。
  - 服务条目按容器名匹配容器：`c.name === serviceName`（显式 `container_name`）→ `${stack}-${service}` → `^${stack}-${service}-\d+$`（compose 默认 `<project>-<service>[-index]`）逐级匹配；命中容器的 `container.tags` 合并去重（同 id 只保留一个），使容器页出现该服务标签。
- 验证：前后端 `tsc --noEmit` 通过。
- 判定：堆栈 LABELS 打标签 + 容器页同步显示，属本 Minor 的功能主体，并入 v1.9.0。

### 容器管理页：新增「标签」列 + 名称默认排序 + 多列排序（并入 v1.9.0）
- 需求：容器列表默认按名称首字母排序；标签、状态、重启策略三列支持点击表头排序。
- 前端 `components/UI.tsx`：新增通用 `SortableTh` 排序表头——当前排序列高亮 `ArrowUp`（升序）/ `ArrowDown`（降序），未排序列显示 `ChevronsUpDown`；点击同列切换升/降序、点新列首击置升序。
- 前端 `pages/Containers.tsx`：
  - `ColumnKey` 新增 `"tags"`，列选择器与默认可见列在「状态」与「镜像」之间加入「标签」列；无标签单元格显示 `—`，有标签用 `TagGroup max={2}` 折叠展示。
  - 「容器名称 / 状态 / 标签 / 重启策略」表头接入 `SortableTh`；默认 `sortKey=name` 升序。
  - 排序权重：状态 `running(0)→restarting→paused→exited→dead→stopped→created→removing`（未知 99）；标签按名称 `join` 后 `localeCompare("zh")`、相同时按标签数量；重启策略 `always→unless-stopped→on-failure→no`（未知 9）。各键值相同一律回落到名称升序作二级稳定排序。
- 验证：前端 `tsc --noEmit` 通过；老用户升级后列配置自动补「标签」列。
- 判定：容器页新标签列 + 排序交互，属本 Minor 的功能主体，并入 v1.9.0。

### 堆栈管理页：新增「标签」聚合列 + 「容器」列 + 名称默认排序 + 多列排序（并入 v1.9.0）
- 需求：堆栈列表默认按名称首字母排序；新增标签列（各服务标签汇聚）与容器列；名称 / 状态 / 标签 / 容器列支持点击表头排序。
- 前端 `pages/Stacks.tsx`：
  - 新增 `collectStackTags(stack)`：遍历 `stack.webuiLabels` 上各服务标签按 `id` 去重聚合为堆栈标签；标签单元格无标签显示 `—`，有标签用 `TagGroup` 展示（多标签折叠 `+N`）。
  - 「堆栈名称 / 状态 / 标签 / 容器」表头接入 `SortableTh`；默认 `sortKey=name` 升序。
  - 排序权重：状态 `running(0)→partial→stopped→error→updating`（未知 99）；标签按聚合后名称 `join` 比较、相同时按标签数量；容器列按 `totalContainers` 差、再按 `runningContainers` 差；各键值相同回落到名称升序二级稳定排序。
- 验证：前端 `tsc --noEmit` 通过。
- 判定：堆栈页标签聚合列 / 容器列 + 排序交互，属本 Minor 的功能主体，并入 v1.9.0。

### 侧边栏折叠为图标窄栏（并入 v1.9.0）
- 需求：页面左上角「Docker 管理容器 & 堆栈平台」标题旁增加折叠按钮，可将主菜单折叠为仅图标的窄栏。
- 前端 `App.tsx`：新增 `sidebarCollapsed` 状态——初值读 `localStorage.sidebarCollapsed`，切换即写回（刷新保持）；顶栏标题旁 Chevron 按钮折叠/展开。
- 前端 `components/Sidebar.tsx`：接收 `collapsed` / `onToggleCollapsed`，宽度在窄栏图标模式（`w-16`，仅显图标、文字改 `title` 悬浮）与完整模式（`w-56`）间过渡；导航高亮与角标（通知中心 / 系统设置更新角标）在窄栏下保留。
- 验证：前端 `tsc --noEmit` 通过。
- 判定：侧边栏折叠为图标窄栏，UI 交互新能力，并入 v1.9.0。

---

### 「Docker 引擎配置」改名「引擎配置」+「镜像加速源」独立成卡（Patch，并入 v1.9.0）
- 需求：系统设置页侧边栏与页内标题的「Docker 引擎配置」改名为「引擎配置」；「镜像加速源」从原「Compose 命令」卡片中拆出，单独成立卡片区域。
- 前端 `Settings.tsx`：
  - 改名：侧边栏 Section `label`（key `docker`）「Docker 引擎配置」→「引擎配置」；页内 `h2` 标题同步改名；保存校验提示（轮询间隔 / Compose 存储路径）前缀「Docker 引擎配置：」→「引擎配置：」；校验注释同步。
  - 拆卡：「镜像加速源」区块（权限徽章 / 刷新 / 重启 Docker 按钮、加速源列表与拖拽排序、推荐加速源、daemon.json 其它配置项、「拉取时改写镜像名」开关与改写预览）从 `<Card title="Compose 命令">` 中移出，独立为 `<Card title="镜像加速源" icon={<Globe size={16} />}>`；「Compose 命令」卡保留 Compose 模式设置与「菜单显示语言」。
  - 去冗余：独立成卡后，卡内不再重复「镜像加速源」小标题与图标（卡片标题已表明），仅保留右对齐的权限徽章与操作按钮。
- 说明：纯 UI 结构调整；设置项的数据流与后端读写（宿主机 `/etc/docker/daemon.json` 的 registry-mirrors）均不变。
- 验证：前端 `tsc --noEmit` 通过。
- 判定：UI 文案与布局调整，非新功能模块 → Patch。**原拟升 v1.8.5；因 v1.8.5 未发布即并入含 Minor 的本次发布，最终合并升为 v1.9.0。**

### 数据卷大小不显示修复 + 卷名称折叠（Patch，并入 v1.9.0）
- 需求：数据卷列表「大小」列恒为「—」；卷名称过长（如 64 位 hash 名）把表格撑得很宽。
- 根因（大小）：Docker Engine API v1.42+ 弃用了 `GET /volumes?size`，`UsageData.Size` 不再随列表返回，前端 `transformVolumes` 拿不到数据只能显示「—」。
- 后端 `docker.ts` `getVolumes`：
  - 列表仍走 dockerode（不变），大小改由 `docker system df -v`（CLI 对每个卷跑 du）解析「Local Volumes space usage」表格回填 `UsageData.Size`。
  - 引擎路由与镜像拉取铁律一致：SSH=远程 CLI（`sshExec`）、TCP=本地 CLI + `DOCKER_HOST`、socket=本地 CLI；CLI 失败/超时不抛错，大小退回「—」。
  - 新增 60 秒卷大小缓存（按 engineId），切页/多端重复刷新不重复触发全量 du 统计。
- 前端 `Volumes.tsx`：
  - 卷名称单元格加 `truncate max-w-[220px]` 折叠 + `title` 悬浮显示全名；去掉该单元格 `whitespace-nowrap`。
  - 统计卡「已统计大小（个数）」→「总占用空间」（汇总各卷字节数），部分卷未统计到时标注「（n/m 已统计）」。
- 验证：前后端 `tsc --noEmit` 通过；产物校验 `总占用空间` 文案存在。
- 判定：既有「数据卷列表」功能的修复与 UI 完善，非新功能模块 → Patch，并入 v1.9.0。

### 仪表盘磁盘占用拆分：镜像 / 数据卷分开显示（Patch，并入 v1.9.0）
- 需求：仪表盘资源监控中「Docker 磁盘占用（镜像 + 数据卷）」一行拆分为「Docker 镜像占用」「Docker 数据卷占用」两行，分别显示。
- 后端 `docker.ts` `getEngineResourceStats`：`dockerDiskMB`（镜像+卷合计）拆为 `imageDiskMB`（`df.Images` Size 合计）与 `volumeDiskMB`（`df.Volumes` UsageData.Size 合计）两个字段；`/system/df` 拿不到卷大小时回退复用 `docker system df -v` 的 60s 卷大小缓存，与数据卷页口径一致。
- 前端 `types.ts` `EngineResourceStats` 同步字段；`Dashboard.tsx` 磁盘行拆为两行：镜像行 note「n 个本地镜像」（琥珀色 HardDrive 图标）、数据卷行 note「命名卷合计」（蓝色 Database 图标）。
- 说明：仅拆分展示口径，统计来源不变；容器可写层仍按原口径计入镜像侧，避免重复计。
- 判定：既有「仪表盘资源监控」展示的拆分，非新功能模块 → Patch，并入 v1.9.0。

### 备份历史支持删除（Patch，并入 v1.9.0）
- 需求：设置页「备份历史」原为写死的示例数据（假文件名、无功能的下载/刷新按钮），需要改为真实备份文件列表并支持删除。
- 后端 `docker.ts`：新增 `listBackups()`（扫描 `DATA_DIR/backups` 下 `*.tar.gz`，返回 name/size/mtime，按时间倒序）与 `deleteBackup(name)`（`path.resolve` + 前缀校验防路径穿越，仅允许删除 backups 目录内文件）。
- 后端 `index.ts`：新增全局路由 `GET /api/backups`（列表，与引擎无关——备份始终落在本机 `DATA_DIR/backups`）与 `DELETE /api/backups/:name`。
- 前端 `api.ts`：`fetchBackupsApi` / `deleteBackupApi` + `BackupFileInfo` 类型。
- 前端 `Settings.tsx` 备份管理页：「备份历史」卡改为真实列表（文件名 mono 折叠 + title、时间 • 大小 • 堆栈名（从文件名解析）、卡片右上角刷新按钮）；每行删除按钮 → 红色危险确认弹窗（提示删除后无法恢复）；空状态提示「堆栈页右键备份生成」。
- 验证：前后端 `tsc --noEmit` 通过。
- 判定：既有「备份管理」功能的补全（列表真实化 + 删除操作），非新功能模块 → Patch，并入 v1.9.0。

### 「菜单显示语言」独立成卡（Patch，并入 v1.9.0）
- 需求：系统设置引擎配置页中，「菜单显示语言」区块从「Compose 命令」卡片拆出，单独成立卡片区域。
- 前端 `Settings.tsx`：「菜单显示语言」独立为 `<Card title="菜单显示语言" icon={<Languages size={16} />}>`（新增 `Languages` 图标导入）；卡内只保留「语言选择」下拉，去掉原区块小标题与分隔线（卡片标题已表明内容）；「Compose 命令」卡仅保留 Compose 模式设置、检测可用命令与查看方法。
- 说明：纯 UI 结构调整，设置项数据流（`docker.menuLanguage`）不变。
- 判定：UI 布局调整，非新功能模块 → Patch，并入 v1.9.0。

### 网络显示改为实时速率（Patch，并入 v1.9.0）
- 需求：仪表盘资源监控「网络 I/O（累计）」显示容器自启动以来的累计字节数，实际想看的是当前速率，改为实时 I/O。
- 后端 `docker.ts` `getEngineResourceStats`：新增按引擎的上次采样快照 `lastNetSnapshot`（ts + 累计 rx/tx KB），本次累计值与快照差分除以间隔秒数得出速率；首次采样无基线为 0；容器重启计数器回卷导致差分为负时钳为 0。返回字段 `netRxKB`/`netTxKB`（累计）替换为 `netRxKBps`/`netTxKBps`（KB/s，保留一位小数）。SSE 1 秒一采天然形成基线，REST 单次请求第二次起也有速率。
- 前端：`types.ts` 字段同步；`Dashboard.tsx` 行标签「网络 I/O（累计）」→「网络 I/O」，显示 `↓ x KB/s / ↑ x KB/s`，note「运行容器实时速率」。
- 说明：容器详情页的 `getContainerStats`（单容器累计值展示）不受影响。
- 判定：既有「仪表盘资源监控」展示口径调整，非新功能模块 → Patch，并入 v1.9.0。

### 堆栈操作改为实时进度弹窗（SSE 流式）（Patch，并入 v1.9.0）
- 需求：堆栈点击启动/停止/重启/拉取/构建时，页面顶部会显示「正在执行操作...」的不确定进度条，操作完成前看不到任何输出；改为**不显示该进度条，点击后立即弹出命令输出弹窗实时滚动显示 compose 输出**。
- 后端 `docker.ts`：新增 `stackActionStream(engine, stackName, actions, onChunk)`。
  - 用异步 `spawn` 代替 `spawnSync`（不阻塞事件循环，SSE 才能边执行边推送）；stdout/stderr 每来一块即通过 `onChunk` 回调（compose 进度几乎全在 stderr）。
  - 支持一次执行多个动作（强制更新 = `pull` + `up`、构建并启动 = `build` + `up`），每步输出前加 `$ docker compose ...` 标头，与 `stackAction` 的输出格式一致；`restart` 同样拆为 `down` + `up` 两步。
  - 超时沿用原口径：`down` 60s、其余 300s；失败时 `Error.output` 携带「已推送的全部输出」，与 `stackAction` 失败语义一致。
- 后端 `index.ts`：新增 SSE 路由 `GET /api/engines/:id/stacks/:name/actions/stream?steps=pull,up`，事件 `chunk`（增量输出）/ `done`（全部成功，完整输出）/ `fail`（失败详情）；客户端断开只停止推送，compose 进程继续执行完毕。注册的 POST 通配路由 `/stacks/:name/:action` 之前（二者路径不冲突，但保持语义分组）。
- 前端 `api.ts`：新增 `streamStackActions()`（EventSource 封装）——**动作类连接禁止自动重连**（重连会重复执行操作），收到 done/fail 即 `close()`；`onerror` 仅在未收到 done/fail 时才视为中断报失败；返回 `close()` 句柄。
- 前端 `components/CmdOutputModal.tsx`：`CmdOutput` 增加 `streaming` 字段；执行中标题带旋转图标 + 「执行中」，正文为白色流式文本，按钮为「后台运行」（关闭仅隐藏弹窗，操作继续）；`useCmdOutput()` 新增 `patchOutput()` 用于增量更新弹窗内容。
- 前端 `components/Modal.tsx`：`title` 类型放宽为 `ReactNode`（支持带转圈图标的节点）。
- 前端 `pages/Stacks.tsx`：移除「正在执行操作...」`ProgressBar` 区块；`handleStackAction` / `handleStackSteps` 合并为 `runStackActionStream`（点击 → `addOperating` → 立即弹空弹窗 → SSE 逐块 `patchOutput`）；并发安全：SSE 句柄按堆栈名存 `Map`（多堆栈可同时操作，互不干扰），只有占据弹窗的堆栈才写入弹窗内容（避免输出串台），组件卸载时统一关闭；完成/失败均记录操作日志并刷新列表。
- 说明：删除 / 备份 / 恢复 / 批量操作仍走原 REST 接口（完成后弹窗），不在本次改动范围。
- 验证：前后端 `tsc --noEmit` 通过。
- 判定：既有「堆栈操作」交互的完善（同一功能的展示方式改造，非新功能模块）→ Patch，并入 v1.9.0。

### 拉取进度弹窗改为 tail 文本（去掉「镜像层」与「总进度」条）（Patch，并入 v1.9.0）
- 需求：拉取进度弹窗原本分三块——总进度条（字节）、镜像层列表、输出日志。
  - 「镜像层」列表视觉上信息密度低，价值不高，去掉。
  - 「总进度」条上的「已下载 0.0MB」一直为 0，是个明显的 bug。原因：依赖 `layer.current` / `layer.total` 这两个字段，但
    - CLI 路径只在进度行（`1.2MB/45.6MB`）里更新它们，进入「Download complete / Pull complete / Verifying Checksum」阶段后行里没字节，字段就再不被赋值；
    - Dockerode API 路径的 `evt.progressDetail` 也只在「Downloading」事件里存在，完成事件里是 undefined；
    - 所以完成中或完成后字节总和恒为 0。
  - 用户希望用 tail 文本（终端风格输出）显示进度，不再需要上述两块。
- 前端 `Images.tsx`：
  - 新增模块顶层 `parsePullTailSizes(tail)`：扫 outputTail 里 `<hash>: <current>/<total>` 形式的行，按层 ID 保留 max current / max total 再求和（避免同一层多行重复累加），返回 `{current, total}` 或 null（无字节行时）。
  - 新增模块顶层 `fmtBytes(b)`：B / KB / MB / GB 自动切换。
  - 新增模块顶层组件 `PullOutputPanel`：终端风格 pre 块（`bg-slate-900 text-slate-200`，min-h 200px / max-h 60vh），自动 `scrollTop` 跟到底，tail 为空时显示「正在连接…」占位；右对齐显示解析出的字节小字（解析不到显示 `— / —`）。
  - 删除原「总进度」字节条 + 「镜像层 (n)」两层列表，弹窗「拉取中」分支直接 `<PullOutputPanel tail={...} />`。
  - 完成态（success / canceled / error）的 tail 区也改为复用 `<PullOutputPanel>`，与拉取中视觉一致。
  - 任务条简报里的字节小字也改为 `parsePullTailSizes` 解析（之前是 `pullTaskBytes` 求和 `layer.current` / `layer.total`），移除原 `pullTaskBytes`。
- 说明：纯前端调整。后端 `pullTasks`/`layers` 数据流不变（仍然在记录），只是 UI 不再用；后端解析器（`handleCliPullLine`）继续维护 `layer.current/total` 以保留向后兼容（若以后想恢复「镜像层」视图可直接复用）。
- 验证：前后端 `tsc --noEmit` 通过；手动模拟 tail 输入解析（`55afa1ec: 1.2MB/45.6MB` + `ac8c8d4d: Download complete`）确认只对带字节的行求和、按层 ID 去重。
- 判定：既有「拉取进度」展示的改造（同一功能的 UI 重做，非新功能模块）→ Patch，并入 v1.9.0。

---

## v1.8.4 — 2026-09-02
### 待应用本地更新包自动销毁 10 分钟 → 2 分钟（Patch）
- 需求：待应用更新包自动销毁时限由 10 分钟改为 2 分钟，倒计时从 120 秒（mm:ss 02:00）起跳。
- 后端 `updater.ts`：`PENDING_TTL_MS = 10*60*1000` → `2*60*1000`。
- 后端 `index.ts`：`/upload` 排程自动销毁的注释「10 分钟内」→「2 分钟内」。
- 前端 `Settings.tsx`：上传成功提示「10 分钟内点击「更新」应用」→「2 分钟内」。
- 验证：前后端 `tsc --noEmit` 均通过。
- 判定：既有「上传更新包」交互的参数调整（销毁时限缩短），非新功能模块 → Patch（v1.8.3 → v1.8.4）。

### 容器列表「网络模式」独立成列（Patch）
- 需求：容器管理页把「网络模式」从「容器名称」单元格副标题移出，新建独立列，放在「端口映射」与「运行时长」之间。
- 前端 `Containers.tsx`：`ColumnKey` 增加 `network`；`allColumns` 列选择器配置在 ports/uptime 之间加「网络模式」；表头 thead 与表体 tbody 在端口映射、运行时长之间加 network 列；移除名称单元格内 `container.networkMode` 副标题；CSV 导出表头与行数据同步插入「网络模式」列。展开详情面板仍保留「网络模式」字段。
- 验证：前端 `tsc --noEmit` 通过。

### 容器列表详情弹窗仅右键打开（Patch）
- 需求：容器管理页面左键和右键都能打开详情弹窗，改为只有右键能打开。
- 前端 `Containers.tsx`：移除容器行 `<tr>` 上的 `onClick={() => setDetailContainer(container)}`（左键打开详情），仅保留 `onContextMenu`（右键 `handleContextMenu` 打开详情并定位到 info 标签）。行内「选择/展开/WebUI」等单元格的 onClick 均带 `stopPropagation`，不受影响。

### 移除 Docker 全局配置「默认参数」卡片（Patch）
- 需求：去除系统设置 - Docker 全局配置内的「默认参数」区块。
- 前端 `Settings.tsx`：删除整张「默认参数」`Card`，含其下「默认重启策略 / 默认网络模式 / 状态轮询间隔（秒）」与「全局默认环境变量（PUID / PGID / TZ）」子段；section 副标题「管理 Docker Engine 连接和默认参数」→「管理 Docker Engine 连接与全局配置」。
- 说明：`defaultRestartPolicy`、`defaultNetworkMode`、`pollingInterval`、`puid`、`pgid`、`tz` 仍在 `types.ts` / `server/settings.ts` / `settings.json` 中保留（历史上从未被后端创建流程注入，属存而不用的惰性配置），仅不再于 UI 暴露。如需彻底从数据模型清除可另行清理。
- 验证：前端 `tsc --noEmit` 通过。

### Docker 全局配置 → Docker 引擎配置（Patch）
- 需求：系统设置页侧边栏与页内标题的「Docker 全局配置」改名为「Docker 引擎配置」。
- 前端 `Settings.tsx`：侧边栏 Section 标签（line 698）、页内 `h2` 标题（line 777）改文案；校验错误提示（line 644/647）与校验注释（line 642）同步改为「Docker 引擎配置」。
- 验证：前端 `tsc --noEmit` 通过。

### 修复镜像管理「清理悬空」按钮对远程引擎不生效（Patch）
- 需求：镜像管理页「清理悬空」按钮对 SSH 远程引擎点击后无实际清理（dockerode 经 SSH 隧道调用 prune 行为不可靠，呈现「点了没反应」）。
- 后端 `docker.ts`：`pruneImages` 增加分支——`connectionType === "ssh"` 时走远程 `docker image prune -f` CLI（`sshExec`），解析 `deleted:` 与 `Total reclaimed space:` 输出为前端统一格式 `{ImagesDeleted, SpaceReclaimed}`；本地 socket 与直连 TCP 引擎仍走 `docker.pruneImages()`。新增 `parseDockerSizeToBytes` 解析容量单位。前端链路（按钮 → 确认弹窗 `onConfirm` → `handlePruneDangling` → `pruneImagesApi` → 后端路由 `/api/engines/:id/images/prune` → 结果弹窗）本就接通，无改动。
- 验证：前后端 `tsc --noEmit` 均通过。

### 新增镜像管理「清理未使用」按钮（Patch）
- 需求：镜像管理页在「清理悬空」旁边新增「清理未使用」按钮，删除所有未被容器引用的镜像（等价 `docker image prune -a`），与仅删悬空的「清理悬空」区分开。
- 后端 `docker.ts`：`pruneImages(engine, opts?)` 增加 `all` 参数。`connectionType === "ssh"` 走远程 `docker image prune -a -f` CLI（超时放宽到 120s），输出解析复用 `parseDockerSizeToBytes`；本地 socket/TCP 引擎 `all=false` 仍 `docker.pruneImages()`，`all=true` 分两次调用（`filters.dangling:["true"]` + `["false"]`）合并 `ImagesDeleted` / `SpaceReclaimed`，等价 `-a`。`server/index.ts` 路由读取 `req.body.all`，日志与文案区分「清理悬空」/「清理未使用」。
- 前端 `api.ts`：`pruneImagesApi(engineId, all=false)` 改 POST 并带 `{ all }` body。`Images.tsx`：新增 `unusedCount` / `unusedSize` 统计（未被容器引用的镜像，含悬空）、`handlePruneUnused`、`confirmCleanUnused` 确认弹窗与红色「清理未使用 (n)」按钮；`formatImagePrune` 空结果文案统一为「无需清理」。
- 验证：前后端 `tsc --noEmit` 均通过。
- 判定：镜像管理既有「清理」能力的补全（同类操作新增一个按钮，非新功能模块）→ Patch，并入 v1.8.4（尚未发布）。

### 数据卷管理「清理悬空卷」改名「清理未使用卷」（Patch）
- 需求：数据卷管理页「清理悬空卷」按钮与 `docker volume prune` 的实际语义不符——卷没有「悬空（dangling）」概念，`prune` 删除的是**未被容器引用的卷**（未使用 / 未关联卷）；「悬空」是镜像术语，易被误解为只删孤儿卷。
- 前端 `Volumes.tsx`：按钮「清理悬空卷」→「清理未使用卷」；确认弹窗标题「清理悬空数据卷」→「清理未使用数据卷」；统计卡与详情面板状态「未使用（悬空）」→「未使用」。操作日志与命令输出弹窗本就记为「清理未使用数据卷」，改名后全站文案一致。
- 说明：仅 UI 文案调整；`pruneVolumesApi` / 后端 `pruneVolumes` 行为不变（仍为 `docker volume prune`，删除所有未被容器引用的卷）。
- 验证：前端 `tsc --noEmit` 通过。
- 判定：UI 文案修正，非新功能模块 → Patch，并入 v1.8.4（尚未发布）。

---

## v1.8.3 — 2026-09-02
### 待应用本地更新包 10 分钟自动销毁 + 倒计时（Patch）
- 需求：上传的本地更新包若 10 分钟未手动点击「更新」则自动销毁，并在页面显示倒计时。
- 后端 `updater.ts`：新增 `PENDING_TTL_MS = 10*60*1000`、`pendingExpiryTimer`、`schedulePendingExpiry`（按 `uploadedAt + TTL` 计算剩余、到点 `clearPendingUpload`）、`cancelPendingExpiry`（应用前取消，避免误删正在应用的包）、`discardPendingUpload`（手动丢弃）；`getPendingUpload` 返回 `ttlMs` / `expiresAt`。
- 后端 `index.ts`：`/upload` 落盘后 `schedulePendingExpiry`；新增 `DELETE /api/system/update/local`（主动丢弃）；`/apply-local` 应用前 `cancelPendingExpiry`；服务启动监听后 `schedulePendingExpiry`（处理重启遗留包）。
- 前端 `Settings.tsx`：`pendingUpload` 状态增加 `ttlMs/expiresAt`；`nowTick` 每秒心跳驱动倒计时；待应用包框显示 `mm:ss 后未更新将自动销毁`（含「丢弃」按钮）；倒计时归零（且未在更新中）自动调 `discardPendingUploadApi` 清状态；上传成功后重新拉取完整 pending 以对齐倒计时起点。`api.ts` 新增 `discardPendingUploadApi`。
- 验证：前后端 `tsc --noEmit` 均通过。
- 判定：既有「上传更新包」交互的完善（新增自动销毁与倒计时），非新功能模块 → Patch（v1.8.2 → v1.8.3）。

---

## v1.8.2 — 2026-09-02
### 系统更新说明文案去重与合并（Patch）
- 此前「系统更新」页说明分散且语义重叠（卡片标题「更新源配置」与正文「更新源（已固定写死…）」重复「更新源」；副标题、自动检查说明、升级说明三段各说一部分）。现合并为**单处权威「升级说明」**：
  - 副标题精简为「应用内一键升级到 GitHub Releases 最新版本（linux-x64 交付包），也支持上传本地更新包离线升级」。
  - 更新源正文去掉重复前缀，改为「来源（已固定写死，无需配置）：yanziruxue/docker-manager ● 公开仓库」。
  - 「升级说明」框合并覆盖：升级流程（下载 / 解压 / 覆盖 / systemd 重启）、无需 root、升级前自动备份、固定公开仓库来源、三触发条件（网页刷新 / 后端启动 / 每 6 小时）、以及本地更新包「上传仅保存、点击「更新」按钮手动应用」的离线流程。
- 判定：纯 UI 文案完善，非新功能模块 → Patch。

---

## v1.8.1 — 2026-09-02
### 本地更新包：上传与应用拆分为两个独立步骤（Patch）
- 此前「上传更新包」点击即把 zip 上传并**立即执行**更新（fire-and-forget），难以确认包内容或中止。现拆为两步：
  - **上传更新包**：仅将 zip 保存为待应用包（`data/update/pending-update.zip`），返回包信息，不执行更新；重复上传覆盖旧包。
  - **更新**：当有待应用包时，「检查与升级」卡片显示独立绿色「更新」按钮（与蓝色「检查更新」区分），点击才应用（解压 / 校验 / 替换 / 重启）。
- 后端：新增 `POST /api/system/update/upload`（仅落盘，校验 zip 魔数 `PK`）、`GET /api/system/update/local`（查询待应用包）、`POST /api/system/update/apply-local`（手动应用 pending 包）；`updater.ts` 新增 `getPendingUploadPath / saveUploadPackage / getPendingUpload / clearPendingUpload`。应用成功后由 `applyLocalZip` 自动清理 pending 包。进入页面 / 刷新后 `fetchPendingUploadApi` 恢复待应用提示。
- 验证：前端 `tsc --noEmit`、后端 `tsc -p server/tsconfig.json --noEmit` 均通过。

---

## v1.8.0 — 2026-09-01
### 忽略更新 + 自动更新（Minor）
- **忽略更新**：检测到新版本时「检查与升级」卡片新增「忽略此版本」按钮，点击后将 `update.ignoredVersion` 写入该版本号，侧边栏「系统设置 / 系统更新」角标与更新提示立即隐藏；已忽略时在卡片显示「已忽略版本 vX.Y.Z」+「恢复提示」按钮清除。`doCheck` 命中 `info.latestVersion === ignoredVersion` 时不置角标。
- **自动更新**：`更新源配置` 卡片新增「自动更新」子开关（仅「自动检查更新」开启时可启用，否则禁用），开启后 `doCheck` 检测到有更新即自动 `applyUpdateApi()` 下载应用；`App.tsx` 新增 `triggerAutoUpdate` 调后端并监听 `/system/version` 先失联再恢复即 `window.location.reload()`（任一时段自动升级完成都同步到新前端）。`UpdateConfig` 新增 `autoUpdate` / `ignoredVersion` 字段。
- 版本判定：新增「自动更新」执行能力 + 「忽略更新」交互，属新功能模块 → Minor（v1.7.6 → v1.8.0）。
- 验证：前端 `tsc --noEmit` 通过。

---

## v1.7.6 — 2026-09-01
### 自动检查更新增加每 6 小时周期轮询（Patch）
- 此前「自动检查更新」仅在应用启动 / 页面加载时检查一次，长开页面不刷新则不会再次发现新版本。现改为三触发条件任一满足即检查：**网页刷新（挂载）**、**后端启动（首次访问）**、**每 6 小时定时轮询**。
- 实现：`src/App.tsx` 初始化 `useEffect` 内，开启 `autoCheck` 时挂载即 `doCheck()` 一次，并 `setInterval(doCheck, 6*60*60*1000)`；`useEffect` 返回 cleanup `clearInterval`。纯前端改动，后端 `checkForUpdate` 无需缓存（GitHub 未鉴权 API 限 60 次/小时，6h 一次远低于阈值）。
- 验证：前端 `tsc --noEmit` 通过。

---

## v1.7.5 — 2026-09-01
### 编辑堆栈 LABELS 自动识别端口与 WebUI 地址（Patch）
- 此前 LABELS 自动识别仅补全服务名，端口/地址需手填。现扩展 `parseComposeServices`：识别 `ports:` 下第一行端口映射的**宿主机端口**（英文冒号左侧），兼容 `hostPort:containerPort`、`ip:hostPort:containerPort`、`ports: - 8807:8080` 同行写法；仅容器端口（`8080`）不识别。
- 自动填充缺失服务时：`webuiPort` = 宿主机端口；`webuiUrl` = `地址栏 scheme://hostname : 端口`（如访问 `http://192.168.1.10:8807` 时识别到 `8807` → `http://192.168.1.10:8807`）。用户已配置项不被覆盖。
- 验证：前端 `tsc --noEmit` 通过；最小复现 5 组用例（4 空格 / 用户示例 8807:8080 / 3 空格 ip 前缀 / 多服务仅容器端口 / 同行写法）端口识别全部正确。

---

## v1.7.4 — 2026-09-01
### 更新完成后自动刷新页面（Patch）
- 此前更新进度到 `done` 后仅定格文案「升级完成，服务即将自动重启…」，需用户手动 F5 才能加载新前端（后端已替换为新二进制，但浏览器仍是旧前端 bundle）。
- 实现：后端 `done` 后 1.5s 退出、由 systemd `Restart=always` 拉起新进程。`src/pages/Settings.tsx` 新增 `waitForRestartAndReload`：两阶段轮询 `/system/version`（`fetchAppVersion`）——先等其**失联**（确认旧进程已退出），再等其**恢复响应**（新进程已上线），随即 `window.location.reload()` 加载新前端。避免过早刷新到尚未退出的旧进程。异常兜底：旧进程 30s 内未失联 / 新进程 90s 未上线则提示手动刷新，不卡死。
- 验证：前端 `tsc --noEmit` 通过。

---

## v1.7.3 — 2026-09-01
### 修复：编辑堆栈 LABELS 无法识别 Compose 服务（Patch）
- 根因：`src/pages/Stacks.tsx` 的 `parseComposeServices` 用 `trimmed = line.trimEnd()`（仅去行尾、保留行首缩进），而服务名 / `container_name` 两处正则用 `^` 开头锚定，要求行首即字母数字——缩进服务名（如 `    gopeed:`）的 `^` 直接失败，导致对**所有真实（必缩进）的 compose 返回 `[]`**。
- 影响：编辑堆栈 LABELS 页「自动识别服务」失效（提示「未在 Compose 中识别到服务」）、`.ENV` 模板生成器不输出服务端口变量。
- 修复：两处正则加 `^\s*`（服务名 `/^\s*([a-zA-Z0-9_.-]+)\s*:/`、container_name `/^\s*container_name\s*:\s*["']?([a-zA-Z0-9_.-]+)/`）。已用最小复现验证：4 空格 / 3 空格 / 2 空格、含注释行、多服务、`container_name` 优先等场景均正确识别。
- 验证：前端 `tsc --noEmit` 通过。

---

## v1.7.2 — 2026-09-01
### 有可用系统更新时侧边栏显示角标（Patch）
- 检测到 OTA 新版本时，在全局侧边栏「系统设置」项旁、设置页内部子导航「系统更新」项旁显示红色「1」角标，提示下方有 1 处可用更新。
- 全局状态上提至 `App`：新增 `appUpdateAvailable`，尊重 `设置 → 更新调度器 → 自动检查更新` 开关，启动即探测；手动「检查更新」与更新完成后通过 `onUpdateAvailableChange` 回传同步全局角标（更新完成自动清除）。

---

## v1.7.1 — 2026-09-01
### 上传 zip 升级：修复 source 标记、异步落盘、清理废弃包（Patch）
- 代码评审（v1.7.0）发现的 3 处修复/优化，均属 Patch 级：
  - **P1**：`applyLocalZip` 增加 `source` 参数，OTA 写入 `github`、本地上传写入 `local`，修正「last-update.json 的 source 写死 github」导致上传包被误记为 OTA 来源。
  - **P2**：上传路由 `index.ts` 由同步 `writeFileSync` 改为 `fs/promises.writeFile` 异步落盘，避免 300MB 包写入时阻塞事件循环（期间所有 API/SSE/WS 冻结）。
  - **P3**：`applyLocalZip` 替换成功后删除已落盘的 zip 包（`local-<ts>.zip` / `docker-manager-yanzi-<ver>.zip`），`data/update/` 不再累积废弃包；`.bak.<version>` 回滚备份保留。

---

## v1.7.0 — 2026-09-01
### 检查更新支持上传 zip 本地升级
- **需求**：除 GitHub OTA 下载外，新增「上传更新包」入口，直接将本地构建的 `docker-manager-yanzi-linux-x64.zip` 应用到本机，跳过联网下载。适用于离线环境、内网或自定义构建。属新增更新入口（新接口 + 新 UI 控件 + 独立流程），按 Minor 递增。
- **后端**（`server/updater.ts` / `server/index.ts`）：
  - `performUpdate` 内的「解压 → 校验 → 替换 → 重启」抽成独立 `applyLocalZip(zipPath, label)`，OTA 下载路径与上传路径共用，避免两套逻辑分叉。
  - 新增 `performUpdateFromUpload(zipPath)`：跳过下载，直接复用同一套应用管线；进度经 `getUpdateState` 同通道下发，前端轮询复用现有进度 UI。
  - 新增 `POST /api/system/update/upload`（`express.raw`，上限 300MB）：校验 zip 魔数 `PK`、防重复触发（更新进行中返回 409），落盘后 fire-and-forget 调 `performUpdateFromUpload`；`getUpdateDir` 改为导出供路由使用。
- **前端**（`src/pages/Settings.tsx` / `src/api.ts`）：「检查更新」卡片新增「上传更新包」按钮 + 隐藏 file input；`uploadUpdateZipApi` 以 `application/zip` 直传文件字节；点击即乐观置「应用本地更新包」并启动轮询，与 OTA 共用进度条/状态。

---

## v1.6.4 — 2026-09-01
### 图标支持直接填入 SVG 代码
- **需求**：堆栈图标此前只支持「URL / 上传本地图片」，现在可直接粘贴 SVG 源码作为图标。属对既有图标能力的完善，故按 Patch 递增。
- **前端**（`src/pages/Stacks.tsx`）：
  - 图标输入框新增「SVG」按钮打开代码编辑器；编辑器含源码文本框 + 实时预览 + 体积/错误提示，应用后写入既有 `iconUrl` 字段（以 `data:image/svg+xml;base64,` 形式内嵌）。
  - 输入框直接粘贴 SVG 源码也会自动识别并转成 data URI（无需点按钮）。已内嵌 SVG 时表单改为「显示条 + 编辑代码 / 清除」两种操作。
  - 安全清洗：转存前剔除 `<script>` / `<foreignObject>`、所有 `on*` 事件属性、`javascript:` 链接；单张上限 100 KB。图标最终以 `<img src="data:...">` 渲染，浏览器不执行 SVG 内脚本。
  - 纯函数（识别 / 清洗 / base64 往返 / 校验）经 23 项冒烟测试全通过（含中文注释往返、脚本与事件属性剔除、体积上限）。
- **后端**：无需改动——`iconUrl` 本就是透传字符串，data URI 与 URL 走同一条存储与渲染链路。

---

## v1.6.3 — 2026-09-01
### 完善 OTA 升级进度：显示实时下载速度与剩余时间
- **需求**：升级时进度条只显示 `1.5/40.8 MB`，无法判断下载快慢与还要多久。属对既有升级进度展示的完善，故按 Patch 递增。
- **后端**（`server/updater.ts`）：
  - `UpdateState` 新增 `bytesReceived` / `bytesTotal` / `speedBps` / `etaSeconds` 四个字段，`setState()` 增加可选 extra 参数承载它们。
  - 下载循环内统计速度：**每 200ms 采样一次瞬时速度并做 EMA 平滑（0.7 旧 + 0.3 新）**，避免数字剧烈跳动；起步阶段 EMA 未生成时回退到「已下载量 / 已耗时」的平均值。剩余秒数 = `(总字节 - 已下载) / 速度`。
  - 状态上报**节流为 200ms 一次**（原为逐 chunk 写入），前端轮询间隔本就是 1.5s，逐 chunk 更新只是无谓的状态写入。
  - 总大小未知（Content-Length 缺失）或速度未测出时 `etaSeconds` 下发 `null`，由前端显示「计算中」而非报错。
- **前端**（`src/pages/Settings.tsx` / `src/types.ts`）：进度条下方新增一行 `Gauge` 速度 + `Timer` 剩余时间；`formatSpeed()` 自动在 KB/s 与 MB/s 间切换，`formatEta()` 输出「12 秒 / 1 分 5 秒」。仅在 `phase === "downloading"` 且 `bytesTotal > 0` 时显示，下载完成或失败重试的过渡态不显示。

---

## v1.6.2 — 2026-08-31
### 彻底修复设置页底部 APPLY 栏遮挡 Release 说明文字
- **根因**：v1.6.1 仅把内容区 `padding-bottom` 加大到 `pb-20`，但 APPLY 栏使用 `sticky bottom-0` 并带有 `mt-6`，滚动到底时按钮条仍覆盖在 padding 区域上方，导致 Release 说明文字继续被遮挡。
- **修复**：将右侧内容区改为 `flex-col` 布局，可滚动内容区与 APPLY 状态栏拆分为兄弟元素；APPLY 栏不再 `sticky`，而是作为固定底部栏（`flex-shrink-0`）置于滚动区域之外，从根本上避免任何底部内容被遮挡。

---

## v1.6.1 — 2026-08-31
### 修复设置页底部 APPLY 栏遮挡 Release 说明文字（未完全生效）
- 设置页内容区由 `p-6` 改为 `p-6 pb-20`，尝试为底部 sticky 的 APPLY 状态栏预留空间。

---

## v1.6.0 — 2026-08-31
### 镜像加速源增加「推荐加速源 · 一键填入」
- 设置页「镜像加速源」区块新增蓝色提示卡，列出 2026-08 实测可用的公益 Docker Hub 代理源（轩辕镜像 `https://docker.xuanyuan.me`、毫秒镜像 `https://docker.1ms.run`），并提供「一键填入」按钮（自动跳过已存在的源）。
- 提示卡内标注两点避坑：fnnas 等只镜像私有仓库的源不会代理 Docker Hub，勿置优先位；网易 `hub-mirror.c.163.com` 已于 2026 停止同步 Docker Hub，勿再配置。

### 新增「一键安装脚本」
- 新增 `scripts/quick-install.sh`，服务器上直接执行以下命令即可自动下载并安装（无需手动下载 zip）：
  ```bash
  curl -fsSL https://github.com/yanziruxue/docker-manager/releases/latest/download/quick-install.sh | sudo bash
  ```
- 支持 `VERSION`（指定版本，默认 `latest`）、`UPDATE_MIRROR`（自定义下载镜像前缀）环境变量；内置 `gh-proxy.com` 国内回退，直连 GitHub 被墙时自动切换。
- 该脚本随 Release 作为附加资源（asset）发布，故上述「latest/download」链接可直接拉取。

---

## v1.5.1 — 2026-08-31
### 修复：sudoers 已正确配置仍误报「无写权限」
- **根因**：权限探测用 `sudo -n true` 判断免密 sudo，但 install.sh 写入的最小授权 sudoers 白名单（cat/tee/mkdir/systemctl/service）里**没有 `true`**，导致已正确授权的环境也被判定为 `elevate: none`，设置页始终显示「无写权限（只读）」。
- **修复**（`server/daemon-config.ts`）：
  - 探测命令改为 `sudo -n -l`——只要存在 NOPASSWD 规则即免密成功，无需白名单包含探测命令本身。
  - 移除读取复核里的 `sudo -n test -f`（`test` 同样不在白名单），统一走白名单内的 `sudo -n cat`，按 stderr 中 "No such file" 区分文件不存在。
- **验证**：服务器上重跑 `sudo bash install.sh` 后无需任何额外操作，设置页能力徽标应显示「可读写·sudo」；若仍显示只读，在服务器上执行 `sudo -u docker-manager-yanzi sudo -n -l` 检查白名单输出。

---

## v1.5.0 — 2026-08-31
### 镜像加速源改为直接读写 /etc/docker/daemon.json（两侧同步 + 重启确认）
- **需求**：设置页「镜像加速源」原先只是一份应用内的镜像名改写列表，与宿主机守护进程实际生效的 `registry-mirrors` 脱节。现在改为以 `/etc/docker/daemon.json` 为唯一真实来源：打开页面回读文件内容，点 APPLY 保存时写回文件，实现两侧同步。
- **后端新增** `server/daemon-config.ts`：
  - `readDaemonConfigInfo()`：读取并解析 daemon.json，返回 `registry-mirrors`、其它配置键、原始文本，以及**权限能力**（`elevate: root | sudo | none`、`canRead/canWrite/canRestart`、运行用户）。文件不存在、JSON 损坏、无读权限分别给出可读原因，不抛 500。
  - `writeDaemonConfig(mirrors)`：在**保留其它配置项**（insecure-registries、log-driver 等）的前提下只改 `registry-mirrors`；空列表则删除该键。写前把原文备份到应用数据目录 `data/daemon-json-backups/`（保留最近 10 份），写后重新读取校验一致性；内容无变化则**不落盘**并返回 `changed=false`，避免无意义的重启提示。
  - `restartDockerService()`：`systemctl restart docker` 优先，回退 `service docker restart`，返回合并的 stdout+stderr 供前端 tail 展示；容器内无 systemctl 时给出明确错误。
  - **提权链路**：root 直接执行 → `sudo -n` 免密 → 无能力时返回可直接粘贴执行的修复建议（sudoers 片段 + systemd 放开项）。
- **新增接口**：`GET/PUT /api/system/daemon-config`、`POST /api/system/daemon-config/refresh-privileges`（配好 sudoers 后免重启服务重新探测）、`POST /api/system/docker/restart`。
- **前端**（`src/pages/Settings.tsx`）：
  - 进入设置页即加载 daemon.json，首次加载以文件内容为准回填加速源列表；区块右上角显示配置来源路径与能力徽标（可读写·root / 可读写·sudo(用户) / 无写权限（只读）），并提供「刷新」「重新检测权限」「重启 Docker」按钮。
  - 无写权限时展示琥珀色提示条 + 可复制的授权命令；写入失败弹窗说明「应用设置已保存，仅 daemon.json 未同步」，并支持一键重新检测。
  - 保存后若 daemon.json 内容发生变化，弹出确认框「是否立即重启 Docker」（可稍后自行重启）；选「是」执行重启，并用共用 `CmdOutputModal` 展示 tail 输出。
- **行为变更（重要）**：加速源不再默认用于**镜像名改写**。
  - 新增开关 `docker.rewriteImageNames`（默认 `false`）：关闭时加速源只写入 daemon.json，由守护进程自行生效；开启才恢复 v1.4.0 及更早的 `<加速源>/<仓库>` 改写行为。
  - 原因：daemon.json 里常见「仅代理私有仓库 / fnnas 类」的源，若同时用于 Docker Hub 镜像名改写会 404，导致拉取失败。
  - **旧配置自动迁移**：已配置过加速源的老版本迁移时 `rewriteImageNames` 置 `true`，保持原有拉取行为不变。
- **部署侧**：`install.sh` 写入 `/etc/sudoers.d/docker-manager-yanzi`（仅放行 cat/tee daemon.json、mkdir /etc/docker、systemctl|service restart docker，写前 `visudo -c` 校验、失败回滚），`uninstall.sh` 同步清理；`docker-manager-yanzi.service` 将 `NoNewPrivileges` 改为 `no`（否则 sudo 的 setuid 被 no_new_privs 拦截）并在 `ReadWritePaths` 增加 `/etc/docker`（否则 ProtectSystem=strict 下 /etc 只读）。
  - 注意：通过**应用内 OTA 升级**不会更新 `.service` 文件，老部署需重跑一次 `install.sh`，或按设置页提示手动执行两条 sed + daemon-reload。

## v1.4.0 — 2026-08-30
### 命令输出弹窗（tail 文本）推广到更多操作
- **重构**：把 Stacks 页内联的 tail 文本弹窗抽取为共用组件 `src/components/CmdOutputModal.tsx`（含 `CmdOutputModal` 组件与 `useCmdOutput` hook），所有页面优先复用，避免重复实现。
- **新增**：**删除堆栈**（`docker compose down`）的命令输出现在完整展示在弹窗中（此前被丢弃，只静默删目录）；失败时弹窗标红显示 compose down 警告。
- **新增**：**备份堆栈**结果（备份文件名）以弹窗形式展示。
- **新增**：**批量操作**逐堆栈执行结果（✓/✗ + 失败原因）汇总到同一个弹窗，一眼看清哪些堆栈成功/失败。
- **新增**：**镜像页「清理悬空镜像」**与**数据卷页「清理未使用数据卷」**的 prune 结果（已删除列表 + 释放空间）格式化为 tail 文本弹窗展示，不再只弹确认框后无反馈。
- **后端**：`removeStack` 改用 `runCombined` 捕获 compose down 的 stdout + stderr 并返回；删除路由与批量路由均返回命令输出，供前端弹窗展示。
- **说明**：容器/镜像/数据卷的 start/stop/remove 走 dockerode API（无命令行输出），按「有 tail 文本才弹」的原则保持不变。

### 修复「点击一键更新后不显示下载进度，刷新页面才显示」
- **根因**：`POST /api/system/update/apply` 路由里 `await performUpdate()` 把整段更新（下载 40MB + 解压 + 替换 + 进程退出）都阻塞在该 HTTP 请求内；前端 `handleApplyUpdate` 的轮询 `startUpdatePolling()` 写在 `await applyUpdateApi()` **之后**，于是点击后请求被长时间挂起、轮询迟迟不启动，进度条为空；直到刷新页面触发挂载时的 `useEffect` 自动接管，才看得到进度。
- **修复**：
  - 后端路由改为 **fire-and-forget**：`apply` 接口立即返回 `{ message: "更新已开始" }`，更新在后台执行，状态变化由前端轮询 `/system/update/status` 获取；已知失败路径 `performUpdate` 内部已 `setState("error")`，再补 `markUpdateError` 兜底极端异常。
  - 后端 `performUpdate` 入口**同步**把 phase 置为 `downloading`（「正在准备更新...」），使状态端点在 apply 响应返回前就反映「进行中」，刷新场景下也能立即显示。
  - 前端 `handleApplyUpdate` 改为：点击即设置乐观状态并**立即启动轮询**，不再等待阻塞的 apply 响应；`apply` 仅作为「是否已成功发起」的探活，请求本身失败才弹「升级失败」。
  - **补充修复（审查后）**：`handleApplyUpdate` 原 `finally { setUpdating(false) }` 让「一键更新」按钮在 apply 立即返回后**瞬间恢复可点**，但后台仍在下载 40MB，状态不同步。改为移除瞬时 `updating`，新增基于 phase 的派生值 `updateInProgress`（`downloading/extracting/replacing` 时为真），按钮据此持续禁用并显示「升级中...」，直到轮询到 `done`/`error` 才恢复。同时 `catch` 内 `err?.message` 可能为 `undefined`，改为 `String(err?.message || err || "未知错误")` 兜底，保证失败时有可读信息。

## v1.3.0 — 2026-08-30
### 堆栈操作统一弹出命令输出弹窗（tail 文本）
- **新增**：堆栈右键菜单的**启动 / 停止 / 关闭 / 重启 / 拉取 / 构建**执行完成后，统一弹出终端样式的命令输出弹窗，展示 `docker compose` 的完整输出；此前只有「拉取」有弹窗，其余操作输出被丢弃。
- **新增**：多步组合操作（**强制更新** = pull + up、**构建并启动** = build + up、容器菜单的**更新**）各步输出按顺序汇总到同一弹窗，中途失败时展示已完成步骤的输出 + 失败详情。
- **新增**：操作**失败时同样弹出**该弹窗并标红展示失败详情（此前仅在页面顶部显示一行错误摘要，看不到 compose 的真实报错）；弹窗支持「复制输出」，内容自动滚动到底部。
- **修复（关键）**：`server/docker.ts` 的 `run()` 只返回 stdout，而 `docker compose up/down/pull/build` 的进度信息几乎全部写入 **stderr** —— 导致输出弹窗几乎空白（只剩「执行成功: ...」这句 fallback）。新增 `runCombined()` 合并 stdout + stderr 供堆栈操作使用。
- **修复**：`stackAction` 的 `restart` 分支此前丢弃 down + up 两步输出、硬返回字符串 `"restart 执行成功"`，现完整保留两段输出。
- **优化**：每步输出前加命令行标头（形如 `$ docker compose up -d`），多步操作在弹窗中可清楚区分各步；失败详情上限放宽至 8000 字符（此前 500 字符截断常丢关键报错）。

## v1.2.6 — 2026-08-30
### 修复「刷新页面后再点一键升级」误报失败且不显示进度
- **根因**：OTA 更新进度 `updateState` 仅存于后端进程内存；刷新页面后前端状态清空，但后端更新仍在后台运行（phase 非 idle）。此时再点「一键升级」，后端 `performUpdate()` 检测到「更新正在进行中」直接 `throw`，路由返回 HTTP 500，前端 catch 显示「升级失败」且未启动轮询，故看不到实时进度。
- **修复**：
  - 后端 `performUpdate()` 检测到进行中时改为**正常返回** `{ message: "更新正在进行中", inProgress: true }`（HTTP 200），不再抛错；前端据此接管轮询。
  - 前端抽出共用 `startUpdatePolling()`；`handleApplyUpdate` 成功/接管后**立即取一次状态并启动轮询**（消除 1.5s 空白）。
  - 新增**页面挂载时自动恢复**：进入设置页即查询 `/system/update/status`，若后端正处于 downloading/extracting/replacing，自动 `setUpdateState` 并接管轮询——刷新页面后无需重新点按钮即可看到实时进度。

## v1.2.5 — 2026-08-30
### 镜像加速源支持多源与拖拽排序
- 系统设置 → Docker 设置 的「镜像加速源」由单一输入框改为**可配置多个加速源**的列表，支持**拖拽调整顺序**（越靠上优先级越高）。
- 拉取逻辑改为「候选镜像名按序回退」：依次尝试每个源改写后的镜像名（`<源>/<仓库>`），全部失败才回退到原镜像名（走守护进程自身 registry-mirrors 回退链），不再对单一源做 3s 重试。
- 向后兼容：旧版单个 `registryMirror` 字符串设置自动迁移为 `registryMirrors` 数组；留空数组等价于不改写。
- 说明：fnnas 是 mirror-only（不代理 Docker Hub），勿填；Docker Hub 镜像建议填 `docker.m.daocloud.io` / `hub-mirror.c.163.com` 等真代理源。

## v1.2.4 — 2026-08-29

- **[修复] OTA 下载增加镜像回退**：GitHub 资产 CDN（`objects.githubusercontent.com`）在国内网络常被墙，直连下载报 `fetch failed`。现在直连失败会自动回退到 `gh-proxy.com` 镜像代理下载（进度条标注「直连/镜像」）。另支持服务器环境变量 `UPDATE_MIRROR` 追加自定义镜像（完整前缀，如 `https://my.proxy/`）。

## v1.2.3 — 2026-08-29

- **[优化] 升级进度条实时显示**：OTA 下载改为流式读取并按 `Content-Length` 实时上报进度（5% → 40%），解压/替换阶段推进到 50%/75%/100%，前端进度条加阶段标签（升级中/完成/失败），过程可见不再卡在 5%。
- **[优化] 更新源配置简化**：GitHub 仓库地址固定写死为 `yanziruxue/docker-manager`（已转公开），不再需要在「系统更新」卡片手动填写仓库与 Token；移除 Token 输入框与 `update.repo` / `update.token` 配置项。

## v1.2.2 — 2026-08-29

修复 SSH/TCP 远程引擎的镜像拉取在被墙网络下超时的问题（Patch）。

### Patch — 修复/优化

- **镜像拉取（远程引擎）**
  - 根因：SSH/TCP 引擎此前走 dockerode API（`/images/create`），而 Docker 28.5.2 daemon 不会给该 API 请求套用 `registry-mirrors`，导致直接回退到被墙的 `registry-1.docker.io` 超时；本地 Socket 引擎走 `docker pull` CLI 则正常。
  - `server/docker.ts`：新增 `startRemoteCliPull`，SSH/TCP 引擎的拉取改走**远程 `docker` CLI**（SSH 用 `ssh ... "docker pull"`、TCP 用 `docker -H tcp://...`），让**远程 daemon 套用其 `registry-mirrors` 加速源**。
  - SSH key 认证：临时写入私钥文件（权限 `0600`）并随进程结束清理；password 认证用 `sshpass` 包裹，缺失 `sshpass` 时优雅回退 dockerode API 并提示。
  - 应用与 Docker 同机部署时，仍建议引擎用「本地 Socket」（`/var/run/docker.sock`）以获得最稳的加速源路径。

## v1.2.0 — 2026-08-29

新增「系统更新（OTA）」功能模块（Minor），支持应用内一键检查并升级到 GitHub Releases 最新版本。

### Minor — 功能增加

- **系统更新（OTA）模块**
  - 后端 `server/updater.ts`：对接 GitHub Releases API 检查最新版本、下载交付包（linux-x64.zip）、
    解压校验后使用 `mv`（rename 语义）覆盖正在运行的二进制，再主动退出由 systemd 的 `Restart=always` 拉起新版本，
    全程无需 root 权限；升级前自动备份旧版本。
  - 新增 4 个端点：`GET /api/system/version`、`GET /api/system/update/check`、
    `POST /api/system/update/apply`、`GET /api/system/update/status`（进度轮询）。
  - 设置页新增「系统更新」分区：展示当前版本与安装目录、配置 GitHub 仓库（owner/repo）、
    自动检查开关、检查更新按钮、Release 说明展示、一键升级按钮与实时进度条。
  - `systemd` 服务 `ReadWritePaths` 增加安装目录，允许在线升级覆盖二进制。

---

## v1.2.1 — 2026-08-29

OTA 支持私有 GitHub 仓库（Patch）：新增 GitHub Token 配置，私有仓库可正常检查更新与下载交付包。

### Patch — 修复/优化/UI 改动

- **OTA 私有仓库支持**
  - `server/settings.ts`：`UpdateConfig` 新增 `token` 字段（GitHub Personal Access Token）。
  - `server/updater.ts`：`checkForUpdate()` 与 `performUpdate()` 的下载请求在读到 `token` 时统一带
    `Authorization: Bearer <token>` 头，兼容私有仓库；无 token 时行为不变（公开仓库无需改动）。
    新增 401 错误提示「Token 无效或权限不足」，404 提示补充「私有仓库请确认已填写 Token」。
  - `src/types.ts`：`UpdateConfig` 对齐新增 `token`。
  - `src/pages/Settings.tsx`：「系统更新」卡片的「更新源配置」新增 GitHub Token 输入框（password 类型）。
  - 后期切公开仓库（方案 A）时：Token 留空即可，无需再次改代码。

---

## v1.1.0 — 2026-08-29

本次含新功能模块与新配置字段（Minor），并附带多项修复与 UI 优化（Patch）。

### Minor — 功能增加

- **镜像加速源配置**（设置页 → Docker → 镜像加速源）
  新增 `registryMirror` 配置字段。填写后拉取镜像时自动改写镜像名为 `<加速源>/<仓库>:<标签>`，
  让守护进程直连加速源，绕开「mirror 逐个尝试 → 回退官方仓库」导致的超时。
  官方镜像自动补 `library/` 前缀；已自带仓库域名或 `localhost` 的镜像名不改写。
  设置页提供实时改写效果预览。

- **堆栈右键菜单新增 Pull / 拉取项**
  位于「检查更新」上方。执行 `compose pull` 后弹出终端风格窗口展示完整输出文本。

### Patch — 修复

- **镜像拉取超时（方向 C）**
  本地 socket 引擎的拉取改为 `docker pull` CLI 子进程（该环境下 CLI 实测成功而 API 超时），
  远程 SSH/TCP 引擎保留 dockerode API。CLI 输出按 `\r`/`\n` 双边界分行，
  解析层状态并把 `10.5MB/299.2MB` 还原为字节进度，前端进度条零改动。

- **镜像删除 409 冲突**
  新增 `classifyImageRemoveError()`，区分「多仓库引用（force 可解决）」与「被容器占用（force 无效）」。
  删除策略改为按 `仓库:标签` 精确删除（只解除该标签，不影响同镜像 ID 的其他引用），
  悬空镜像才按 `sha256:` 删除整个 ID。冲突时弹窗给出「强制删除」按钮并说明影响。

- **堆栈路由顺序 bug（重要）**
  `POST /api/engines/:id/stacks/:name/:action` 是通配路由，此前注册在具体路由之前，
  导致**备份、恢复、图标上传、批量操作全部被拦截**（备份报「不支持的操作: backup」）。
  已把通配路由移到所有具体路由之后，并在原位置留注释防止回退。
  注意：path-to-regexp v8 不支持 `:action(up|down|...)` 正则参数语法，只能靠调整注册顺序。

- **镜像拉取 401 回退**
  改写后的镜像在加速源返回 401/403/unauthorized 时，自动用原始镜像名重试一次，
  让守护进程走自身的 mirror 链。

- **镜像拉取超时/网络波动自动重试**
  对 timeout、canceled、context deadline、connection refused/reset、EOF、no route to host
  等瞬时错误自动重试（间隔 3s，最多 2 次，与 401 回退共享次数上限）。
  确定性错误（镜像不存在、docker 命令缺失等）不重试。
  重试期间任务保持「拉取中」，日志显示 `⚠ 拉取遇到超时/网络波动，3s 后自动重试（1/2）...`

- **getSettings 配置合并**
  旧 `settings.json` 中已存在的 `docker` 段会整体覆盖默认值，导致新增字段缺失。
  改为 docker 段二级合并，新增字段可自动继承默认值。

### Patch — UI 改动 / 优化

- 堆栈列表移除「操作」列（展开子表 `colSpan` 同步 8 → 7），所有操作统一走右键菜单
- 移除「检查全部更新」按钮，清理相关失效状态与导入
- 堆栈操作错误提示中文化：`有效操作: 启动(up)、关闭(down)、拉取(pull)、重启(restart)、构建(build)`
- 容器操作列「三个点」改为 WebUI 图标，点击跳转 `webuiUrl`（未配置时置灰并提示）
- 堆栈编辑器底部按钮 `OKAY / APPLY / CLOSE` → `确定 / 应用 / 关闭`
- 侧边栏底部「引擎名 + Docker 版本」下方显示应用版本号（如 `v1.1.0`）。
  版本号通过构建期 `define` 注入 `__APP_VERSION__`（数据源 `package.json`），
  Vite 与 esbuild 两条构建路径均已配置——SEA 二进制内没有 `package.json`，运行时读取不可靠

---

## v1.0.0 — 初始版本

11 项 UI/功能需求首次交付，详见 `docs/需求文档-2026-08-26.md`。
