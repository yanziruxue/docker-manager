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

## v1.38.2 — 2026-10-05（**已出包 · 已发布 2026-10-05**）

> **用户指令（逐字）**：「仪表盘曲线要求实时变化」＋「页面右上角铃铛的通知弹窗显示不全需要左右拖动滚动条」

**版本号判定**：两项均为 **UI / 交互小改动** ⇒ **Patch（第三位）**。（原计划的「终端按钮」属新增功能模块、本应 Minor；该需求已被用户明确放弃 ⇒ 版本号随之降为 Patch。）

### 已完成

- **① 仪表盘曲线实时化**（`src/pages/Dashboard.tsx`）：
  - **根因**：曲线点来自 **3 秒轮询**的 `history`，而「当前值」走 **1 秒 SSE** ⇒ 曲线比数字慢 3 倍（数字在跳、曲线每 3 秒才挪一下）。
  - **改法**：新增 `statsToSample(EngineResourceStats): ResourceSample` 把 SSE 样本转成曲线点（两套结构字段名不同：`memoryUsageMB`→`memDockerMB`、`netIfaces[]`→按名索引 Record、`disks[].readMBps/writeMBps/busyPct`→`read/write/busy`）；新增 `liveSamples` 状态**每秒追加一个点**（与上一点间隔 < 900ms 视为同一批推流跳过，`slice(-60)` 只留约 1 分钟）；`series` 用 `useMemo` 把「历史段（仅保留 `ts < liveSamples[0].ts` 的部分，与实时段去重）」与实时段合并。
  - **四个磁贴（Cpu / Mem / Disk / Net，共 4 处调用）改用 `series`**；3 秒轮询保留用于补齐与校正历史 ⇒ **曲线秒级前进，后端请求量零增加**（复用已有流）。
- **② 铃铛通知弹窗溢出修复**（`src/components/TopBar.tsx`，三处）：
  - 面板宽度由固定 `w-80` 改为 `w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]` ⇒ **窄窗口不再被挤出屏幕**；
  - 滚动容器加 `overflow-x-hidden` ⇒ **消除横向滚动条**；
  - 消息文本加 `break-words [overflow-wrap:anywhere]` ⇒ 长 token（镜像名 / 路径）**折行而非撑破面板**。

### 验证

- 前后端 `tsc` **双 exit 0**；`lint:hooks` PASS（45 文件）。
- 本次无新增门禁（两项均为纯前端展示层改动，无新数据通道 / 无新接口）。

### 交付包

| 项 | 值 |
|---|---|
| 交付包 | `build-upload/docker-manager-yanzi-linux-x64-v1.38.2.zip` **43,211,596 B** / SHA-256 `8a2515519178b67079940048b0b70a5964955213e4e21144aedd10e3a31145be` |
| 内置二进制 | 130,813,120 B / SHA-256 `2516e70e08e1d6abc9b61dad621cd9e8940c7e16f531b9c9dc95fc2a09c107c1`（ELF `7f454c46`、`CURRENT_VERSION = "1.38.2"`） |
| 包内成员 | 5 个（二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`） |

### 发布记录（2026-10-05）

| 项 | 值 |
|---|---|
| Tag | `v1.38.2` |
| GitHub Release | [v1.38.2](https://github.com/yanziruxue/docker-manager/releases/tag/v1.38.2) —— REST API 通道；3 资产（版本化 zip 43,211,596 B / `latest` 别名同字节 / `quick-install.sh` 12,365 B） |
| 自建 Gitea Release | [v1.38.2](https://git.ziruxue.top/yanzi/docker-manager-yanzi/releases/tag/v1.38.2) —— 同 3 资产且 **size 与 GitHub 逐字节一致**；匿名 `releases/latest` → `v1.38.2` |
| 源码 commit | GitHub `main` 见推送回执；自建 Gitea `main` `13abb226b6c022649f659136d67b0756b9429f71` |
| ★ OTA 双源核验 | **6/0** —— 两端匿名 `latest` 均 → `v1.38.2`；首个匹配资产＝版本化 zip；直链 range **206** 且前 2 字节 `504b`；两端 zip 字节数相等 |

### 已知限制

- **曲线实时段只保留约 1 分钟**（`LIVE_SAMPLE_LIMIT = 60`，1 秒 1 点）：更早的点由 3 秒轮询的历史段补齐；因此**首次进入页面时曲线仍以 3 秒粒度起步**，约 1 分钟后实时段才铺满。
- **SSE 断流时**曲线退回 3 秒轮询粒度（不影响数字与历史正确性）。
- 本次**未做**用户先前提出又放弃的「终端按钮 / SSH 宿主机终端」需求，也未做任何安全相关改动。

## v1.38.1 — 2026-10-05（**已出包 · 已发布 2026-10-05**）

> **用户指令（逐字）**：「所有日志默认保留365天 1G上限。系统设置-应用日志改为日志。系统设置-通知配置改为通知，密钥存储方式卡片移除。系统设置-列显隐默认值改为列显隐，容器子表全显示，移除容器子表默认配置」

**版本号判定**：全部为**改名 / 移除卡片 / 默认值调整 / 默认列放开** ⇒ 按「UI 与交互小改动走 Patch」归为 **Patch（第三位）**。

### 已完成

- **① 日志默认保留策略改为 365 天 / 1024 MB（1G）**：`server/settings.ts` 的 `logRetention` 顶层三项、`server/applogs.ts#getRetentionConfig` 的兜底值、`src/pages/Settings.tsx` 的默认值与四处界面兜底（`?? 365` / `?? 1024`）全部同步。`notify` / `oplog` 子段仍**默认继承顶层**（未写即跟随 365/1G）。
- **② 侧栏与页标题改名**（`src/pages/Settings.tsx`）：
  - 「应用日志」→「**日志**」
  - 「通知配置」→「**通知**」
  - 「列显隐默认值」→「**列显隐**」
  （三处的 `sections` 标签与页内 `<h2>` 一并改）
- **③ 移除「密钥存储方式」卡片**：通知页里那张说明卡（加密落盘 / 只写不读 / env 优先 / 边界说明）整块删除；`ShieldCheck` 图标随之从导入移除。**加密与脱敏行为完全不变**（仅是说明文案卡片不再展示）。
- **④ 容器子表全显示、移除其默认配置**：
  - 项目内「容器子表」指 `columnVisibility.stacks`（栈页点状态列弹出的容器列表，经 `App.tsx` 的 `defaultSubColumns` 传入 `components/StackContainersModal.tsx`；该组件在**无配置时用 `STACK_SUB_COLUMNS` 全量渲染**）。
  - 处理：从 `DEFAULT_SETTINGS.columnVisibility` 移除 `stacks` 默认值、`src/types.ts` 的 `ColumnVisibility.stacks` 改为**可选**、并加一条迁移**删除已存的 `stacks` 键** ⇒ 老配置也回落到**全部列可见**。
  - 设置页「列显隐」里的容器子表分组**保留**（仍可自定义；不配置时即全显示，7 列全部勾选）。

- **⑤ 容器子表状态列文字「竖着」修复**（用户追加指令：「容器子表页面状态列的文字是竖着的，要求横着」）：
  - **根因**：`src/components/Badge.tsx#StatusBadge` 是 `inline-flex` 徽章，**没有 `whitespace-nowrap`**；当表格把状态列挤窄时，徽章内的中文标签（如「运行中」）会**逐字换行**，视觉上就是竖着的。
  - **修复**：① 徽章本身加 `whitespace-nowrap` —— 这是根因，**全站所有用到 `StatusBadge` 的地方（容器管理页 / 容器子表 / 仪表盘）一起修好**；② `src/components/StackContainersModal.tsx` 的状态单元格加 `whitespace-nowrap`，避免该列被长列（容器名 / 镜像）挤压。列宽不足时改由外壳的 `overflow-x-auto` 横向滚动，不再把文字压弯。

- **⑥ ★ 列显隐整体改版：所有表格默认全显示，「列显隐」分区从系统设置移除**（用户追加指令：「列显隐默认全显示，不在系统设置-列显隐控制，在容器子表弹窗保留可以手动控制显隐」）：
  - **默认全显示**：`DEFAULT_SETTINGS.columnVisibility` 改为 **空对象 `{}`**（`src/pages/Settings.tsx` 的默认值同步）；`ColumnVisibility` 五个字段**全部改为可选**。各表格组件在各处配置缺失时本就回落为「全部列」，故空对象即全显示（`Containers.tsx`、`StackContainersModal.tsx`、`Stacks.tsx` 等）。
  - **移除系统设置分区**：侧栏「列显隐」项与对应的整个分区 JSX（**108 行**）一并删除；`Columns` 图标随之从导入移除。
  - **保留各页面/弹窗自带的列控件**：容器管理页的列选择器、**容器子表弹窗的列选择器**等**均保留**，用户仍可手动勾选显隐 —— 只是不再有「系统级默认值」。
  - **迁移清空已存配置**：`getSettings()` 里加 `if (Object.keys(mergedColumns).length > 0) mergedColumns = {}`。★ **必须清空而非只改默认**：分区已从界面移除，残留旧值会让用户看到被隐藏的列却**无处可改**。
  - 此条**取代**上文 ④ 的窄口径做法（原做法只处理容器子表 `stacks`，现扩展为全部表格并撤掉设置入口）。

### 验证

- 前后端 `tsc` **双 exit 0**；`lint:hooks` PASS（45 文件）。
- `npm run test:logs` **PASS=30 / FAIL=0 · exit 0** —— 其中 4 条断言原写死旧默认（500MB / 30 天），已同步为 **1024MB / 365 天**（**门禁自身抓到默认值漂移，属正常**）。

### 已知限制

- **已存的日志保留策略不会被强制改写**：本次只改**默认值**；此前保存过 `logRetention` 的实例沿用自己配置（可在「日志」页改成 365 / 1024）。
- **容器子表的删除是**无条件**的**：迁移会删掉已存的 `stacks` 键（即使用户曾自定义过容器子表列）⇒ 回落到全显示；如需保留自定义，请在「列显隐」里重新勾选。
### 交付包

| 项 | 值 |
|---|---|
| 交付包 | `build-upload/docker-manager-yanzi-linux-x64-v1.38.1.zip` **43,211,062 B** / SHA-256 `8bc7e910c6030eb44022eca0bdcfdb69c92a1984b62bfced0e83ebd45d4e57e9` |
| 内置二进制 | 130,813,120 B / SHA-256 `70e540b0032c27c75844f195f20d4a075a2293441769ac0c6850598a9f36d9a9`（ELF `7f454c46`、`CURRENT_VERSION = "1.38.1"`） |
| 包内成员 | 5 个（二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`） |

### 发布记录（2026-10-05）

| 项 | 值 |
|---|---|
| Tag | `v1.38.1` |
| GitHub Release | [v1.38.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.38.1) —— REST API 通道；3 资产（版本化 zip 43,211,062 B / `latest` 别名同字节 / `quick-install.sh` 12,365 B） |
| 自建 Gitea Release | [v1.38.1](https://git.ziruxue.top/yanzi/docker-manager-yanzi/releases/tag/v1.38.1) —— 同 3 资产且 **size 与 GitHub 逐字节一致**；匿名 `releases/latest` → `v1.38.1` |
| 源码 commit | GitHub `main` `04e7c2ff42b8877759c3e21dd8dbb8322b8434dd`（9 文件）；自建 Gitea `main` `e53d9eff753efe7fe05a14b3974ab9a4750ca502` |
| ★ OTA 双源核验 | **6/0** —— 两端匿名 `latest` 均 → `v1.38.1`；首个匹配资产＝版本化 zip；直链 range **206** 且前 2 字节 `504b`；两端 zip 字节数相等 |

**已知限制（补充）**

- **已存的列显隐配置会被清空**：本版迁移会清空 `columnVisibility`（分区已移除，残留旧值会让用户看到隐藏列却无处可改）⇒ 升级后各表格为全显示，可按需在页面/弹窗的列控件里手动调整。

## v1.38.0 — 2026-10-05（**已出包 · 已发布 2026-10-05**）

> **用户指令（逐字）**：「目录镜像放到应用详情页面里面,应用详情改成应用数据。应用日志，设置保留策略，通知和操作记录也记录到日志里，新建通知和操作记录日志文件。应用日志，设置保留策略，通知和操作记录可单独设置。」

### 已完成

- **① 日志按频道分文件**（`server/logger.ts`）：新增 `LogChannel = "app" | "notify" | "oplog"`，各自写 `<频道>-YYYY-MM-DD.log`。`createLogger(tag, channel = "app")` **默认 app ⇒ 向后兼容**（其余 7 个模块零改动）。
  - **通知日志**：`server/notify.ts` → `createLogger("Notify", "notify")`，每次推送成功 / 失败都留痕。
  - **操作记录**：`server/index.ts` 的 `apiLog` → `createLogger("API", "oplog")` —— **一处改动即把 38 处 API 操作日志**（容器启停 / 删除、镜像拉取 / 删除 / 导入导出、卷增删、Docker 服务重启…）**整体归入「操作记录」**。
  - 新增导出 `LOG_CHANNELS` / `CHANNEL_LABELS` / `logFileName()`。
- **② 保留策略按频道分别设置**（`server/applogs.ts` + `server/settings.ts`）：
  - 配置结构：`logRetention` 顶层三项（`enabled` / `maxDays` / `maxTotalMB`）**＝ 应用日志**，同时是另外两类的取值来源；`notify` / `oplog` 为**可选覆盖**子段。
  - ★ **子段刻意不给默认值**：字段缺失即**继承顶层** ⇒ 改「应用日志」时三类一起跟随，显式写过才覆盖（详见「已知限制」）。
  - `getRetentionConfig(channel)` 输出**已合并**的生效策略；`pruneLogs()` 按频道各自上限裁剪（该频道禁用即不裁），**当天文件三类一律不删**。
  - 文件名白名单扩为 `^(app|notify|oplog)-\d{4}-\d{2}-\d{2}\.log$`（仍做 `path.resolve` 双重防穿越，仍拒绝 6 类非法名）。
  - `LogFileInfo` 新增 `channel`；列表按「频道 → 日期」排序。
- **③ 接口**：`GET /api/applogs` 新增 `channels[]`（频道 / 中文名 / **已合并的生效策略** / 占用 / 文件数）；顶层 `files` / `totalBytes` / `retention` 保持原样（向后兼容）。
- **④ 设置页重组**（`src/pages/Settings.tsx`）：「**目录镜像**」不再占侧栏独立入口，**并入「应用详情」同页**；「应用详情」**改名「应用数据」**；页内说明、数据加载（`loadMirror` 随该分区加载 + 15 秒轮询）与镜像段落的分区条件一并跟随。
- **⑤ 应用日志页**：页首说明改为三类频道；保留策略面板由「一套」改为「**应用日志（顶层）+ 通知日志 + 操作记录**」三段 —— 后两者**留空即跟随**、显示当前跟随值，单独设置后出现「恢复跟随」；文件列表新增**频道**列。

### 验证（全部实测）

- 前后端 `tsc` **双 exit 0**；`lint:hooks` PASS（45 文件）。
- **新增门禁 `npm run test:logs`**（`scripts/check-log-channels.ts`，已并入 `test:gates`）：**PASS=30 / FAIL=0 · exit 0** ——
  三频道**真写文件且互不串台**；白名单接受三频道并**拒绝 6 类非法名**（含 `../../etc/passwd`、`../notify-…`、`app.log`、`other-…`）；列表每条带 `channel`；
  **分频道策略的继承与独立**（默认继承顶层；只写 `maxDays` 时 `maxTotalMB` 仍继承顶层）；**按频道各自上限裁剪 + 禁用频道不裁 + 当天文件三频道一律保留**。

### 已知限制

- **★ `notify` / `oplog` 子段刻意不给默认值**（`settings.ts` 注释已写明「切勿给子段写死默认值」）：首版在 `DEFAULT_SETTINGS` 里写了 `notify:{maxTotalMB:200}`，而二级合并**先填默认值** ⇒ 用户改顶层「应用日志」时子频道**不跟随**，与「可单独设置」的语义正相反。改成子段默认 `{}` + `getRetentionConfig()` 做 `{...顶层, ...该频道}` 合并后才正确。**这是本项目第二次栽在「二级合并的默认值顺序」上**（前一次是 `notifications` 缺子段导致整段取不到新增字段）。
- **操作记录只覆盖路由层**：`apiLog`（38 处）已归入 `oplog`；`backup.ts` / `mirror.ts` / `scheduler.ts` 的后台任务日志仍在 `app` 频道（属后台调度，非用户直接操作）。
- **频道不可自定义**：目前固定三类，未做「新增频道」能力。
### 交付包

| 项 | 值 |
|---|---|
| 交付包 | `build-upload/docker-manager-yanzi-linux-x64-v1.38.0.zip` **43,214,327 B** / SHA-256 `3a2728bc1e5bb8f74e5a08ec965f9ce0e20a6b284a8599a629d2054ed88d6e3b` |
| 内置二进制 | 130,813,120 B / SHA-256 `1122285405105167b50072cec07ffcd16e6f40959c66f53b02f3aa48ffefa973`（ELF `7f454c46` 已校验、`CURRENT_VERSION = 1.38.0`） |
| 包内成员 | 5 个（二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`） |

### 发布记录（2026-10-05）

| 项 | 值 |
|---|---|
| Tag | `v1.38.0` |
| GitHub Release | [v1.38.0](https://github.com/yanziruxue/docker-manager/releases/tag/v1.38.0) —— REST API 通道（`gh` 不可用自动回退）；3 资产（版本化 zip 43,214,327 B / `latest` 别名同字节 / `quick-install.sh` 12,365 B） |
| 自建 Gitea Release | [v1.38.0](https://git.ziruxue.top/yanzi/docker-manager-yanzi/releases/tag/v1.38.0) —— 同 3 资产且 **size 与 GitHub 逐字节一致**；匿名 `releases/latest` → `v1.38.0` |
| 源码 commit | GitHub `main` `965dd189725f4940d270cfae2f8e13db234534ba`（**10 文件，用「未跟踪 ∪ 已修改」完整清单**）；自建 Gitea `main` `79a634b57f6de45d90821728b5f040229f4bce3b` |
| notes | 329 行 / 31,278 字符（`--merge-from v1.37.0`，仅含本版） |
| ★ OTA 双源核验 | **6/0** —— 两端匿名 `releases/latest` 均 → `v1.38.0`；首个匹配 `/linux-x64.*\.zip$/i` 的资产＝版本化 zip；直链 range **206** 且前 2 字节 `504b`；两端 zip 字节数相等 |

## v1.37.0 — 2026-10-05（**已出包 · 已发布 2026-10-05** · 并入 v1.36.1）

> **版本号说明**：v1.36.1（全站曲线平滑）**从未出包、从未发布**，按约定「**同发取最高级**」并入本版 ⇒ 本版同时包含「**全部曲线平滑**」与「**系统设置三个新页面**」两组改动；v1.36.1 段落保留在下方仅供追溯。
> **版本级别**：Minor（新增功能模块 / 新页面 —— 设置页一次性新增「应用详情 / 应用日志 / 目录镜像」三个页面）。

**主题：系统设置新增三个页面 —— ①「应用详情」（应用安装位置与六个目录的真实路径 / 文件数 / 占用）；②「应用日志」（列表 · 尾部查看 · 单文件下载 · 打包 zip 导出 · 保留策略「天数 + 容量」双上限）；③「目录镜像」（备份目录与 compose 目录**实时另存**到其他路径；语义为**真镜像**，源删 ⇒ 目标同步删）。另并入 v1.36.1 的**全站曲线单调三次平滑（PCHIP，无过冲）**。**

### 已完成

#### 前言：用户原始需求（逐字）

> 「系统设置增加应用详情，应用安装位置，备份和compose目录可以在其他路径另存一份，与原始路径实时同步。可以查看应用日志列表，导出日志，设置日志保存期限时长或者日志大小。」

四项拍板（用户逐字回答）：镜像语义→「**同步删除（真镜像）**」；同步触发→「**watch 实时 + 兜底轮询**」；详情落位→「**在系统设置新增页面命名为应用详情**」；日志覆盖面→「**只做功能，不动日志内容**」。

---

#### 一、应用详情（新增 `server/appinfo.ts`，183 行 · **只读无副作用**）

- **新增接口 `GET /api/system/app-info`** → `getAppInfo()`。
- **返回运行态**：`version` / `channel`（`typeof __APP_VERSION__ !== "undefined"` ⇒ `sea-linux-x64`，否则 `dev`）/ `nodeVersion` / `platform` / `arch` / `user`（`os.userInfo().username`，容器内无 passwd 条目时降级 `"unknown"`）/ `pid` / `startedAt`（ISO，`Date.now() - process.uptime()*1000`）/ `uptimeSeconds` / `cwd`（生产下即安装目录）/ `engineName` + `engineConnection` + `engineCount`（`getAllEngines()` + `getActiveEngineId()`）。
- **六个目录**（`AppDirInfo`：`key / label / note / path / exists / files / sizeBytes / truncated`）：`install`（`getInstallDir()`，说明「二进制所在目录（OTA 替换此处文件）」）、`data`（`DATA_DIR`）、`config`（`CONFIG_DIR`，含 settings.json / 用户与凭据）、`logs`（`LOG_DIR`）、`compose`（`COMPOSE_DIR`）、`backups`（`resolveBackupDir()`）—— 每条都写明「哪个环境变量可覆盖」。
- **受限遍历（防止详情页拖垮服务）**：`MAX_ENTRIES = 200_000` 条目上限（超出置 `truncated: true`，占用值仅代表已统计部分）、`CACHE_TTL_MS = 30_000` 结果缓存（`measureCached()`）、**迭代式栈遍历**（不递归，避免深目录爆栈）、**符号链接一律跳过**（防环）。
- **前端**：`src/pages/Settings.tsx` 新增「应用详情」分区（图标 `Info`）+ 模块级 `InfoRow` / `fmtSize` / `fmtUptimeCn` 三个小组件；运行态信息表 + 目录占用表（路径一键复制 `copyDirPath`）。

#### 二、应用日志（新增 `server/applogs.ts`，360 行）

- **五条路由**：`GET /api/applogs`（列表 + 目录总占用 + 当前保留策略）、`GET /api/applogs/export`（打包 zip）、`GET /api/applogs/:name`（尾部读取）、`GET /api/applogs/:name/download`、`DELETE /api/applogs/:name`、`POST /api/applogs/prune`（立即清理）。
- **★ 路由注册顺序陷阱**：`/api/applogs/export` **必须注册在 `/api/applogs/:name` 之前** —— 否则 `"export"` 会被 Express 当成日志文件名匹配到 `:name` 分支。
- **★ 文件名白名单（路径穿越防线）**：`LOG_FILE_RE = /^app-\d{4}-\d{2}-\d{2}\.log$/`，且 `resolveLogFile()` 内用 `path.resolve` 二次校验**严格落在 `LOG_DIR` 之下**；任一不满足返回 `null` ⇒ 路由层回 400/404。**不存在任何按用户输入拼路径的分支。**
- **★ 尾部读取（内存与文件大小无关）**：只从文件**末尾**读 `TAIL_READ_BYTES = 2 MB`，再按行取后 N 行；`DEFAULT_TAIL_LINES = 500`、`MAX_TAIL_LINES = 5000`（路由层对 `req.query.tail` 做 `Number.isFinite && > 0` 兜底）。
  - `headTruncated` **同时反映两种成因**：① 只读了文件末尾一段（`readTruncated`）② 行数超过 `tail` 被截掉（`linesTruncated`）⇒ `readTruncated || linesTruncated`。**这是 harness 抓出的真实缺陷**（首版只反映① ⇒ 150 行文件读末 20 行时不标记截断）。
  - 只读末尾 ⇒ 若起点落在行中间，丢弃首行残片（`if (readTruncated) all = all.slice(1)`）。
- **保留策略（天数 + 容量双上限，先到先清）**：`maxDays`（默认 **30** 天，`0` = 不限）+ `maxTotalMB`（默认 **500 MB**，`0` = 不限）。
  - **★ 永不删除当天文件**（无论天数还是容量裁剪，最后一道保险）—— 正在写入的日志被删会丢当前会话日志。
  - `startLogRetention()`：进程启动后 **10 秒**跑一次，之后**每 30 分钟**一次；`pruneLogs()` 同时暴露给「立即清理」按钮。
- **删除保护**：`deleteLogFile()` 对**当天文件**直接拒绝（返回 `false` ⇒ 400），历史文件才允许删。
- **zip 导出**：`EXPORT_MAX_BYTES = 128 MB` 总量上限（超出置 `partial: true` 并在归档内 `export-manifest.txt` 清单中标明），归档内含清单文件；下载响应结束后 `cleanupExport()` **自动删除临时文件**（`res.download(..., () => cleanupExport(outFile))`，异常分支同样清理）。
- **★ 异步清理修复（HTTP 冒烟抓出的真实缺陷）**：`cleanupExport()` 原用 **`fs.rmSync(dir, { recursive: true })`** 递归同步删临时目录 —— 该函数挂在 `res.download` 的**完成回调**上，**同步递归删除会阻塞 Node 事件循环**。实测本机一次导出把服务**卡住 21,140 ms**（期间所有请求无响应，冒烟里 `GET /api/auth/init-status` 用了 **21,140ms**）。改为 **`fs.rm(dir, { recursive: true, force: true }, cb)`** 异步删除（清理属尽力而为，删不掉无副作用）。**探针对照证据**（同一台机器、同一目录形态）：

  | 删法 | 调用处阻塞事件循环 | 实际删除完成 |
  |---|---|---|
  | `fs.rmSync(recursive)` | **21,301 ms** | 同上（同步） |
  | `fs.rm(recursive)`（修复后） | **0 ms** | 133 ms 后回调 |

  加固后同一冒烟复跑：慢请求 **1 → 0**，四项断言仍全绿。
- **前端**：「应用日志」分区（图标 `FileText`）—— 日志列表（文件名 / 大小 / 修改时间）+ **尾部查看 Modal**（行数 500 / 1000 / 2000 / 5000 可选）+ 单文件下载 + 全量 zip 导出 + 「立即清理」+ 保留策略表单（开关 / 天数 / 容量）。

#### 三、目录镜像（新增 `server/mirror.ts`，425 行）

- **★ 语义＝真镜像（按用户拍板「同步删除（真镜像）」）**：目标**严格等于**源 —— 源里被删除的文件 / 目录**会同步从目标删除**。
- **★ 因此目标路径做了严格校验**（`validateTarget()`，`TargetValidation`）：拒绝 ① 空 / ② 相对路径 / ③ 等于源 / ④ 在源内部（无限递归）/ ⑤ **是源的上级**（源被清空时会连带删掉源 —— 最危险的一种）/ ⑥ 文件系统根 / ⑦ 不可写（**建目录 + 写探针文件 `.dms-mirror-probe`** 实测，而非只看 `access()`）。校验不通过 ⇒ 拒绝启用，并把 `invalidReason` 透出到运行态（前端直接展示原因）。
- **两个源**：`MirrorKey = "backups" | "compose"`（`LABELS` 分别给中文名），各自独立开关 + 独立目标路径。
- **★ 同步触发＝watch 实时 + 兜底轮询（按用户拍板）**：`fs.watch(source, { recursive: true })` + **1 秒防抖**（`DEBOUNCE_MS`）；另有 **60 秒全量对账**（`POLL_MS`）兜底 —— 对账**幂等**，多跑无害。
- **单次同步三步**：① **补目录**（类型冲突先删后建：源是文件而目标是目录等）② **增量复制**（复制后 `utimesSync` **回写 mtime** —— 否则下轮比对判定「变了」⇒ 每轮全量重拷）③ **真镜像删多余**（目标多出的文件/目录同步删除，目录按**深度倒序** `rmdirSync`，否则父目录非空删不掉）。
- **增量判据**：`size` 相同 **且** `|mtimeMs 差| < 1000 ms` 视为未变（跨文件系统 mtime 精度差异不致误判）。
- **并发保护**：同步进行中再次触发 ⇒ `schedule()` **排队重试**，不并发跑两轮（避免两个进程互相删对方刚复制的文件）。
- `WALK_LIMIT = 500_000` 条目上限（`walk()` 返回 `Map<相对路径(POSIX 分隔), {dir,size,mtimeMs,atimeMs}>`，**目录键以 `/` 结尾**，符号链接跳过）。
- **★ 统计口径**：`sourceFiles` / `targetFiles` **只计文件**（`!e.dir`），目录不计入 —— 首版把目录也计进去 ⇒ harness 报「源 4 / 目标 6」。
- **两条路由**：`GET /api/mirror/status`（`getMirrorStatus()`）、`POST /api/mirror/sync`（`syncMirrorNow()` 立即全量对账，不等防抖 / 轮询）。
- **运行态 `MirrorState`**：`key / label / source / enabled / target / valid / invalidReason / watcherActive（递归监听是否生效）/ syncing / lastSyncAt / lastDurationMs / lastError / copied / deleted / sourceFiles / targetFiles`。
- **前端**：「目录镜像」分区（图标 `FolderOpen`）—— 两个源各一张卡（开关 + 目标路径输入 + 校验提示 + 运行态 + 「立即同步」按钮），**15 秒轮询**刷新运行态。

#### 四、设置持久化与启动接线

- **`server/settings.ts`**：`DEFAULT_SETTINGS` 新增两段 —— `mirror: { backups: { enabled: false, target: "" }, compose: { enabled: false, target: "" } }`（**默认全关**，绝不默认接管用户目录）、`logRetention: { enabled: true, maxDays: 30, maxTotalMB: 500 }`。
- **二级合并**：`getSettings()` 对 `mirror.backups` / `mirror.compose` **各自**合并、`logRetention` 整体合并 ⇒ 旧配置文件缺这两段时**继承默认且不丢用户已有配置**。
- **`server/index.ts`**：`PUT /api/settings` 内新增 `applyMirrorSettings()`（应用新配置：开启则建 watcher、关闭则停用；**失败只 `apiLog.warn` 不阻断保存** —— 设置必须能存下去）；`app.listen` 回调内新增 `startMirror()` 与 `startLogRetention()`（各带 try/catch，**任何一侧异常都不影响服务启动**）。
- **`src/types.ts`**：新增 `MirrorTargetConfig` / `MirrorConfig` / `LogRetentionConfig` / `AppDirInfo` / `AppInfo` / `LogFileInfo` / `LogListResult` / `LogTailResult` / `LogPruneResult` / `MirrorRuntimeState` 共 10 个类型；`SystemSettings` 加 `mirror` / `logRetention`。
- **`src/api.ts`**：新增 9 个封装 —— `fetchAppInfoApi` / `fetchAppLogsApi` / `fetchAppLogTailApi(name, tail=500)` / `downloadAppLogApi` / `exportAppLogsApi` / `deleteAppLogApi` / `pruneAppLogsApi` / `fetchMirrorStatusApi` / `syncMirrorNowApi`（下载一律走既有 `downloadAsBlob()`，**不用 `<a href="/api/...">` 导航**）。

#### 五、并入 v1.36.1：全站曲线平滑（PCHIP）

- 见下方 v1.36.1 段落（`src/components/LineChart.tsx` 新增 `smoothPathD()` 与 `smooth` 默认 `true`，全站 8 处图表零改动生效，过冲实测 **0.000000 px**）。

#### 六、全站密码框「小眼睛」：显示 / 隐藏明文（9 个框 / 3 个页面）

> **追加指令（逐字）**：「登陆页面输入密码 密码框设置小眼睛可以显示密码。」

- **版本号说明**：本次是 **UI 交互小改动**（按规则本应升 Patch 到 `1.37.1`），但 **v1.37.0 从未出包** ⇒ 不存在「同版本重出包」冲突，故**并入 v1.37.0 一次性发布**，不单独占一个版本号。
- **第一步只做登录页 3 个框**（用户原始指令只点名登录页）：登录密码 + 重置密码的「新密码 / 确认新密码」（`RecoveryForm` 与登录页同一组件内切换）。
- **用户随后拍板扩到全部密码框**（两项都选：「首次设置/账号重设向导」+「设置页改密码对话框」）⇒ 最终覆盖 **9 个密码框 / 3 个文件**：

  | 页面 | 文件 | 密码框 | 锁图标 |
  |---|---|---|---|
  | 登录页 | `src/components/auth/LoginPage.tsx` | 登录密码 + 新密码 + 确认新密码 = **3** | 有（原有） |
  | 首次设置 / 账号重设向导 | `src/components/auth/SetupWizard.tsx` | 密码 + 确认密码 = **2** | 有（原有） |
  | 设置页（改密码对话框 + 找回码重设） | `src/pages/Settings.tsx` | 原密码 + 新密码 + 确认新密码 + 当前密码 = **4** | **无**（原本就没有，见下） |

- **★ 提为跨页共享组件 `src/components/PasswordInput.tsx`（新增）**：第一步它只是 `LoginPage.tsx` 内的局部函数；扩到三个页面时**必须提取**——否则第二个页面就会复制一份，第二份就没人维护（小眼睛可用性会「改一处漏两处」）。左侧锁图标 + 右侧小眼睛，`type={visible ? "text" : "password"}`，图标按状态在 `Eye` / `EyeOff` 间切换（沿用项目既有写法，见 `ActivityPanel.tsx` 的设备标识显示/隐藏）。
- **`lockIcon` 开关（默认 `true`）**：设置页那 4 个框**原本就没有锁图标**（`<Input type="password">` 裸用），若统一加上会凭空多出 `pl-9` 缩进、改变对话框观感 ⇒ 这 4 处显式传 `lockIcon={false}`，只加小眼睛、**不动既有布局**。
- **九个显示状态各自独立**：`showPassword` ×3（登录密码 / 向导密码 / 设置页当前密码）、`showNew` ×2、`showConfirm` ×3、`showOld` ×1 —— **初值一律 `false`**（默认掩码，**绝不默认亮明文**）；**同一组件内不共用状态**（否则点一个眼睛会连带影响同框的其它密码框）。
- **四个必须做对的实现细节**：
  - ★★ `type="button"` **必须显式给** —— 三个页面都嵌在原生 `<form onSubmit>` 里，按钮默认 `type` 就是 `submit`；漏写的话**点小眼睛等于立刻提交表单**（登录页会在密码还没输完时就发出去）。已列为门禁断言。
  - ★ `onMouseDown={(e) => e.preventDefault()}` —— 阻止默认行为，避免点击时焦点被按钮抢走，用户可**继续在输入框里打字**（光标位置不丢）。
  - ★ 右侧留白 `pr-9` —— **明文不会压在小眼睛图标下面**（左侧 `pl-9` 仅在 `lockIcon` 为真时才有）。
  - ★ `aria-label` / `title` 随 `visible` 在「显示密码 / 隐藏密码」间切换（无障碍 + 悬浮提示）。
- **门禁加固**（本次把该行为锁进已有门禁，不是新起脚本）：
  - `scripts/check-auth-render.mjs` 新增 **E 组 11 条**（SSR 渲**真身** `LoginPage` + `SetupWizard` 的 create / reinit 两态）：登录页 1 个 + 向导各 2 个掩码密码框、对应小眼睛按钮数、**全部 5 个按钮都是 `type="button"`**（任一不是即红）、`title` 在位、`pr-9` / `pl-9` 内边距、负向「初始渲染不含『隐藏密码』」。
  - `scripts/check-auth-wiring.mjs` 新增 **第 12 组 37 条**（AST 源码级，覆盖 SSR 渲不到的 `RecoveryForm` 与整页 `Settings`）：共享组件带 `export`、`type` 由 `visible` 驱动、内边距按 `lockIcon` 分支、**`lockIcon` 默认 `true`**、按钮 `type="button"`、`aria-label` 双态、`onClick → onToggle`、`onMouseDown` 含 `preventDefault`、`EyeOff`/`Eye` 双图标；**跨文件复用契约**（三个文件各自 `import` + 调用点数 3/2/4 = **9**、每点各传 `visible`+`onToggle`、**同一组件内 `visible` 互不相同**、各状态齐备且初值全 `false`）；**负向**「`LoginPage` / `SetupWizard` / 设置页改密码两组件内均无硬编码 `type="password"` 的 `Input`」＋「设置页 4 处显式 `lockIcon={false}`」。
- 涉及文件：**新增** `src/components/PasswordInput.tsx`；**改** `src/components/auth/LoginPage.tsx`、`src/components/auth/SetupWizard.tsx`、`src/pages/Settings.tsx`、`scripts/check-auth-render.mjs`、`scripts/check-auth-wiring.mjs`。

#### 七、通知真正落地：Webhook + 邮件（补上缺失的消费端）

> **触发提问（逐字）**：「Webhook 通知和邮件通知是真的吗」。

**查证结论：两个都是装饰。** `webhookEnabled`/`webhookUrl` 与 `emailEnabled`/`emailSmtp`/`emailPort`/`emailUser` **只存在于** `server/settings.ts` 默认值、`settings.json` 落盘、`Settings.tsx` 的输入框与保存前校验、`types.ts` —— **后端没有任何一处读取它们去发请求**；`package.json` 无任何邮件依赖；配置结构里**连 `emailPassword` 字段都没有**，UI 上那个密码框是 `value=""` + `onChange={() => {}}` 的**死输入框**。本次把消费端补齐。

- **新增 `server/notify.ts`（约 300 行）** —— 统一入口 `notify(payload)`（**永不抛错**、fire-and-forget，按 `settings.notifications.events.<key>` 过滤，按 `dedupKey` 在 10 分钟 TTL 内去重降噪）：
  - **Webhook**：`fetch` POST JSON，8 秒超时（`AbortSignal.timeout`）；配了密钥则带 **`x-docker-manager-signature: sha256=…`**（`node:crypto` 内置 HMAC，**零额外依赖**），接收方可验签防伪造。
  - **邮件**：**nodemailer 10.0.14**（新增依赖）。465 走隐式 TLS，其余端口由 nodemailer 按服务端能力协商 STARTTLS；15 秒连接/问候/套接字超时。
  - **★ 选型依据**：先验证 **esbuild 能否把它打进 SEA bundle**（`build-binary.mjs` 走 `platform=node` + `format=cjs`）—— 实测 **exit 0、无告警、+约 400 KB**，故选成熟库而非自研 SMTP 客户端（协议边界情况多，且自研无法在本机离线验证）。
  - **★ 循环依赖的坑**：`docker.ts` 要发「更新完成」通知，而容器巡检又需要 `docker.ts` 的 `getContainers()` ⇒ 直接互相 import 成环。**断开办法**：把取数函数**注入**（`startContainerWatch(fetchTargets)`），由 `index.ts` 组装并传入。
- **四个事件的触发源**：

  | 事件 | 触发点 | 说明 |
  |---|---|---|
  | `containerDown` | **新增** `startContainerWatch()`：启动后 30 秒跑首轮、之后每 60 秒 | ★ **后端原本没有任何容器状态变化检测**，本次新增「快照 diff」：只在「运行中 → 非运行中」转变时通知，首轮只建基线不发；引擎取数失败时**不更新基线**，下轮继续比对；优先巡检活跃引擎、最多 3 个 |
  | `updateAvailable` | `scheduler.checkEngineImages()` | **只对本次新出现的更新发**（对比上次缓存），否则每天/每小时的重复检查会把同一条更新反复推成骚扰 |
  | `updateComplete` | `docker.ts` 新增 `finishPullSuccess()` | ★ 本地 CLI / 远程 CLI / dockerode API **三条拉取路径原本各自内联同样的三行**，任何新增路径都可能漏发或重复发 ⇒ **统一收口**到 helper，门禁断言裸写只剩 1 处 |
  | `buildFailed` | **无触发源** | ★ 本项目**没有镜像构建功能**（`buildImageRef` 只是拼镜像名），开关保留但**显式标注「暂无触发源」**（后端 `EVENTS_WITHOUT_SOURCE` + 前端 UI 说明），不假装可用 |

- **配置字段补齐**（`server/settings.ts`）：新增 `webhookSecret` / `emailPassword` / `emailFrom` / `emailTo`；★ 并给 `notifications` 段**补上二级合并** —— 此前 `getSettings()` 里 `...parsed` 会让旧 `settings.json` **整段取不到新增字段**（前端拿到 `undefined`、输入框失控、通知模块读不到）。
- **前端修掉历史死输入框**（`src/pages/Settings.tsx`）：SMTP 密码改绑真实 `emailPassword` + 复用 `PasswordInput`（带小眼睛、显式 `type="button"` 不会误提交）；补「发件人 / 收件人 / Webhook 签名密钥」；保存前校验补「密码必填 / 收件人必填」；新增「**发送测试通知**」按钮（★ **先保存再发**，且 `handleSave()` 改为返回 `boolean`，校验没过就中止 —— 否则会拿旧配置去发，表现为「测试失败」但配置其实是对的）；`buildFailed` 行内标注无触发源。
- **两个新接口**：`POST /api/notify/test`（force，忽略开关与去重）、`GET /api/notify/status`（两通道是否配齐 + 无源事件列表）。
- **安全取舍（诚实记录）**：SMTP 密码与 Webhook 密钥**明文存于本机 `settings.json`**（本项目不提供密钥加密存储），UI 上已就此给出提示；**密钥绝不进日志**；通知失败只写日志，**绝不影响容器启停 / 镜像拉取等主流程**。
- 涉及文件：**新增** `server/notify.ts`、`scripts/check-notify-wiring.mjs`；**改** `server/settings.ts`、`server/index.ts`、`server/docker.ts`、`server/scheduler.ts`、`src/types.ts`、`src/api.ts`、`src/pages/Settings.tsx`、`package.json`（新增 `nodemailer` 依赖 + `lint:notify` 门禁并入 `test:gates`）。

#### 八、镜像拉取进度弹窗：完成后自动关闭

> **追加指令（逐字）**：「拉取进度弹窗没有自动关闭，加入自动关闭」。

- **改动**：`src/pages/Images.tsx`。拉取任务进入终态后**倒计时 5 秒自动关闭弹窗**，并刷新镜像列表（此前无论成功失败都必须手点「关闭」）。
- **★ 失败态刻意不自动关**：`error` 时弹窗里有**失败原因**和**「重试」按钮**，自动关掉等于把用户刚要看的错误收走、还得重新拉一次。规则抽成纯函数 `shouldAutoClosePullModal(status)` 便于断言：

  | 任务状态 | 是否自动关闭 | 理由 |
  |---|---|---|
  | `success` 拉取成功 | ✅ 关（5 秒） | 结果不会丢：左侧任务列表仍显示该任务状态，关闭时还会 `onRefresh()` 刷新镜像列表 |
  | `canceled` 已取消 | ✅ 关（5 秒） | 用户主动取消，没有需要阅读的信息 |
  | `error` 拉取失败 | ❌ **不关** | 保留失败原因与「重试」入口 |
  | `pulling` / 空 / 未知 | ❌ 不关 | — |

- **不搞「突然消失」**：关闭前在按钮左侧显示「N 秒后自动关闭」（`tabular-nums` 不抖动），并提供「**立即关闭**」。
- **手动与自动关闭走同一个 `closePullModal()`**（`useCallback`）——原先关闭逻辑是内联在 `onClick` 里的，现在自动关闭复用同一条路径，避免两处漂移。
- **★ 用「关闭时刻戳」而非「递减计数器」驱动**：`setAutoCloseLeft((n) => … closePullModal())` 这类写法把副作用放在 `setState` 更新函数里，**React 严格模式下更新函数可能被调用两次** ⇒ 关闭与 `onRefresh` 会重复执行。改为「effect ① 设定 `autoCloseAt` 时间戳 + effect ② 每 500ms 算剩余秒数、归零后关闭」。
- **★ effect 依赖刻意不含 `autoCloseLeft`**：否则倒计时每跳一次就重建定时器，**永远走不到 0**（这类 bug 表现为「就是不自动关」，很难查）。两个 effect 分别只依赖「是否进入终态」与「关闭时刻」。
- 涉及文件：`src/pages/Images.tsx`。

#### 九、通知密钥安全加固：加密落盘 + 不回传前端 + env 覆盖

> **触发提问（逐字）**：「SMTP 密码与 Webhook 密钥明文存于本机 settings.json，能加密吗？」

**先说清楚「加密」的能力边界**（已同步写入设置页界面与 `server/secret-store.ts` 文件头）：加密防的是**文件被误传**（误提交 git、被备份/打包带走、被贴进日志或工单），**防不住已经能读本机 `CONFIG_DIR` 的人** —— 主密钥必然与密文在同一台机器上。所以本版按性价比做了四件事，**加密排在最后**。

- **① 堵住 git 泄漏（本次最急的真实风险）**：查证发现 `server/settings.json` 与 `server/config/settings.json` **被 git 跟踪且未被忽略**（来自初始提交，权限 644），而 `.gitignore` 虽已忽略 `.env` / `.env.*` / `_*.json`，**偏偏漏了 `settings.json`** ⇒ 只要在开发机填入真实 SMTP 密码，`git add` 就会提交、并由推送脚本推到 GitHub + Gitea（当前值为空，尚未泄漏）。处理：`git rm --cached` 移除跟踪（**磁盘文件保留**）+ `.gitignore` 增加裸名 `settings.json`（`APP_DIR = process.cwd()`，从仓库根或 `server/` 启动会写不同路径，裸名一次覆盖）+ `saveSettings` 落盘时用 `mode: 0o600` 收紧权限（Windows/NTFS 无 POSIX 权限位，Linux 才真正生效）。
- **② 密钥不回传前端**：`GET /api/settings` 与 `PUT` 的**响应**统一走新增的 `redactSettings()` —— 两个密钥字段回空串，另给 `emailPasswordSet` / `webhookSecretSet` 布尔标志。前端据此显示「已设置（加密存储）· 留空 = 保持不变」。**密钥从此只写不读**。
- **③ 密钥三态语义**（新增 `SECRET_CLEAR = "__CLEAR__"` 哨兵，前后端各一份、门禁断言两边一致）：提交时该字段 `""` ⇒ **保持原值**、`__CLEAR__` ⇒ 清除、其它 ⇒ 新明文。界面在「已设置」时多一个「清除」按钮（否则留空无法区分「不改」与「清空」）。
- **④ AES-256-GCM 加密落盘**（新增 `server/secret-store.ts`）：主密钥 32 字节随机存 `config/secret.key`（`mode: 0o600`），密文格式 `enc:v1:<iv b64>:<tag b64>:<密文 b64>`。
  - **GCM auth tag 随密文存储** ⇒ 任何篡改都会解密失败（不会被静默接受），实测把密文首字节翻转后 `decryptSecret` 返回空串。
  - **历史明文向后兼容**：无 `enc:v1:` 前缀的值原样返回 ⇒ 老配置无需迁移，首次保存时自动转为密文。
  - **幂等**：已加密值不再二次加密（「留空保持」语义依赖这一点）。
  - **失败降级不崩**：主密钥不可写 ⇒ 加密失败只告警并按明文保存；解密失败（密钥丢失/换机/密文被改）⇒ 返回空串并告警，**保证设置页仍能打开、用户能重新填写**（否则连补救入口都没了）。
- **⑤ 环境变量覆盖**：`DMS_SMTP_PASSWORD` / `DMS_WEBHOOK_SECRET` **优先于** `settings.json`（沿用项目 `UPDATE_GITEA_BASE` 等 env 覆盖先例）。systemd 可放 `EnvironmentFile=/etc/docker-manager-yanzi/secrets.env`（0600 仅 root 可读）⇒ **密钥根本不落 app 配置目录、也不进备份包**。`/api/notify/status` 新增 `secretSource`（`env`/`file`/`none`）与 `secretsEncrypted`，界面显示「已由环境变量 X 覆盖 —— 这里的设置会被忽略」（只读提示）。
- **界面**：新增「密钥存储方式」卡片，把上述能力**与边界**如实写进 UI（含「主密钥丢失/换机后密文无法解密，需重填」的提醒）。
- 涉及文件：**新增** `server/secret-store.ts`、`scripts/check-secrets.ts`；**改** `server/settings.ts`、`server/index.ts`、`server/notify.ts`、`src/types.ts`、`src/pages/Settings.tsx`、`.gitignore`、`package.json`（新增 `test:secrets` 并入 `test:gates`）；**`git rm --cached`** `server/settings.json`、`server/config/settings.json`。

### 验证（全部实测）

- **类型检查**：`npx tsc -p server/tsconfig.json --noEmit` **exit 0**、`npx tsc --noEmit`（前端）**exit 0**。
- **门禁 `npm run test:gates`**：**exit 0** —— `lint:hooks` + `test:auth`（24/0 & 29/0）+ `test:restart`（18/0）+ `test:thermal`（15/0）+ `test:install`（34/0），合计 **120 项 PASS / FAIL 0**（v1.37.0 未触碰门禁覆盖面，属**无回归**确认）。
- **★ 真实文件系统 harness（`.tmp-harness.ts`，14 段 / PASS=70 FAIL=0 / exit 0）**：先 `process.env.DATA_DIR / LOG_DIR / CONFIG_DIR` 指向**唯一沙箱目录**再**动态 import** 业务模块（保证模块读到沙箱路径），跑真实 `fs` 而非桩：
  - §② 镜像目标路径校验：**5 类非法目标**（空 / 相对 / 等于源 / 在源内部 / 是源上级）全部被拒。
  - §③ 默认状态：两个源 `enabled` 均为 `false`。
  - §④~⑦ 镜像核心：首次全量同步（`首次复制 4 个文件（实得 4）`）、**幂等**（无变更不重拷）、**增量**（新增 / 修改）、**★ 真镜像删除**（源删 ⇒ 目标同步删，`源删除的文件在目标已删除`）。
  - §⑧ **真实 `fs.watch` 事件触发**（`await sleep(2500)` 等真实内核事件，非合成调用）。
  - §⑩~⑭ 日志：**文件名白名单穿越防线**（非法名称一律 `null` / 拒绝）、列表与尾部读取（`tail=20` 恰好 20 行、末行是最新行、`tail` 超总行数返回全部、不存在文件返回 `null`、**短文件整读不标记截断**、150 行文件读末 20 行**正确标记 `headTruncated`**）、**当天文件禁止删除**（历史文件允许、非法名称拒绝）、保留策略**天数裁剪**（删 2 个超期、当天文件未被删、未超期保留）与**容量裁剪**（删 4 个、文件数 5→1、**当天文件在容量裁剪下依然保留**、策略关闭 ⇒ `skipped=true` 且不删任何文件）、**zip 导出**（含 1 个文件、`partial=false`、**PK 魔数 `504b`**、含 `export-manifest.txt` 清单、**导出临时目录已清理**）。
  - 日志实证（harness 真实输出）：`[Logs] 已删除日志文件：app-2026-09-01.log`、`[Logs] 日志保留策略已清理 2 个文件，释放 2002 字节（保留 30 天 / 0 MB）`、`[Logs] 日志保留策略已清理 4 个文件，释放 15032 字节（保留 0 天 / 0.0001 MB）`。
- **★ HTTP 层端到端冒烟（`.tmp-route-smoke.mjs`，真实 Express + 真实 HTTP + 唯一沙箱）**：**PASS=60 FAIL=0 · exit 0**（32 个请求，慢请求 0）。这是 harness（模块层）**覆盖不到的路由接线**验证：
  - §① 服务就绪 + `POST /api/auth/init` 建首个账号并拿到会话 Cookie。
  - §② 应用详情：`version=0.0.0-dev` / `channel=dev`（开发态未注入 `__APP_VERSION__`）/ `pid` 为正整数 / **六个目录 key 齐全** / `data`·`logs`·`compose`·`backups` 四条路径**逐一比对等于沙箱** / `uptimeSeconds` 为正。
  - §③④⑤ 日志：列表（1 个文件、`totalBytes=195`、`retention={enabled:true,maxDays:30,maxTotalMB:500}`）。
  - **§④ ★ 路由注册顺序的区分性断言**：`GET /api/applogs/export` 返回 **zip（PK 魔数 `504b`）** + `Content-Disposition: attachment; filename="docker-manager-logs-2026-10-05-03-15-39.zip"` —— 若被 `/:name` 吞掉会返回 JSON「日志文件不存在或名称非法」，**两者不可能混淆**；同时 `GET /api/applogs/app-1999-01-01.log` 仍是 404「不存在或名称非法」⇒ `:name` 分支未被破坏。
  - §⑤ 尾部读取与白名单：默认读取成功、`tail=3` ≤3 行、`tail=999999` 不报错（夹到 5000）、`tail=abc` 回退默认；`settings.json` / `app-2026-1-1.log` / `app-2026-01-01.log.bak` / `%2e%2e%2fsettings.json` **四种非法名全部 404**。
  - §⑥⑦ 删除保护与清理：当天文件 `DELETE` → 400 且磁盘文件仍在；`POST /api/applogs/prune` → `{removed:[],freedBytes:0,skipped:false}` 且当天文件幸存。
  - §⑧⑨ 镜像：默认 `enabled` 全 false、`key` 顺序 `backups,compose`、源路径等于沙箱；`PUT /api/settings`（**原样落盘**，故回传完整设置对象）后 `enabled=true` / `valid=true` / `watcherActive=true`（`fs.watch` 递归真挂上）/ 文件真被复制；**★ 源删 ⇒ 目标同步删**（走 watch 实时路径）；**★ 把目标设成「源的上级」⇒ `valid=false`** 且原因文案「目标路径不能是源的上级（真镜像会连带删除源）」、源目录安然无恙；关闭后 `watcher=false`；`logRetention` 新值（7 天）持久化并回读一致。
  - §⑩ 鉴权守卫覆盖 5 条新路由（无会话一律 401）。
  - 坑：① **tsx 会再 fork 子进程** ⇒ `child.pid` 不是服务进程 pid（首轮据此误报 FAIL，已改为断言「正整数且 ≠ 脚本自身 pid」）；② **`res.download` 会关闭连接** ⇒ 客户端必须 `Connection: close` + 失败重试，否则下一请求 `fetch failed`（首轮即因此中断，`cause` 才暴露真相）。
- **静态接线审计（防「元素有 UI 但没接事件」）**：10 个处理器（`loadAppInfo` / `copyDirPath` / `loadLogs` / `openTail` / `handleExportLogs` / `handleDownloadLog` / `handleDeleteLog` / `handlePruneLogs` / `loadMirror` / `handleMirrorSyncNow`）**全部既定义又被引用**；9 个 API 封装在 `Settings.tsx` **全部被真实调用**（非仅 import）；定位到 **11 处 JSX 事件挂载点**（含 Modal 内的「重新拉取 / 下载」）。
- **★ 密码框小眼睛专项**：`npm run test:auth` **exit 0** —— 渲染门禁 **35/0**（原 24/0，**+11**）、接线门禁 **66/0**（原 29/0，**+37**）；`lint:hooks` **45 文件** PASS（新增了 `PasswordInput.tsx`）；前端 `tsc --noEmit` **exit 0**；`dist/` 删掉重建 **VITE_EXIT=0**（当前资产 `assets/index-B99UcHQ-.js` **1,104,010 B** / `index-B87aS4CO.css` 47,666 B；CSS 哈希与上轮**完全一致** ⇒ 样式零变化，符合「只加开关不动观感」的预期；js 内 `"1.37.0"`×1、`显示密码`×2 / `隐藏密码`×2 ⇒ **确证已进包**）。
  - **★ 负向自检（两道门禁各自独立抓红）**：把共享组件的 `type="button"` 注入回归为 `type="submit"` ⇒ 渲染门禁 **PASS 34 / FAIL 1 · `exit 1`**（回显 `共 5 个，异常 5 个：<button type="submit" aria-label="显示密码" …>`）；单独跑接线门禁 **PASS 65 / FAIL 1 · `exit 1`**（`<<< submit`）—— 证明这两条断言**不是摆设**。`cp` 还原后 `cmp` **逐字节一致**，两门禁回到 **35/0 + 66/0 · `exit 0`**。
  - **★ 交付物**：`renderToStaticMarkup` 渲**真身组件** + 内联**本次真实构建 CSS** 产出静态快照 `.workbuddy/artifacts/v1.37.0-登录页小眼睛.html`（登录页 + 首次设置向导两屏，8 项自检全过）—— 不是手绘示意图。
- **★ 通知双通道（Webhook + 邮件）**：
  - **真实发送 e2e（`.tmp-notify-test.ts`，9 节 / **PASS=43 FAIL=0 · exit 0**）** —— **桩 SMTP 服务器 + 桩 Webhook 接收端，真发真收**：
    - SMTP 走完 `EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT` 真实对话；**用户名 / 密码都真的送到了桩端**；两个收件人都在；发件人用配置的 `emailFrom`。
    - 邮件主题解码后为 `[更新完成] 镜像已更新：nginx:latest — yanzi14s`（nodemailer 用 **Q 编码 + 折行**，断言前须展开折行并按 RFC 2047 解码）；正文含镜像名；**★ 密码未出现在邮件内容里**（只用于认证）。
    - Webhook 桩收到 JSON，`event`/`eventLabel`/`title`/`summary` 逐项核对；**★ 签名头用同一密钥重算 HMAC 比对一致**（不是只看有没有这个头）。
    - 事件开关关闭 ⇒ **两通道都跳过且确实没发出去**；同 `dedupKey` 第二次被去重、不同 key 正常发；缺收件人 / 缺 URL ⇒ 跳过而非报错；Webhook 指向不可达地址 ⇒ **记 failed 但不抛错**。
    - 容器状态 diff：**首轮只建基线不发**、`running→exited` 触发 1 条、标题含容器名（去掉前导 `/`）、明细含容器 ID 与状态、**状态无变化不再发**。
  - **新增门禁 `scripts/check-notify-wiring.mjs`（`lint:notify`，已并入 `test:gates`）：34/0** —— 覆盖消费端存在、四个事件各有触发源（`buildFailed` 必须显式标注无源）、三条拉取路径收口（裸写只剩 1 处）、事件开关真被读、**负向「死输入框」**、敏感字段绑真实 state、`notifications` 段二级合并、密钥不进日志、`notify()` 不抛错、测试端点与「先保存再发」。
  - **★ 负向自检**：把 SMTP 密码框改回历史形态 `<Input value="" onChange={() => {}} …/>` ⇒ 门禁 **31/3 · exit 1**，并回显命中代码。**这次自检还当场暴露了我自己断言的 bug**：负向正则写的是匹配 `value={""}`，而 JSX 实际是 `value=""`（字符串字面量）⇒ **门禁当时漏检**，修正为两种写法都匹配后才真正抓红。还原后 `cmp` 逐字节一致 ⇒ 回到 **34/0**。
  - **★ 小眼睛门禁反向生效**：全量门禁时它抓到「设置页 4 个密码框」的**硬编码计数漂移**（接入 SMTP 密码后变 5 个）⇒ 说明这类「写死个数」的断言确实在起作用，已更新为 5 并复跑通过（35/0 + 66/0）。
  - **选型验证**：nodemailer 能否被 SEA 打包**先验证再写码** —— esbuild（`platform=node` + `format=cjs`）**exit 0、无告警、+约 400 KB**，`createTransport` 可用。
- **★ 密钥存储链路（新增门禁 `npm run test:secrets`，已并入 `test:gates`）：PASS=40 / FAIL=0 · exit 0**（零网络；固定沙箱 `.tmp-secrets-check/`，起步清理避免常驻门禁堆积目录）：
  - 加解密往返、密文不含明文片段、两次加密结果不同（IV 随机）、**幂等**（已加密不再二次加密）、**历史明文原样返回**（老配置无需迁移）。
  - **★ GCM 篡改检测**：把密文首字节翻转后 ⇒ `decryptSecret` **不抛错且返回空串**（auth tag 校验失败），格式非法的密文同样返回空串。
  - **三态语义（走真实 `saveSettings` 落盘）**：落盘文件**不含明文**且含 `enc:v1:`；留空提交 ⇒ **密码/密钥保持原值**；传新值 ⇒ 覆盖且落盘仍无明文；传 `__CLEAR__` ⇒ 清空。
  - **响应脱敏**：`redactSettings()` 后两个字段为空串、**脱敏对象里不含任何明文密钥**、以 `emailPasswordSet` / `webhookSecretSet` 替代；`saveSettings` 的返回值同样脱敏（PUT 响应不漏）。
  - 主密钥 32 字节、内容非明文、平台为 Linux 时校验 0600（Windows 跳过并打印原因）。
  - env 覆盖优先级（设了 env ⇒ 来源 `env`；未设 ⇒ 回落 `file`；都无 ⇒ `none`）。
  - **跨文件契约**：前端 `SECRET_CLEAR` 与后端 `SECRET_CLEAR` **逐字一致**；`.gitignore` 已忽略 `settings.json`。
- **★ 密钥链路负向自检（两次注入，各自还原）**：
  1. **关掉加密**（`saveSettings` 跳过 `encodeSettings`）⇒ 门禁 **36/4 · exit 1**（「落盘无明文」×2、「落盘是密文」、「覆盖后仍无明文」全红）。
  2. **关掉脱敏**（删掉 `redactSettings` 里把密钥置空的那行）⇒ 门禁 **36/4 · exit 1**（四条 ★★ 关键断言全红）。
  - ★ **第一次注入脱敏时曾得到「假通过」**：我只改了 `return` 语句、没删「置空」那行 ⇒ 实际并未泄漏明文，门禁不报是**正确行为**。教训：**注入要注入到行为真正退化的那一行**，否则会拿到误导性的「门禁有效」结论。
- **★ 两处门禁模型漂移（由实现演进而非缺陷引发，均当场抓红）**：① `lint:notify` 里「SMTP 密码直接用 `<PasswordInput … emailPassword>`」的断言在改用 `SecretField` 包装后失效；② `test:auth` 的密码框统计把 `SecretField` 内那个**透传**（`visible`/`onToggle` 来自 props）也算成了「绑定具体状态」。两处都按新结构精确化：**排除 wrapper 透传**（合计 9 个具体状态调用点）+ 新增 3 条专测 `SecretField` 与其 2 个调用点的断言。
  - **覆盖边界（诚实说明）**：`renderToStaticMarkup` 只渲初始态（永远掩码），**「点一下变明文」这一步无 DOM 环境无法端到端验证**（本机无 jsdom / react-test-renderer / happy-dom，且官方 npm 源不稳）。该链路改由源码级断言覆盖：`visible` → `type` → `onClick → onToggle` → `setShowX(v => !v)` 四环全部被 AST 断言锁住；React 自身的事件派发不属于本仓代码。
- 涉及文件：**新增** `server/appinfo.ts`、`server/applogs.ts`、`server/mirror.ts`；**改** `server/index.ts`、`server/settings.ts`、`src/types.ts`、`src/api.ts`、`src/pages/Settings.tsx`（3496 → **4116** 行）、`src/components/LineChart.tsx`（并入 v1.36.1）、`package.json`（version → `1.37.0`）、`docs/CHANGELOG.md`。

### 交付包

| 项 | 值 |
|---|---|
| 交付包 | `build-upload/docker-manager-yanzi-linux-x64-v1.37.0.zip` **43,211,848 B** / SHA-256 `d2409d1753410f8664901eaeca8a859910cb8e48a808a7c7b8ad218e2558c932` |
| latest 别名 | `build-upload/docker-manager-yanzi-linux-x64.zip`（同字节） |
| 内置二进制 | 130,813,120 B / SHA-256 `52b64363e66b28ac7ee95bfdc1f560ec9fcc173c4556be1cfa86e8cfe3fe7982`（ELF `7f454c46` 已校验、`CURRENT_VERSION = true ? "1.37.0" : "0.0.0-dev"`） |
| 前端资产 | `dist/assets/index-DDCM49KO.js`（1,112,657 B）、`index-40zctq-V.css`（47,718 B） |
| 包内成员 | 5 个（二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`），权限位已校验（二进制与脚本 755） |
| `bundle.js` | 5,620,565 B（含 `nodemailer` 打包，较上版约 +400 KB） |

**★ 真包冒烟 24/0（跑 `deploy/linux/bundle.js`，不是源码）** —— 本版最大运行时风险是 **nodemailer 经 esbuild 打包后能否正常工作**，故在真包上逐项验过：

- 真包启动成功（日志含 `🚀 Backend running`）；`GET /` 返回的 asset 名 = `dist/assets/index-DDCM49KO.js`，且**逐字节大小一致（1,112,657）** ⇒ 证明内嵌的是本次构建；asset 内含 `秒后自动关闭` / `密钥存储方式` 等新文案。
- 登录后 `GET /api/system/version` → **`1.37.0`**。
- **加密链路在真二进制内生效**：`PUT /api/settings` 后磁盘 `settings.json` 含 `enc:v1:` 且**不含明文**、`config/secret.key` 已生成。
- **脱敏链路在真二进制内生效**：`GET /api/settings` 密钥字段回空串 + `emailPasswordSet/webhookSecretSet=true`，响应体内**无任何明文密钥**。
- **Webhook 真发生效**：桩接收端收到推送（`event=containerDown`），且 `x-docker-manager-signature` 与**用真实密钥重算的 HMAC 逐字一致**。
- **无未处理错误、无 `Dynamic require` 失败** ⇒ nodemailer 打包安全。

### 未完成 / 已知限制

- **日志内容一字未动**（按用户拍板「只做功能，不动日志内容」）：本次**只提供「看 / 导出 / 清理」的能力**，不新增、不修改任何日志点。因此——`server/docker.ts`（引擎层，4234 行）**一处日志都没有**；路由层 `server/index.ts` 已有 **38 处** API 日志（容器启停 / 删除、镜像删除 / 拉取 / 导入导出 / 锁定、数据卷创建 / 删除 / 清理、Docker 服务重启、日志级别），**未覆盖的写操作仍有：堆栈、网络、容器文件管理、镜像构建、登录**。
- **镜像不做冲突合并**：真镜像语义下，目标侧独立新增的内容会被删除（这是「真镜像」的定义，非缺陷）；若想要「双向合并 / 只增不删」，属于另一套语义，需另行确认。
- **镜像首轮为全量**：目标为空时首次全量复制；备份目录很大时首轮耗时较长（运行态已显示文件数与字节数，但**没有进度条**）。
- **`fs.watch` 递归在 Linux 依赖 inotify 上限**：超大目录树 + 偏低的 `fs.inotify.max_user_watches` 时，递归监听可能失效 ⇒ **退化为只靠 60 秒轮询兜底**（功能不丢，实时性下降）。运行态 `watcherActive` 已把「递归监听是否生效」透出到界面。
- **目录占用为抽样值**：`MAX_ENTRIES = 200_000` 上限内统计，超出时 `truncated: true`（界面据此提示「仅统计部分」）；30 秒缓存 ⇒ 刚写入的文件可能未立刻反映。
- **`mirror.ts` 的类型冲突删除仍是同步的（已知，未改）**：`syncKey()` 在「目标同名项是目录、而源是文件」时用 `fs.rmSync(absTarget, { recursive: true, force: true })` 整棵删。它在 `fs.watch` / 60 秒轮询的后台路径上执行，**不影响用户请求**；触发条件苛刻（同一相对路径上源是文件、目标是目录），且该目录本就不该存在（体积通常极小）。做成异步需把整条已验证的同步流水线改为 async，风险大于收益 ⇒ **本次不动，仅记录**。日志侧同类的 `rmSync` 已改异步（见上文）。
- ~~设置页「通知 → SMTP 密码」框未加小眼睛~~ **已在本次一并修掉**：该框本就是 `value=""` + 空 `onChange` 的**死字段**（密码从未被保存过），本次接入真实字段并复用共享组件 `PasswordInput`（经 `SecretField` 包装，带小眼睛 + 可清除 + env 只读提示），同时新增门禁**负向断言**「设置页不得再有死输入框」。
- **通知密钥的防护边界（不是「全好了」）**：SMTP 密码与 Webhook 签名密钥现在**加密落盘**（AES-256-GCM）且**不回传前端**，但这**不等于「密钥安全了」**——加密只防「文件被误传」（误提交 git / 被备份带走 / 被贴进工单），**防不住已经能读本机 `CONFIG_DIR` 的人**：主密钥 `secret.key` 就在同目录。真正的防线是文件权限（已收到 0600，**Linux 生效、Windows/NTFS 无 POSIX 权限位故不生效**）与最小账号权限。
- **主密钥丢失或换机 ⇒ 密文无法解密**：`config/secret.key` 不在备份包内（也不该进），把 `settings.json` 恢复到另一台机器后这两个密钥会解不开 ⇒ `decryptSecret` 返回空串并告警，需**重新填写**。这是加密的固有代价。
- **env 覆盖的副作用**：设了 `DMS_SMTP_PASSWORD` / `DMS_WEBHOOK_SECRET` 后，界面上的输入框会被忽略（已显示「已由环境变量 X 覆盖」只读提示），但**不会**阻止用户继续输入 —— 属于提示而非硬约束。
- **★ `buildFailed` 开关无触发源**：本项目**没有镜像构建功能**，该事件不会触发（后端 `EVENTS_WITHOUT_SOURCE` + 界面行内标注）。保留开关仅为将来兼容，**不假装可用**。
- **通知去重窗口 10 分钟**：同一 `dedupKey`（如同一容器停止）在 10 分钟内只推一次，避免容器反复重启时把通知刷爆；代价是 10 分钟内的重复事件第二次不推。
- **容器状态巡检的边界**：每 60 秒拉一次容器列表（最多 3 个引擎，优先活跃引擎），**最短检测延迟约 60 秒**；运行时间极短的容器（< 60 秒）可能完全错过。引擎取数失败时不更新基线，等下轮继续比对（不会误报）。
- ~~未出 SEA 包、未发布~~ **已出包并发布 2026-10-05**（详见上文「交付包」与「发布记录」；nodemailer 的 SEA 打包与真包运行时均已实测通过，冒烟 24/0）。

### 发布记录（2026-10-05）

| 项 | 值 |
|---|---|
| Tag | `v1.37.0` |
| GitHub Release | [v1.37.0](https://github.com/yanziruxue/docker-manager/releases/tag/v1.37.0) —— `draft=false`、`prerelease=false`（`releases/latest` 已指向本版）；3 资产（版本化 zip 43,211,848 B / `latest` 别名同字节 / `quick-install.sh` 12,365 B）；三条直链 **200**；`/linux-x64.*\.zip$/i` 首个匹配＝版本化 zip |
| 自建 Gitea Release | [v1.37.0](https://git.ziruxue.top/yanzi/docker-manager-yanzi/releases/tag/v1.37.0) —— **id=13**、`draft=false`、`prerelease=false`；同 3 资产且 **size 与 GitHub 逐字节一致**；**匿名** `releases/latest` → `v1.37.0`；直链 range **206**（zip 前 2 字节 `504b`、`quick-install.sh` 前 2 字节 `2321`） |
| 源码 commit | GitHub `main` `5c31a92e279ef35e590e5d0b2797684824b264ca`（3 次推送，25 文件）；自建 Gitea `main` `9a1e12d354ec74c0b6d579bd7c506d6b3a7f0758`（整仓提交 `022cda3..9a1e12d`） |
| notes | 446 行 / 48,499 字符（含「v1.37.0 升级须知」前置块；**`--merge-from v1.36.1`** —— v1.36.0 已于 2026-09-30 发布，若从 `v1.36.0` 起合并会把它的段落**重复带上**，实测确认后改起点） |
| 发布通道 | GitHub：**REST API**（`gh` 探测失败自动回退，日志已注明）；Gitea：**Node `fetch` 打 REST API**（本机 curl 访问该站恒 `000`） |
| ★ 真包冒烟 | **24/0**（跑 `deploy/linux/bundle.js`，不是源码）—— 启动成功；内嵌前端 asset 名与 **逐字节大小**均等于本次 `dist/`；版本 `1.37.0`；**加密落盘与脱敏在真二进制内生效**；**Webhook 真发到桩端且 HMAC 签名重算一致**；**无 `Dynamic require` 失败**（本版最大风险＝nodemailer 经 esbuild 打包后能否运行） |
| ★ OTA 双源核验 | **14/0** —— 两端匿名 `releases/latest` 均 → `v1.37.0`；两端首个匹配资产＝版本化 zip；直链 range **206** 且魔数正确（`504b` / `2321`）；两端 zip 与 `quick-install.sh` 字节数**逐项相等** |
| ⚠️ 发布流程缺陷（本次发现并修正） | `push-via-api.mjs` **只枚举未跟踪文件**（`git ls-files --others`，即便传 `--files-from` 也只按清单走）⇒ 首次推送后**远端 17 个已修改文件仍是旧内容**（例如 `server/index.ts` 会引用尚未上传的模块）。本次改用 `ls-files --others` **∪** `diff --name-only --diff-filter=d HEAD` 生成完整清单重推；并为远端 2 个误入库的 `settings.json` 补了一次 `sha:null` 删除提交。**后续发布请沿用该清单生成方式** |

### 下一步

- 用户侧验证：应用内「系统更新」→ 检查更新应发现 v1.37.0（双源任一可达即可）；升级后到「设置 → 通知配置」点「发送通知测试」确认通道。
- **本轮未改 `deploy/linux/{install.sh,uninstall.sh,*.service}`** ⇒ **无需重跑 `install.sh`**，OTA 直接替换二进制并重启即可。
- 若启用「容器停止/异常」通知，注意最短检测延迟约 60 秒（巡检周期）。
- 按「**每次发布都发两个地方**」发布到 GitHub + 自建 Gitea（`yanzi/docker-manager-yanzi`）。
- 可选（**未拍板**）：给 `server/docker.ts` 引擎层 + 路由层未覆盖的五类写操作补日志点，并接入本次新建的 `app-YYYY-MM-DD.log` 轮转与保留策略（**管道已就位，接上即可**）。

---

## v1.36.1 — 2026-10-05（**已作废 · 内容并入 v1.37.0** · 未单独出包）

**主题：全部曲线由直线折线改为「单调三次平滑」（PCHIP）—— 观感更顺滑，且数学上保证不过冲；曲线仍穿过每一个真实采样点，tooltip 数值、Y 轴量程与面积填充语义均不变。**

### 已完成

- **渲染改造**：`src/components/LineChart.tsx` 新增导出纯函数 **`smoothPathD(pts)`**，把原先的 `M/L` 折线换成**三次贝塞尔**（`C`）路径；新增 **`smooth?: boolean`** 属性（**默认 `true`**），传 `false` 可一键回到旧折线（应急回退开关）。
- **选型理由（为什么不直接用 Catmull-Rom）**：Catmull-Rom 在尖峰处会**过冲** —— CPU 92% 突降到 30% 时，曲线会先冲到数值并不存在的高度再回落。改用 **PCHIP（Fritsch–Carlson 单调三次插值）**：内部节点取相邻斜率的**加权调和平均**、局部极值 / 平台处**切线置 0**、端点用三点公式并限幅 ⇒ **分段单调**，永不超出相邻两点的取值区间。
- **顺带加固**：路径构建对 `NaN` / `Infinity`（采样缺口）沿用上一个有效值，避免畸形 `d`；面积路径复用同一条曲线 `d`，与线条几何天然一致。
- **影响面**：全站 **8 处**图表（`Dashboard.tsx` 4 处 + `Containers.tsx` 4 处）**零改动即生效**（默认开启）；`Stacks.tsx` 中的 `<svg` 是堆栈图标上传校验，与曲线无关。
- **验证（全部实测）**：
  - 前后端 `tsc --noEmit` **exit 0**；`npm run test:gates` **exit 0**（24 / 29 / 18 / 15 / 34，FAIL 全 0）。
  - **纯函数断言 9 / 0**：① 每段一个 `C`、路径无 `NaN` ② **过冲量 `0.000000 px`**（每段采样 200 点） ③ 曲线穿过每个真实点（最大偏差 0.0586 px，即 `.toFixed(1)` 精度） ④ 2 点退化为直线、空数组返回空串、路径纯 ASCII ⑤ **负向对照**：同样数据用普通 Catmull-Rom 生成路径，检测器报 **7.376 px 过冲** ⇒ 证明「过冲检测」不是装饰。
  - **真实组件渲染断言 14 / 0**（`renderToStaticMarkup` 跑真 `<LineChart>`）：默认（不传 `smooth`）渲染 2 条 path 且折线含 `C`、过冲 0、面积复用同一曲线并闭合；`smooth={false}` 回到纯 `L`（每点一个）；双轴 + 虚线序列（磁盘读写 + 利用率场景）4 条 path 全部无过冲；单点数据不渲染 path、走「正在采样…」占位。
- 涉及文件：`src/components/LineChart.tsx`、`package.json`、`docs/CHANGELOG.md`。

### 未完成 / 已知限制

- 本次只做**渲染层平滑**（视觉），**未对采样数据做降噪 / 滑动平均** —— 数值、tooltip、Y 轴量程与告警判据全部保持原样。若目标是「数据别那么抖」，需另做数据侧 EMA（会抹平尖峰，口径需另行确认）。
- **未出 SEA 包、未发布**（版本串 `1.36.1` 已写入 `package.json`，`dist/` 需在出包前重新构建）。

### 下一步

- 出包前：删 `dist/` 重跑 `vite build`（版本串需重新嵌入），再走 `scripts/build-binary.mjs` 的 SEA 链路。
- 认可观感后：按「**每次发布都发两个地方**」发布到 GitHub + 自建 Gitea（`yanzi/docker-manager-yanzi`）。

---

## 开发进度总览

> 最后更新：2026-10-05

### 当前状态

| 项 | 值 |
|---|---|
| 当前版本 | **v1.37.0**（**已出包 · 已发布 2026-10-05**）：**系统设置新增三个页面** —— ①「**应用详情**」（新增 `server/appinfo.ts`，183 行；应用安装位置 + 六个目录真实路径 / 文件数 / 占用；受限遍历 `MAX_ENTRIES=200_000` + 30 秒缓存 + 符号链接跳过）②「**应用日志**」（新增 `server/applogs.ts`，360 行；列表 / 尾部查看 / 单文件下载 / zip 导出 / 保留策略「天数 `maxDays` + 容量 `maxTotalMB`」双上限**先到先清**且**永不删当天文件**；文件名白名单 `^app-\d{4}-\d{2}-\d{2}\.log$` + `path.resolve` 双重防穿越；`/api/applogs/export` 必须注册在 `/:name` 之前）③「**目录镜像**」（新增 `server/mirror.ts`，425 行；备份与 compose 目录**实时另存**到其他路径，语义＝**真镜像**「源删 ⇒ 目标同步删」，目标路径严格拒绝 6 类非法值（含**「是源的上级」**）；触发＝`fs.watch`（1 秒防抖）+ **60 秒全量对账**兜底；增量判据 `size` 相同且 `\|mtimeMs 差\| < 1000ms`，复制后 `utimesSync` **回写 mtime**）。合计新增 **9 条路由**（`/api/system/app-info` + 6 条 `/api/applogs*` + 2 条 `/api/mirror*`）、**10 个前端类型**、**9 个 API 封装**；设置持久化新增 `mirror` / `logRetention` 两段（旧配置缺段时继承默认）。验证＝前后端 `tsc` **双 exit 0** + `test:gates` **exit 0**（120 项 PASS / FAIL 0）+ **真实文件系统 harness 14 段 70/0**（含真镜像删除、真实 `fs.watch` 事件触发、日志穿越防线、天数与容量双上限裁剪、zip 的 PK 魔数）+ **HTTP 层端到端冒烟 60/0**（真实 Express + 真实 HTTP；含**路由顺序的区分性断言**——`/api/applogs/export` 返回 zip 而非被 `/:name` 吞掉；并抓出 `cleanupExport` 用 `rmSync` 递归同步删目录**阻塞事件循环 21,140 ms** ⇒ 改 `fs.rm` 异步后复跑**慢请求归零**）+ **静态接线审计**（10 处理器 / 9 封装 / 11 处 JSX 挂载点全部落位）。**另含两组独立加固**：**通知真实现**（Webhook + nodemailer 邮件，真实发送 e2e **43/0**，新增 `lint:notify` 门禁）+ **密钥安全**（AES-256-GCM 加密落盘 / 不回传前端 / env 覆盖 / 堵住 `settings.json` 的 git 泄漏，新增 `test:secrets` 门禁 **40/0**）。全量 `test:gates` **7 组 246 项 PASS / FAIL 0**。**并入 v1.36.1**（**未出包 · 未发布**）：**全部曲线改为单调三次平滑（PCHIP，无过冲）** —— `src/components/LineChart.tsx` 新增 `smoothPathD()` 与 `smooth`（默认 `true`），全站 8 处图表零改动生效；曲线仍穿过每个真实采样点、tooltip 与量程不变。验证＝`tsc` 双 0 + `test:gates` exit 0 + 纯函数断言 **9/0**（含 Catmull-Rom 负向对照 **7.376 px 过冲**）+ 真实组件渲染断言 **14/0**。上一已发布版本 **v1.36.0**（**已发布 2026-09-30**）：**OTA 与一键安装改双源 —— 自建 Gitea 优先、GitHub 保底**。新增 `checkGiteaUpdate()`（8 秒超时、匿名）、`UpdateInfo.source`、**跨源下载保底**（Gitea 候选全失败 ⇒ 自动追加 GitHub 资产再跑一轮）、环境变量 `UPDATE_GITEA_BASE` / `UPDATE_GITEA_REPO` 覆盖；`quick-install.sh` 同步双源（`GITEA_BASE` / `GITEA_REPO`）并修掉「`ASSET_SIZE` 在函数定义前调用 ⇒ 包大小恒 0、进度无百分比」的顺序 bug。**发布规约：每次发布都发两个地方。** 上一已发布版本 **v1.35.11**（**已发布 2026-09-30**）：**`upapi` 改由 `device_uuid` 是否变化决定** —— `resolveUpapi(trigger, reportInstall)` → **`resolveUpapi(state, deviceId)`**：`!installReported \|\| lastDeviceId !== deviceId` ⇒ `install`，否则 `heartbeat`。**每次进程启动 / systemd restart 不再报 `install`**（ID 未变即 `heartbeat`），只有首次安装 / 身份真的变了才 `install` ⇒ **`install` 计数 ≈ 去重设备数**。运行态新增 **`lastDeviceId`**（每次成功上报都写，`reportOnce` 与 `reportOnToggle` 两处）；`ReportTrigger` 降级为「只决定要不要强制发」；24h 限流（`reportInstall` / `lastRebuildAt`）退化为**观测标记**（旧限流防的「同机反复改写刷安装量」现已由身份判据天然覆盖）。**上传开关切换仍恒 `install`**（按用户要求保留的唯一例外）。升级兼容：无 `lastDeviceId` ⇒ 保守补发一次 `install`。涉及客户端 `server/telemetry.ts`、`docs/上报触发与接口及上报内容.md`、`package.json`；**服务端 `yanzi/api` 与 `server/index.ts` 均无需改动**。验证＝前后端 `tsc` 双 0 + `test:gates` exit 0 + 删 `dist/` 重跑 `vite build` + 源码 harness（同 ID 重启 ⇒ `heartbeat`；换 ID ⇒ `install`）+ 真包冒烟。上一版 **v1.35.10**（已出包 · 未发布 · **包自本版起作废**）：**按触发源决定** —— 新增唯一判据 `resolveUpapi(trigger, reportInstall)`：`startup`（进程启动 / systemd restart）⇒ `install`，`periodic`（12h）/ `retry`（失败后 10 分钟）/ `manual`（页面「立即上报」）⇒ `heartbeat`，`reportOnToggle`（开关开↔关点 APPLY）**恒** `install`；`needInstall` 退化为「**只决定要不要发**」。`reportOnce(force = false)` → `reportOnce(trigger: ReportTrigger)`、`scheduleNext(delayMs, force)` → `scheduleNext(delayMs, trigger)`、`startTelemetryHeartbeat()` 传 `"startup"`、`POST /api/telemetry/report` 传 `"manual"`。**根因**＝旧 `upapi = needInstall ? "install" : "heartbeat"`，而 `installReported` **只在 2xx 成功时置位**、端点 NXDOMAIN ⇒ 所有触发退化成 `install`（真包 + 桩远端双向复现：500 ⇒ 全 `install`；200 ⇒ 首报 `install` 后转 `heartbeat`）。涉及客户端 `server/telemetry.ts`、`server/index.ts`、`docs/上报触发与接口及上报内容.md`、`package.json`；**服务端 `yanzi/api` 本次无需改动**（载荷仍是 15 个顶层字段，`resolveEvent` 的 `install`/`heartbeat` 分支不变）。验证＝前后端 `tsc` 双 `exit 0` + `npm run test:gates` exit 0 + 删 `dist/` 重跑 `vite build` + 真包六场景取证。⚠️ **新增语义**：同一设备**每次重启都会收到一条 `install`**，服务端去重请改为 **`device_uuid` upsert ＋ 比对 `installedAt`**。上一版 **v1.35.9**（已出包 · 未发布 · **包自本版起作废** · 2026-09-29）：**上报字段收敛** —— 把「常量 `event` + 布尔 `install`」两个冗余字段合并为单字段 **`upapi: "install" \| "heartbeat"`**（信息量严格等价）；运行态 `lastReportAt` / `lastActiveAt` 合并为 **`lastReportAt`**（`readState` 兼容读旧文件）；`hw_fingerprint` 字段与 DB 列**跨两仓彻底删除**（服务端幂等 `ALTER TABLE telemetry_devices DROP COLUMN hw_fingerprint`）；修掉「关闭上传开关后每 10 分钟空转」（`!cfg.enabled` ⇒ `fatal:true`，退回 12h 周期）。服务端 `resolveEvent` 三代兼容归一（`body.event \|\| body.upapi`，`install`→装 / `active`\|`heartbeat`→心跳 / `report`→看 `body.install`，其余 400）。涉及客户端 `server/telemetry.ts`、`src/api.ts`、`docs/上报触发与接口及上报内容.md`、`docs/上报.json`；服务端 `yanzi/api/src/{telemetry,db,routes}.js`、`yanzi/api/scripts/*`、`yanzi/api/README.md`、`yanzi/backstage/src/app.js`、`yanzi/docs/api-yanzi-docker-event.md`。验证＝服务端回归 `verify-telemetry.mjs` **78/0**（含删列幂等）+ 前后端 `tsc` 双 0 + `test:gates` **exit 0**（hooks 44 + auth 24/0 & 29/0 + restart 18/0 + thermal 15/0 + install 34/0）+ `vite build`（新资产 `assets/index-d-CniirZ.js`，js 内 `"1.35.9"`×1 / `"1.35.8"`×0）。⚠️ **部署顺序＝服务端 `yanzi/api` 必须先上**：现役 ECS1 只认 `event: install\|active`，不认 `upapi`/`heartbeat`/`report`，而 400 在客户端判为非致命（仅 401/403 fatal）⇒ 客户端先上会每 10 分钟无限重试；删列不可逆，执行前备份 `yanzi/api/data/yanzi-admin.db`。上一版 **v1.35.8**（已出包 · 未发布）：累计承接 **v1.35.3**（所有曲线 X 轴时间刻度）→ **v1.35.4**（容器目录打包下载 tar.gz）→ **v1.35.5**（仪表盘改造：系统概览 7 字段 / 磁盘卡片文件系统列 / 曲线默认折叠）→ **v1.35.6**（处理器·内存图标提示改**卡片式自定义 tooltip**）→ **v1.35.8**（温度能力落地：仪表盘磁盘卡片**显示温度**（读 sysfs hwmon **零提权**）+ **「利用率」列去掉进度条**；设置页**新增「温度」卡片**（CPU + 各盘 + `drivetemp` 检测）并把「本机设备」**改名「硬件信息」**；**`install.sh` 安装时自动加载 `drivetemp`**（`modprobe` + 写 `/etc/modules-load.d/drivetemp.conf` 持久化，`--no-drivetemp` 跳过，`uninstall.sh` 按归属标记清理）+ 新增**温度采集门禁** `scripts/check-thermal.mjs` 与**安装脚本门禁** `scripts/check-install-drivetemp.sh`；按用户要求不做 S.M.A.R.T.）。涉及 `src/pages/Dashboard.tsx`、`src/pages/Settings.tsx`、`src/components/ActivityPanel.tsx`、`src/lib/thermal.ts`、`server/docker.ts`、`server/index.ts`、`server/settings.ts`、`server/telemetry.ts`、`server/unit-status.ts`、`src/types.ts`、`src/api.ts`、`scripts/check-thermal.mjs`、`scripts/check-install-drivetemp.sh`、`deploy/linux/install.sh`、`deploy/linux/uninstall.sh`、`deploy/linux/README.md`、`package.json`。验证＝`lint:hooks` PASS（44 文件）+ 前后端 `tsc` 双 0 + `build:frontend`/`vite build` PASS + 路由层 13/13（v1.35.4）+ **`test:gates` 全绿（hooks 44 + auth 24/0 & 29/0 + restart 18/0 + thermal 15/0 + install 34/0）** + agent-browser 组件级实测（v1.35.6：`[role=tooltip]`×2 + hover `opacity 0→1`；v1.35.8 仪表盘：温度表头 6 列 + 阈值配色 + `null`→「—」+ **利用率去进度条**（表内 `<div>` 归零）；v1.35.8 设置页：`h2`=硬件信息 + 卡片标题「温度/硬件信息标识」+ 三场景（缺 drivetemp 提示条 1 条 / 已加载 0 条 / 全无传感器）+ CPU 62℃ 红加粗，均无 console error）。⚠️ **v1.35.6 及更早的包已从 `build-upload/`、`deploy/linux/` 清除，勿部署**；⚠️ 版本号语义：UI / 交互小改动走 **Patch**（`1.35.3 → … → 1.35.9`） |
| 版本号规则 | Major 人工发布；Minor ＝ **新增功能模块 / 新页面**；Patch ＝ 修复/优化/**UI 与交互小改动**（如 `1.35.0 → 1.35.1`）。v1.22.0 因新增「镜像更新→通知中心」与「硬件指纹作主键」两项新能力归为 Minor |
| 最新 Release | [v1.37.0](https://github.com/yanziruxue/docker-manager/releases/tag/v1.37.0)（**2026-10-05 发布**）＋ **自建 Gitea [v1.37.0](https://git.ziruxue.top/yanzi/docker-manager-yanzi/releases/tag/v1.37.0)**（**id=13**；两端 3 资产 **size 逐字节一致**）—— 主题＝**通知真实现（Webhook + 邮件）+ 密钥加密存储与不回传前端 + 拉取弹窗自动关闭 + 设置页三页 + 密码框小眼睛**；双源 OTA 核验 **14/0**、真包冒烟 **24/0**；上一已发布版本 [v1.36.0](https://github.com/yanziruxue/docker-manager/releases/tag/v1.36.0)（**2026-09-30 发布** · 主题＝OTA / 一键安装改双源（自建 Gitea 优先、GitHub 保底），确立「**每次发布都发两个地方**」的发布规约）；上一已发布版本 [v1.35.11](https://github.com/yanziruxue/docker-manager/releases/tag/v1.35.11)（**2026-09-30 发布** · 累积发布 **v1.32.0 → v1.35.11**：容器文件管理 / 温度能力 / 详情页与仪表盘演进 / 遥测 `upapi` 三代迭代；assets＝版本化 zip + latest 别名 + `quick-install.sh`，均 `uploaded`；notes 合并 **v1.32.0 → v1.35.11 共 15 个开发版本**；⚠️ 部署顺序＝**服务端 `yanzi/api` 先上**；⚠️ 本版改了 `install.sh`，启用 drivetemp 自动加载需重跑一次）；上一版 [v1.31.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.31.1) |
| 源码分支 | `main`（当前发布点 **GitHub** `5c31a92e279ef35e590e5d0b2797684824b264ca`（v1.37.0，**25 文件**，分 3 次 Git Database API 推送：`f4888d77` 先推 8 个新文件 → `5cfd3412` **补齐 17 个已修改文件** → `5c31a92e` 删除误入库的 2 个 `settings.json`）；**自建 Gitea** `9a1e12d354ec74c0b6d579bd7c506d6b3a7f0758`（整仓提交推送 `022cda3..9a1e12d`）；上一版 `7ec0a17894e84dae7f83b58685caa6a7433fa654`（v1.35.11）；自建 Gitea 镜像 `yanzi/docker-manager-yanzi` @ `73e2063`） |
| 部署注意 | **v1.35.9 ⚠️ 部署顺序＝服务端 `yanzi/api` 必须先上、再发客户端**：现役 ECS1 服务端只认 `event: install\|active`，不认新的 `upapi` / `heartbeat` / `report`；而 400 在客户端被判为**非致命**（仅 401/403 fatal）⇒ 客户端先上会**每 10 分钟无限重试**。服务端升级含 DB 迁移（幂等 `ALTER TABLE … DROP COLUMN hw_fingerprint`，不可逆），执行前备份 `yanzi/api/data/yanzi-admin.db`。**v1.35.10 / v1.35.11 沿用该顺序**（客户端载荷字段集合与 v1.35.9 完全一致，仅 `upapi` **取值语义**变化）。**改过 `deploy/linux/*.service` 的版本，OTA 后必须重跑 `install.sh`**（或在「设置 → 硬件信息」页复制一键修复命令）——OTA 只替换二进制，不更新单元文件。**v1.35.8 另改了 `install.sh`**（新增 `drivetemp` 自动加载）⇒ 老部署升级后若看重磁盘温度，建议重跑一次 `install.sh`，或按「设置 → 硬件信息 → 温度」提示条里的命令手动 `modprobe drivetemp` + 写 `/etc/modules-load.d/drivetemp.conf` |
| 交付包 | **当前 tip = v1.37.0（已发布 2026-10-05）**：`build-upload/docker-manager-yanzi-linux-x64-v1.37.0.zip` **43,211,848 B** / SHA-256 `d2409d1753410f8664901eaeca8a859910cb8e48a808a7c7b8ad218e2558c932`（内嵌二进制 130,813,120 B / `52b64363e66b28ac7ee95bfdc1f560ec9fcc173c4556be1cfa86e8cfe3fe7982`，ELF `7f454c46` 已校验、`CURRENT_VERSION="1.37.0"`）+ 无版本号 `latest` 别名同字节；前端资产 `assets/index-DDCM49KO.js`（1,112,657 B）；`bundle.js` 5,620,565 B（含 `nodemailer`，约 +400 KB）；**真包冒烟 24/0**。**上一版 v1.36.0（已发布 2026-09-30）**：`build-upload/docker-manager-yanzi-linux-x64-v1.36.0.zip` **43,034,593 B** / SHA-256 `ae8752213ed928600d843a321b4f64c97e9a0dd76f659b4dfb336d0058b2507e`（内嵌二进制 130,092,224 B / `e798e940f9bb9b765ea3cb4777f25956ef500860dd8583a5bef16498fc818cad`，ELF `7f454c46` 已校验、`CURRENT_VERSION="1.36.0"`）+ 无版本号 `latest` 别名同字节；前端资产 `assets/index-gKErWW9k.js`（1,085,514 B）。**上一版 v1.35.11（已发布 2026-09-30）**：`build-upload/docker-manager-yanzi-linux-x64-v1.35.11.zip` **43,032,814 B** / SHA-256 `bfbd557e71ec60c148c6ca068d85f87832f2851db29346e3003ebcf50ffe21ad`（内嵌二进制 **130,092,224 B** / SHA-256 `d68f4ef38cf9db70b335936609f6d9c1ffbbf829832f4cd812ddd68e6d22752e`，ELF `7f454c46` 已校验、`CURRENT_VERSION="1.35.11"`、含 `resolveUpapi` 与 `lastDeviceId`）+ 无版本号 `latest` 别名同字节；前端资产 `assets/index-CDpmlpm-.js`（1,085,357 B）。**上一版 v1.35.10 的包 `build-upload/docker-manager-yanzi-linux-x64-v1.35.10.zip` 43,032,780 B / SHA-256 `7b6f80359a0d3af194908e9dfbf80c5bddc746f6a5442633c35a4b397884eeb7`（内嵌二进制 130,092,224 B / `e4284a6a15e0e48a8a9630dc29d326c4ecd99f209975e5cc27b6ad39a0c20b62`、ELF `7f454c46`、`CURRENT_VERSION="1.35.10"`）自本版起作废并已删除**。更早的 **v1.35.9**（`…-v1.35.9.zip` 43,032,672 B / `0571cb86933268523c26bf909f4d252dee17ef6617a0e976d569949473df36d1`，内嵌二进制 `cc320b778a0a975e46a569acf68a8fded3694f43b6b18b18ef27c23379a864ee`）**已删除**；**v1.35.8**（`…-v1.35.8.zip` 43,032,727 B / `d2f5216362d8c75c73e1bccdadc7205b10e54a4cee512f9ef9b80f6f4ab6bd06`，内嵌二进制 `3800a5d064e69181db122c4f29f014f4a548cd56b5b34a6adab470995ae3d33a`）**已删除**；**v1.35.6**（`…-v1.35.6.zip` 43,027,762 B / `b2de2716…`，内嵌二进制 `90dea067…`）**已作废并删除**。**Windows 交叉构建路径**：`scripts/build-binary.mjs` → 以 `/tmp/sea-build/node-v22.22.2-linux-x64/bin/node`（**Linux node**）为 base 生成 blob → `postject` 注入 → `make-package.py` 打 zip（⚠️ **不要用 `deploy/linux/build.sh`**，那是「在 Linux 上」的构建路径、用本机 `command -v node`，在 Windows 上会拿 Windows node 当 base）。`scripts/` 不在交付包成员内 |
| 架构 | REST + WS + SSE 三通道；Socket / TCP / SSH 三种引擎 |
| 目标平台 | Linux x64（SEA 单可执行文件），Unraid / 自托管 NAS |

### 模块完成状态

| 模块 | 状态 | 说明 |
|---|:---:|---|
| 多引擎管理 | ✅ | Socket / TCP / SSH，CRUD + 连接测试 + 持久化 |
| 仪表盘 | ✅ | **Unraid 式三列磁贴布局**（`Tile` / `TileGrid`；磁贴可折叠、折叠态持久化、**不支持拖拽与移除**；`Tile` 支持 `persistent` 常驻区，折叠后仍显示）。**列编排随断点变化（`TileGrid.useMinWidth()`）**：**≥1800px（3 列）**＝`[系统概览/处理器/内存] [容器/堆栈/镜像] [网络/磁盘]`；**1024–1799px（2 列）**＝`[系统概览/处理器/内存/磁盘] [容器/堆栈/镜像/网络]`（**列元素个数不得超过列数**，否则第 3 列换行到第 2 行、折叠上方磁贴时下方不上移）；**<1024px** 仍是 3 个列元素单列堆叠（行内只有一格 → 不变顺序）。系统概览＝40px 时钟 + 日期 + 信息栅格（含 **正常运行时间**，读 `/proc/uptime`）；处理器＝**副标题「整体负载 N% / 100%」** + 横向条形（**折叠后仍常驻**）+ 整体负载曲线（量程固定 **0–100%**、**常驻且自带折叠开关**）+ 各核条形（随磁贴折叠）；内存＝**副标题「已用 X / 共 Y · 剩余 Z」** + 双曲线（**量程钉在已安装总量**）；容器（原「Docker 容器」）＝**状态筛选 + 卡片列表，点卡片图标开 WebUI**；堆栈＝**状态筛选 + 卡片列表，点卡片图标弹容器子表**；镜像＝本地/未使用/悬空计数；网络＝双曲线 + **网口下拉**（全部 / 网口 / Docker 虚拟网卡，来自 `GET /api/engines/:id/net-interfaces`，按磁贴持久化 `dm.chart.network.iface`）；磁盘＝**读写速率 + 利用率双轴曲线**（形态同处理器：常驻 + 自带折叠开关，原利用率表降为可折叠区；利用率走右轴固定 0–100%）。**四处曲线（处理器 / 内存 / 网络 / 磁盘）统一支持时间范围下拉**（10 秒~5 分钟，按磁贴持久化 `dm.chart.<id>.range`，切换仅本地切片、不发请求）**与「悬停取值」**（游标竖线 + 每序列圆点 + 数值提示框，首行为该点时间标签；由 `LineChart` 的 `labels` / `formatValue` / `yMaxRight` 驱动）**，且四张曲线底部均显示 X 轴时间刻度（v1.35.3 起，首 / 中 / 尾三点）**。卡片列表由共享组件 `NodeCard` / `NodeCardGrid` / `FilterChips` 渲染，容器子表由 `StackContainersModal` 提供（与堆栈管理页共用） |
| 容器管理 | ✅ | 列表 / 详情 / 启停 / 日志 / 资源监控（**v1.35.1 起四张卡均带历史曲线**）/ Web 终端 / CSV 导出；**容器文件管理**（v1.33.0，浏览 / 编辑 / 上传 / 下载 / 增删改 / chmod，仅运行中容器）；**详情两种形态**（v1.33.0 半页面 ↔ 弹窗可切；v1.34.0 半页面**可拖动改宽**、基本信息与资源监控单列、日志/终端撑满；头部去镜像；v1.35.3 起四张卡曲线底部带 X 轴时间刻度） |
| 堆栈管理 | ✅ | Compose 自动发现 / 创建（含**上传堆栈备份初始化**）/ 编辑 / 操作 / 更新检查 / 备份恢复 / 批量操作；**Compose 编辑器「格式化」按《YAML 编码规范（Docker Compose 专用）》输出**（2 空格缩进 + 数组块状 + 服务参数 §4.2 排序（image 置末）+ 顶层 §4.1 排序 + **保留注释**） |
| 镜像管理 | ✅ | 列表 / 筛选 / 拉取（**失败可重试**）/ 删除 / prune 未使用 / **导出下载 tar** / **上传 tar 导入** / **检查更新（真实 digest 比对，含「更新状态」列与单镜像检查）** |
| 数据卷管理 | ✅ | 列表 / 新建 / 删除 / prune / 详情；**网络管理**（网络↔容器映射 / 增删改 / 上下行流量） |
| 备份管理 | ✅ | 手动全量 + 堆栈级备份 / 恢复（含**上传备份文件直接恢复**）/ 导出（**zip** 格式，兼容历史 tar.gz）+ 自动备份调度器（周/月/年/Cron，含保留清理） |
| 权限诊断与修复 | ✅ | 备份期自愈 `u+r` + 结构化诊断（属主/权限位/一条修复命令）+ `fix-perms` CLI + 启动体检与界面提示 |
| 通知中心 | ✅ | 未读已读 + localStorage 持久化 |
| 系统设置 | ✅ | Docker 配置 / Compose 模式 / 通知 / 备份 / **镜像更新**（原「更新调度器」）/ 列显隐 / **硬件信息**（原「本机设备」，v1.35.8 改名）：**温度卡片**（CPU 温度 + 各整盘温度，读 sysfs hwmon **零提权**；缺温度的 SATA 盘给 `drivetemp` 加载提示与一键复制命令；**v1.35.8 起 `install.sh` 安装时已自动加载并持久化**，在线升级不更新安装脚本、老部署需手动跑一次或重跑 `install.sh`）+ 硬件指纹 6 维 + 完整硬件详情卡片（含 **主板型号 / 产品序列号 / 系统UUID**，只读；**「上传安装数量统计」开关默认开启**，关闭后不发任何请求 + 「安装时间」一行）/ **应用详情**（v1.37.0 新增：应用安装位置 + 六个目录的真实路径 / 文件数 / 占用，只读）/ **应用日志**（v1.37.0 新增：列表 / 尾部查看 / 单文件下载 / zip 导出 / 「立即清理」/ 保留策略表单（开关 + 天数 + 容量））/ **目录镜像**（v1.37.0 新增：备份目录与 compose 目录实时另存，每源一卡：开关 + 目标路径 + 校验提示 + 运行态 + 「立即同步」，15 秒轮询） |
| Web 终端 | ✅ | xterm.js + WebSocket + 多 Shell 检测 |
| 登录鉴权 | ✅ | 单管理员 + scrypt + httpOnly 会话（绝对过期）+ 密码找回码（**18~24 位字母数字、区分大小写、10 分钟限流**；**历史记录按大写哈希者输入小写仍可用**，`legacyUpperVariants` 回退）+ **凭据版本 `credentialVersion`（本版要求 2）**：老记录登录后**强制重走「用户名 / 密码 / 找回码」**（`POST /api/auth/reinit`），期间除白名单外的全部 `/api` 返回 `403 REINIT_REQUIRED`，重设成功即作废该用户**全部会话** |
| 镜像更新（原更新调度器） | ✅ | 后台定时检查镜像版本（每天 / 每周 / 每月，非 Cron）+ 结果落盘缓存 + 镜像页「检查更新」共用同一份数据 |
| OTA 自升级 | ✅ | **双源（v1.36.0 起）：自建 Gitea 优先、GitHub 保底**（Gitea 源不拼 gh-proxy），拉取 + 自替换 + systemd 重启，gh-proxy 镜像兜底（仅 GitHub 源），**支持中途取消**；**更新完成后自动刷新页面**（v1.31.1 修：判据与状态码解耦 —— `403 REINIT_REQUIRED` 也算「新进程已上线」；实现见 `src/lib/restart-wait.ts`） |
| Linux SEA 部署 | ✅ | 单可执行文件 + systemd + install/uninstall 脚本（**v1.35.8 起安装时自动加载 `drivetemp` 内核模块并持久化，`--no-drivetemp` 可跳过**）；**OTA 后自动自检服务单元是否落后**（含缺失指令与一键修复命令） |
| Docker 部署 | ✅ | 多阶段 Dockerfile |
| **操作日志系统** | 🔨 **约 60%** | `server/logger.ts` 已建好但**未接入** `docker.ts`（仍是 `console.log`）；前端仅 localStorage 版 `opLog.ts`（500 条）。**v1.37.0 已补齐「日志消费端」**：设置页「应用日志」提供列表 / 尾部查看 / 下载 / zip 导出 / 保留策略（天数 + 容量双上限、永不删当天文件）；但**日志写入点一字未动**（按用户拍板「只做功能，不动日志内容」）⇒ 覆盖率不变：`docker.ts` 引擎层 **0 处**日志，路由层尚有**堆栈 / 网络 / 容器文件管理 / 镜像构建 / 登录**五类写操作未打日志 |
| 中心统计服务 | ⏸ **暂缓** | 上报端已完成（端点 `https://yanzi-api.ziruxue.top/api/yanzi-docker/event`，鉴权头 `X-Telemetry-Key`，12 小时周期；**v1.35.9 起载荷收敛为单字段 `upapi: "install" \| "heartbeat"`**；**v1.35.11 起 `upapi` 由 `device_uuid` 是否变化决定** —— 首次安装 / 身份变化 ⇒ `install`，**每次重启 / 周期 / 重试 ⇒ `heartbeat`**，故 **`install` 次数 ≈ 去重设备数**；⚠️ **开关切换仍发 `install`**，需按载荷 `uploadEnabled` 字段区分；**该域名当前无 DNS 解析，接口未开放**）；中心服务由独立后端实现，本项目不做 |
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
| 目录镜像「真镜像」不可合并 | v1.37.0 的镜像语义是**真镜像**（用户拍板「同步删除」）：目标严格等于源，**目标侧独立新增的内容会被删除**（定义如此，非缺陷）；首轮为空目标 ⇒ **全量复制**，备份目录很大时耗时较长且**无进度条**；`fs.watch` 递归依赖 Linux inotify 上限，`max_user_watches` 偏低时可能**退化为 60 秒轮询兜底**（功能不丢、实时性下降，运行态 `watcherActive` 已透出） |
| 应用详情占用为抽样值 | 目录统计有 `MAX_ENTRIES = 200_000` 条目上限（超出 ⇒ `truncated: true`，界面提示「仅统计部分」）与 **30 秒缓存** ⇒ 刚写入的文件可能未立刻反映 |

### 下一步计划

1. **操作日志收尾**：`docker.ts` 接入 `createLogger("Docker")` 替换 `console.log`；设置页加日志级别 Select（debug/info/warn/error）+ journalctl 查看说明。**v1.37.0 已把「消费端」建好**（列表 / 尾部查看 / 下载 / zip 导出 / 保留策略），补齐写入点即可闭环 —— 待补：`docker.ts` 引擎层 + 路由层的**堆栈 / 网络 / 容器文件管理 / 镜像构建 / 登录**五类写操作。
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
| 第二位 | 次版本 Minor | **新增功能模块 / 新页面**（新字段不算 Minor） |
| 第三位 | 补丁 Patch | 修复、优化、**UI / 交互小改动**（加曲线、去字段、可拖动、换布局…） |

递增约定：
- **UI / 交互类小改动一律走 Patch（第三位）**，形如 `1.35.0 → 1.35.1`；不要因为「看起来是个增强」就跳 Minor。
  同一个模块在同期内连续迭代时按 Patch 连号递增（`1.35.1 → 1.35.2 → …`），把 Minor 留给真正的新模块。
- 一次发布中同时含 Minor 与 Patch 时，按**最高级别**递增，低级别归零（例：`1.0.3` + 新功能 → `1.1.0`）
- Major 由人工决定，不自动递增
- 同一天内的多次改动合并为一个版本，逐条记录在版本下

---

## v1.36.0 — 2026-09-30（**已出包 · 已发布 2026-09-30**）

**主题：OTA 与一键安装改为双源 —— 自建 Gitea 优先、GitHub 保底；并确立「每次发布都发两个地方」的发布规约。**

### 已完成

- **OTA 双源（`server/updater.ts`）**
  - 新增 `checkGiteaUpdate()`：查自建 Gitea `GET {base}/api/v1/repos/{repo}/releases/latest`（**8 秒超时、匿名、无需 Token**），解析 `tag_name` / `assets[].browser_download_url` / `published_at`（兼容 `created_at`）；
  - `checkForUpdate()` 改为 **Gitea 优先**：Gitea 可达且返回了可下载资产即采用；异常或无可下载资产时 `console.warn` 后回退 `checkGitHubUpdate()` 保底；
  - `UpdateInfo` 新增 **`source: "gitea" | "github"`**（`UpdateSource` 类型），前端据此展示「更新源」；
  - 下载候选 `getDownloadCandidates(url, source)`：**Gitea 源只走「直连 → `UPDATE_MIRROR`」**（不再拼 gh-proxy —— 该代理只服务 GitHub 域名）；GitHub 源维持「直连 → `UPDATE_MIRROR` → gh-proxy」；
  - **跨源保底**：Gitea 源候选全部失败时，自动重新解析 GitHub 资产并追加候选再跑一轮（`githubFallbackCandidates()`），`last-update.json` 的 `source` 记 `github`、进度标签用实际下载到的版本号（`appliedVersion`）；
  - `applyLocalZip()` 的 `source` 参数收敛为 `UpdateSource | "local"`（`gitea` / `github` / `local`）；
  - 默认站点 `https://git.ziruxue.top`、仓库 `yanzi/docker-manager-yanzi`，可用 **`UPDATE_GITEA_BASE`** / **`UPDATE_GITEA_REPO`** 覆盖（**无需重新打包**）；Gitea 返回的 `browser_download_url` 会按配置入口做**协议 + 主机改写**（`rewriteToGiteaBase()`），避免其 `ROOT_URL` 与实际入口不一致时下载失败。
- **一键安装脚本双源（`scripts/quick-install.sh`）**
  - 新增 `resolve_asset_gitea()` / `resolve_asset_github()` 与两源共用的 `extract_asset_url()`；主流程 **Gitea 优先、GitHub 保底**，并在日志里打印「下载源」与「安装包来源」；
  - Gitea 走**直连** `http_get_direct()`（gh-proxy 不代理非 GitHub 域名）；下载候选按 URL 域决定是否追加 gh-proxy；
  - **跨源保底**：Gitea 资产下载失败时重新解析 GitHub 资产再试一轮，两源皆不可用才报错退出；
  - 新增环境变量 **`GITEA_BASE`**（默认 `https://git.ziruxue.top`）/ **`GITEA_REPO`**（默认 `yanzi/docker-manager-yanzi`）；
  - 🐛 **顺手修 bug**：`ASSET_SIZE` 原先在 `remote_size()` / `fmt_mb()` **定义之前**调用 ⇒ `command not found`（127）被 `|| echo 0` 吞掉 ⇒ **「包大小」恒为 0、下载进度永远没有百分比/总量**；已把该段移到 `# <<< download-helpers` 之后（标记名未动）。
- **前端（`src/types.ts`、`src/pages/Settings.tsx`）**：`UpdateInfo` 新增可选 `source`；「发现新版本」卡片新增一行「**更新源：自建 Gitea（优先）/ GitHub Releases（保底）**」。
- **发布规约（用户拍板）**：**每次发布都发两个地方** —— GitHub Release + 自建 Gitea Release，两端资产一致（版本化 zip + `latest` 别名 + `quick-install.sh`）。
- **文档**：`docs/发布与OTA升级指南.md`（§2 改为「发布到双端」、§4 更新源表 / 使用步骤 / 后端流程 / 端点 / 出网要求 / 取包规则）、`README.md`（安装命令与源顺序）、本文件。

### 验证

- **前后端 `tsc`**：`npx tsc -p server/tsconfig.json --noEmit` → **exit 0**；`npx tsc -p tsconfig.json --noEmit` → **exit 0**；
- **`npm run test:gates`** → **exit 0**（hooks / auth / restart / thermal / install 五组 `结果: PASS=` 齐全）；
- **真实 Gitea API 实测**（Node fetch 走域名）：`GET https://git.ziruxue.top/api/v1/repos/yanzi/docker-manager-yanzi/releases/latest` → **HTTP 200**，`tag_name=v1.35.11`、含 `published_at`、3 个资产（版本化 zip / `latest` 别名 / `quick-install.sh`，size 与 GitHub **逐字节一致**）；下载直链 **HTTP 206**、前 2 字节 `504b`（PK）；
- **安装脚本双源 harness 14/0**（抽取 `quick-install.sh` 真实片段 + 桩掉 `http_get*`）：① Gitea 可用（真实 JSON）⇒ 选源 gitea 且 API 路径 `/releases/latest`、**不请求 GitHub**；② Gitea 不可用 ⇒ 回退 GitHub 并有告警；③ Gitea 可达但无 linux-x64 资产 ⇒ 回退 GitHub；④ 两源皆不可用 ⇒ 打印错误且**退出码 1**；⑤ `VERSION=1.35.11` ⇒ 走 `/releases/tags/v1.35.11`；⑥ Gitea 源下载候选**不含 gh-proxy**；⑦ GitHub 源候选含 `UPDATE_MIRROR` + gh-proxy。
### 交付包

| 项 | 值 |
|---|---|
| 交付包 | `build-upload/docker-manager-yanzi-linux-x64-v1.36.0.zip` **43,034,593 B** / SHA-256 `ae8752213ed928600d843a321b4f64c97e9a0dd76f659b4dfb336d0058b2507e` |
| latest 别名 | `build-upload/docker-manager-yanzi-linux-x64.zip`（同字节） |
| 内置二进制 | 130,092,224 B / SHA-256 `e798e940f9bb9b765ea3cb4777f25956ef500860dd8583a5bef16498fc818cad`（ELF `7f454c46` 已校验、`CURRENT_VERSION = "1.36.0"`） |
| 前端资产 | `dist/assets/index-gKErWW9k.js`（1,085,514 B）、`index-D4ubT5WG.css`（47,237 B） |
| 包内成员 | 5 个（二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`），权限位已校验（二进制与脚本 755） |

**真机链路取证（Windows 开发机侧，Node 环境）**：

| 场景 | 结果 |
|---|---|
| 打包后的 `updater.ts` 实打 Gitea API（默认域名） | ✅ `source=gitea`、`latestVersion=1.35.11`、`assetName=docker-manager-yanzi-linux-x64-v1.35.11.zip`、`assetSize=43032814`、`downloadUrl=https://git.ziruxue.top/…`、`publishedAt=2026-09-30T07:22:25+08:00` |
| `UPDATE_GITEA_REPO` 改成不存在的仓库 | ✅ 抛 `自建 Gitea API 返回 404`（失败可观测，非静默回退） |
| 优先源不可达 ⇒ `checkForUpdate()` | ✅ **回退 GitHub 保底**：`source=github`、`downloadUrl=https://github.com/…`（保底链真实走通） |
| 交付包 `bundle.js` 起服务（`:5099`） | ✅ `/` 返回 `index-gKErWW9k.js` / `index-D4ubT5WG.css`，与 `dist/assets/` **逐字一致**（证明内嵌前端是本次构建） |
| `GET /api/system/update/check`（真实端点） | ✅ `{currentVersion:"1.36.0", hasUpdate:false, source:"gitea", assetName:"…-v1.35.11.zip", assetSize:43032814, downloadUrl:"https://git.ziruxue.top/…"}` |
| 安装脚本双源 harness | ✅ 14/14（见上「验证」） |
| `UPDATE_GITEA_BASE=http://60.205.251.18:8024` | ⚠️ **本机 Node 直连该端口 8 秒超时**（本机 curl 是经 HTTP 代理才通）⇒ IP 入口的 host 改写逻辑**未能在本机端到端取证**，留待生产环境验证；默认域名路径已实测通过 |

### 未完成 / 已知限制

- 本次**无服务端（`yanzi/api`）改动** ⇒ 不涉及 DB 迁移、部署顺序不受限（与 v1.35.11 的「服务端先上」无关）；
- `git.ziruxue.top` 在**本机 curl / git** 下不可达（schannel 握手失败 / 连接重置），但 **Node fetch（OTA 与安装脚本的真实运行环境）完全正常**；本机 CLI 操作 Gitea 仍需走 `http://60.205.251.18:8024`。属本机环境问题，非服务端故障；
- Gitea 与 GitHub 之间**不做版本号交叉比对**：若某次只发了一端，另一端用户会停在旧版本（发布规约已要求双发，后续可加交叉校验）；
- 前端「更新源」是**展示项**，不提供切换入口（切换靠服务器环境变量）。

### 下一步

- 出包并**双端发布 v1.36.0**（GitHub + 自建 Gitea，资产一致）；
- 如需内网 / IP 入口部署，用 `UPDATE_GITEA_BASE=http://<host>:8024` 做一次端到端改写取证。

### 发布记录（2026-09-30）

| 项 | 值 |
|---|---|
| Tag | `v1.36.0` |
| GitHub Release | [v1.36.0](https://github.com/yanziruxue/docker-manager/releases/tag/v1.36.0) —— `draft=false`、`prerelease=false`、`latest` 已更新；3 资产（版本化 zip 43,034,593 B / latest 别名同字节 / `quick-install.sh` 12,365 B）；版本化直链 range **206** |
| 自建 Gitea Release | [v1.36.0](https://git.ziruxue.top/yanzi/docker-manager-yanzi/releases/tag/v1.36.0) —— **id=7**、`draft=false`、`prerelease=false`、`published_at=2026-09-30T08:19:19+08:00`；同 3 资产且 **size 与 GitHub 逐字节一致**；**匿名** `releases/latest` → `v1.36.0`；三直链 range **206**（zip 前 2 字节 `504b`、`quick-install.sh` 前 2 字节 `2321`）。⚠️ 首次发布（id=5）随仓库被迁移/删除而失效，本次为**同一路径重建后的重发** |
| 源码 commit | GitHub `main` `8a3dc7ab4eb22fb7ff20e51e7513344704c0667e`（Git Database API，9 文件）→ 回填后 `8d4df617d4e74fd28071f0c55c446b867bd7aa4b`（3 文件）；自建 Gitea `main` `e2f5395875bb3adc6d71b805413385f294839afc`（重建后整仓推送，含 `73e2063` 与回填 `e2f5395`） |
| notes | 105 行 / 6,567 字符（含升级须知；本次为**单版本发布**，未合并历史段 —— `--merge-from v1.36.0` 只取本段，避免把已发布的 v1.35.11 段重复带上） |
| 发布通道 | GitHub：REST API（`gh` 探测失败自动回退，日志已注明）；Gitea：**Node `fetch` 打 REST API**（本机 curl 完全访问不了该站） |
| 发布脚本更正 | `scripts/push-gitea.sh` 改为**域名 + `-c http.sslBackend=openssl -c http.proxy= -c https.proxy=`**，并内置远端地址自愈（旧的 `http://60.205.251.18:8024` 直连**已不可用**：本机 curl `000`、git `502 upstream connect timed out`） |
| ⚠️ 本机环境差异（非服务端问题） | 本机 `curl` 访问 `git.ziruxue.top` **一律 `000`**（含 `--noproxy '*'`）；`git` 默认 schannel 后端握手失败、必须 openssl 后端 + 清空代理；Node `fetch` 走域名完全正常。另：Node 直连 `60.205.251.18:8024` 超时，故 `UPDATE_GITEA_BASE` 的 IP 形态未能端到端取证 |
| ★ 仓库迁移与重发（2026-09-30 晚） | 收尾推送时发现发布用的 `yanzi/docker-manager-yanzi` **已消失**（API / 网页 / `ls-remote` 全 404，连 v1.35.11 的 Release 也没了）；期间出现过 `admin/docker-manager-yanzi`（**private**、Release 空、`main` 停在 `4372d57`），随后也被删。用户新建 `ziruxue/docker-manager-yanzi`，但 **owner 账号 `ziruxue` 的 `visibility=private`** ⇒ Gitea 强制仓库为 `internal`，**匿名 404**（API 传 `private` / `internal` / `visibility` 均改不动）。用令牌 `POST /repos/ziruxue/docker-manager-yanzi/transfer`（`new_owner=yanzi`，**202**）转回 `yanzi` 后匿名即可读；随后用户在同一路径新建空仓库（id=8→**9**），遂**整仓重推 `e2f5395` + 重建 Release（id=7）**并全量复验 |

---

## v1.35.11 — 2026-09-29（**已出包 · 已随 v1.35.11 发布**）

**主题：`upapi` 改由 `device_uuid` 是否变化决定 —— `device_uuid` 不变就只发 `heartbeat`（**每次进程启动 / systemd restart 不再报 `install`**），只有首次安装 / 身份真的变了才 `install`。于是 `install` 计数 ≈ 去重设备数。**

### 已完成

- **规则替换**：`resolveUpapi(trigger, reportInstall)` → **`resolveUpapi(state, deviceId)`** —— 判据从「触发源 + 24h 限流」换成**身份比对**：

  | 情形 | v1.35.10 | **v1.35.11** |
  |---|---|---|
  | 首次安装（标识文件不存在 / 从未成功上报过） | `install` | `install` |
  | 重装 / tampered，**`device_uuid` 变了** | `install` | `install` |
  | 重装 / tampered，**`device_uuid` 未变** | `install` | **`heartbeat`** |
  | **每次进程启动 / systemd restart** | `install` | **`heartbeat`** |
  | 每 12 小时 | `heartbeat` | `heartbeat` |
  | 失败后 10 分钟重试 | `heartbeat` | `heartbeat` |
  | 手动「立即上报」 | `heartbeat` | `heartbeat` |
  | 上传开关 开↔关 点 APPLY | `install` | `install`（**按用户要求保留的唯一例外**） |

- **运行态新增 `lastDeviceId`**（上次**成功**上报的 `device_uuid`）：判据为 `!state.installReported || state.lastDeviceId !== info.deviceId ⇒ "install"`，否则 `"heartbeat"`。**每次成功上报都写入**（`reportOnce` 与 `reportOnToggle` 两处），避免下一次启动因「读不到上次 ID」而多补一条 `install`。
- **触发源降级为「只决定要不要强制发」**：`ReportTrigger` 类型保留（`startup` / `retry` / `manual` 强制发，`periodic` 不强制），**不再参与 `upapi` 取值**；`needInstall` 改为由 `upapi` 反推（install 必发）。
- **24h 限流退化为观测标记**：`reportInstall` / `lastRebuildAt` 仍照常写盘、仍打 `[telemetry] …不足 24 小时…` 告警，但**不再影响 `upapi`**。理由：旧限流防的是「同机反复改写标识文件刷高安装量」，而现在**硬件没变 ⇒ `deviceId` 没变 ⇒ `heartbeat`**，由身份判据天然覆盖。
- **升级兼容**：从 ≤ v1.35.10 升级上来时运行态没有 `lastDeviceId` ⇒ 无法证明「ID 未变」⇒ **保守补发一次 `install`**，写入后回归正常（一次性）。`migrateLegacyState` 顺手把标识文件里的 `deviceId` 迁成 `lastDeviceId`，能迁移的存量部署可免这一次补发。
- **涉及文件**：客户端 `server/telemetry.ts`、`docs/上报触发与接口及上报内容.md`、`docs/CHANGELOG.md`、`package.json`。**服务端 `yanzi/api` 与 `server/index.ts` 均无需改动**（载荷字段集合与 v1.35.9/v1.35.10 完全一致 —— 仍是 15 个顶层字段）。
- **验证**（全部通过）：
  1. 前后端 `tsc` 双 `exit 0`；
  2. `npm run test:gates` **exit 0**（hooks 44 + auth 24/0 & 29/0 + restart 18/0 + thermal 15/0 + install 34/0，五组 `结果: PASS=` 齐全）；
  3. 删 `dist/` 重跑 `vite build` ⇒ 新资产 `assets/index-CDpmlpm-.js`（1,085,357 B / SHA `21d620df…`，js 内 `"1.35.11"`×1、`"1.35.10"`/`"1.35.9"`×0）、`index-D4ubT5WG.css`（47,237 B / `57986964…` 未变）、`index.html`（482 B / `28d75477…`）；
  4. **源码级身份判据 harness 29/0**（临时 harness 直驱 `server/telemetry.ts`，桩 `fetch` + 临时 `CONFIG_DIR`）：① 首次安装 ⇒ install（且写入 `lastDeviceId`）② **同 ID 重启 ⇒ heartbeat**（本次核心反转点）③ periodic ⇒ heartbeat ④ retry(500) ⇒ heartbeat + `fatal=false` ⑤ manual ⇒ heartbeat ⑥⑦ 开关开/关 ⇒ install（`uploadEnabled` true/false）⑧ 伪造 `lastDeviceId ≠ 当前` ⇒ install 并写回 ⑨ 复原 ⇒ heartbeat ⑩ 覆写 `device.info` 判 tampered、重建后 `deviceId` 不变 ⇒ heartbeat（并命中 24h 限流告警分支）⑪ 有 `installReported` 无 `lastDeviceId` ⇒ 补发一次 install、其后回归 heartbeat ⑫ 未到期 + ID 未变 ⇒ `upapi=null` 且零请求 ⑬ 开关关闭 ⇒ 零请求 + `fatal=true`；
  5. **真包端到端冒烟 22/0**（起真实 `deploy/linux/bundle.js` 两轮 + 本机抓包服务）：`GET /api/system/version` = **1.35.11**、asset **逐字节一致**（1,085,357 B / SHA 全等）、缓存头正确、首次安装首报 `install`（15 字段）、手动上报 `heartbeat`、开关关/开各 1 条 `install`；**阶段 B 复用同一 `CONFIG_DIR` 重启（＝systemd restart）⇒ 首报 `heartbeat` 且 `device_uuid` 与首次安装相同**。捕获到的 `upapi` 序列 = `["install","heartbeat","install","install","heartbeat"]`。

### 未完成 / 已知限制

- **开关切换仍发 `install`**（用户明确选择保留）：若统计端要严格以「`install` = 新设备」，需用载荷里的 `uploadEnabled` 字段把这一类排除。
- **内核升级会导致 `install`**：`device_uuid` 含 `os.release()` 维度，内核升级使 `system` 维度变化 ⇒ ID 变化 ⇒ 报一次 `install`（属既有指纹缺陷 §6.3，本次未处理）。
- 上报端点仍 NXDOMAIN，无法端到端联调，仅验证报文发出。
- 中心统计服务端由独立后端实现，本项目不做（暂缓）。

### 下一步

- ✅ 已发布 v1.35.11（2026-09-30）：源码推 GitHub `main`（`7ec0a17894`）+ 自建 Gitea（`e4a940f`）；Release [v1.35.11](https://github.com/yanziruxue/docker-manager/releases/tag/v1.35.11) 已建、3 个资产均 `uploaded`、三个直链 200。
- 发布顺序不变：**先服务端 `yanzi/api`（执行前备份 `api/data/yanzi-admin.db`）→ 再发客户端**。
- 若统计端要严格「`install` = 新设备」，需按载荷 `uploadEnabled` 字段排除「开关切换」这一类 `install`。

### 交付包

- `build-upload/docker-manager-yanzi-linux-x64-v1.35.11.zip` —— **43,032,814 B** / SHA-256 `bfbd557e71ec60c148c6ca068d85f87832f2851db29346e3003ebcf50ffe21ad`（内嵌二进制 **130,092,224 B** / SHA-256 `d68f4ef38cf9db70b335936609f6d9c1ffbbf829832f4cd812ddd68e6d22752e`，ELF `7f454c46` 已校验、`CURRENT_VERSION = true ? "1.35.11" : "0.0.0-dev"`、含 `resolveUpapi` 与 `lastDeviceId`）+ 无版本号 `latest` 别名（`build-upload/docker-manager-yanzi-linux-x64.zip`）同字节。包成员 5 个（二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`）。前端内嵌资产 `assets/index-CDpmlpm-.js`（1,085,357 B）。**v1.35.10 的包（`7b6f8035…`）自本版起作废并已删除。**

### 发布记录（2026-09-30）

| 项 | 值 |
|---|---|
| Tag / Release | [v1.35.11](https://github.com/yanziruxue/docker-manager/releases/tag/v1.35.11)（`draft=false` / `prerelease=false`） |
| 源码 commit（GitHub `main`） | `7ec0a17894e84dae7f83b58685caa6a7433fa654`（基线 `db1efa4819`，30 文件，Git Database API 推送） |
| 自建 Gitea 镜像 | `yanzi/docker-manager-yanzi` @ `e4a940f277239343d619cf5e59c0a5504b343d1c` |
| 合并区间 | `v1.32.0 → v1.35.11`，共 **15** 个开发版本段 |
| notes | 613 行 / 45,902 字符（`--merge-from v1.32.0 --intro-file`） |
| 资产 | `docker-manager-yanzi-linux-x64-v1.35.11.zip`（43,032,814 B）、`docker-manager-yanzi-linux-x64.zip`（同字节）、`quick-install.sh`（9,371 B） |
| 发布通道 | GitHub REST API |
| OTA 核验 | `releases/latest` = v1.35.11；三个直链均 **HTTP 200** |
---

## v1.35.10 — 2026-09-29（已出包 · 已随 v1.35.11 发布 · **包已被 v1.35.11 取代**）

**主题：上报类型 `upapi` 改为「按触发源决定」—— 启动 / 安装 / 重装 / 开关切换 ⇒ `install`，12 小时周期 / 失败重试 / 手动 ⇒ `heartbeat`；`needInstall` 退化为「只决定要不要发」。**

### 已完成

- **背景（现象与根因）**：用户观察到「每次进程启动 / systemd restart 都是 `install`」。定位为**非 bug，而是闩锁语义 + 端点不可达的必然结果**：旧代码 `upapi = needInstall ? "install" : "heartbeat"`，而 `needInstall = reportInstall || !state.installReported`；`installReported` **只在 2xx 成功时置位**，端点（`yanzi-api.ziruxue.top`）当前 NXDOMAIN ⇒ 永远置不上 ⇒ **所有**触发都退化成 `install`（真包 + 桩远端双向复现：500 ⇒ 每次都是 `install`；200 ⇒ 首报 `install`、其后 `heartbeat`）。
- **改造：`upapi` 由触发源决定（客户端 `server/telemetry.ts`）**：
  - 新增 `export type ReportTrigger = "startup" | "periodic" | "retry" | "manual"`；
  - 新增唯一判据 `resolveUpapi(trigger, reportInstall): TelemetryEvent` —— `trigger === "startup" || reportInstall` ⇒ `"install"`，否则 `"heartbeat"`；
  - `reportOnce(force = false)` → **`reportOnce(trigger: ReportTrigger)`**；内部 `force = trigger !== "periodic"`（启动 / 重试 / 手动强制发送，周期不强制）；
  - `needInstall` **保留但只用于 `shouldSend`**（保证从未成功上报过的设备仍持续尝试），**不再影响取值**；
  - `scheduleNext(delayMs, force)` → **`scheduleNext(delayMs, trigger)`**；重试传 `"retry"`、正常周期传 `"periodic"`；
  - `startTelemetryHeartbeat()` → `scheduleNext(FIRST_REPORT_DELAY_MS, "startup")`（启动首报恒 `install`）；
  - `reportOnToggle(enabled)` → `upapi` **恒为 `"install"`**（不再读 `installReported`）。
- **触发源 ⇒ `upapi` 对照表（最终交付语义）**：

  | 场景 | `upapi` |
  |---|---|
  | 首次安装（标识文件不存在） | `install` |
  | 重装 / 标识文件被判 tampered（`btime ≠ mtime`，24h 限流） | `install`（限流窗口内且非 `startup` 触发时退化为 `heartbeat`） |
  | 每次进程启动 / systemd restart | `install` |
  | 每 12 小时 | `heartbeat` |
  | 网络 / 5xx 失败后 10 分钟 | `heartbeat` |
  | 上传开关 开↔关 点 APPLY | `install` |

- **手动接口（`server/index.ts`）**：`POST /api/telemetry/report` 由 `reportOnce(true)` 改为 **`reportOnce("manual")`**（强制发送、`upapi` = `heartbeat`）。
- **文档同步（`docs/上报触发与接口及上报内容.md`）**：§0 速览「上报类型」、§2.1 完整时机表（8 行全量重写：新增行为列 + `startup`/`periodic`/`retry` 触发源标注 + v1.35.10 说明块）、§2.2 事件选择规则（代码块 + 对照表 + 「`needInstall` 只管要不要发」）、§2.4 调度链（`reportOnce(trigger)` / `scheduleNext(…, "startup"/"retry"/"periodic")`）、§3.3 开关切换（恒 `install`）、§5.1 `TelemetryStatus.installReported` 与载荷 `upapi` 行、§7.3 限流与 `resolveUpapi` 关系、§7.5 `installReported` 语义、§9.1 判读提示、§9.2「每次重启都报 install ⇒ ✅ 设计如此」、§10 新增两行（语义明确 / 安装量语义变化）、附录 A 时序 ①③④⑤、页脚版本注。
- **涉及文件**：`server/telemetry.ts`、`server/index.ts`、`docs/上报触发与接口及上报内容.md`、`docs/CHANGELOG.md`、`package.json`。
- **验证**（全部通过）：
  1. 前后端 `tsc` 双 `exit 0`；
  2. `npm run test:gates` **exit 0**（hooks 44 + auth 24/0 & 29/0 + restart 18/0 + thermal 15/0 + install **34/0**）；
  3. 删 `dist/` 重跑 `vite build` ⇒ 新资产 `assets/index-qKFpBsAY.js`（1,085,357 B / SHA `cafc070f…`，js 内 `"1.35.10"`×1、`"1.35.9"`/`"1.35.8"`×0）、`index-D4ubT5WG.css`（47,237 B / `57986964…` 未变）、`index.html`（482 B / `de772d01…`）；
  4. **源码级触发源取证 25/0**（临时 harness 直驱 `server/telemetry.ts`，桩 `fetch`）：① 首次安装+startup ⇒ install ② 重启+startup ⇒ install ③ periodic ⇒ heartbeat ④ retry(500) ⇒ heartbeat ⑤ manual ⇒ heartbeat ⑥⑦ 开关开/关 ⇒ install ⑧ tampered 超 24h 限流 ⇒ install ⑨ tampered 限流内(periodic) ⇒ heartbeat ⑩ tampered 限流内(startup) ⇒ install ⑪ periodic 未到期 ⇒ 零请求 ⑫ 开关关闭 ⇒ 零请求 + `fatal:true`；
  5. **真包端到端冒烟 29/0**（起真实 `deploy/linux/bundle.js` + 本机抓包服务）：`GET /api/system/version` = **1.35.10**、首页引用 js 名与 `dist/` 一致、asset **逐字节一致**（1,085,357 B / SHA 全等）、缓存头 `/` = `no-cache, must-revalidate` 与 `/assets/*` = `public, max-age=3600` 正确、启动首报 `upapi:"install"`（**15 个顶层字段**、无 `hw_fingerprint`/`event`/`install`、`X-Telemetry-Key` = `device_uuid`）、`POST /api/telemetry/report` ⇒ `heartbeat`、开关关/开 ⇒ 各 1 条 `install`（`uploadEnabled` false/true）；
  6. **真包 phase 2 取证 5/0**：改写 `device.info`（`mtime − btime > 2s`）后重启真实 bundle ⇒ 日志命中「距上次重建不足 24 小时」限流分支，且启动首报仍为 `upapi:"install"` ⊢ 证实「`startup` 优先于 24h 限流」这条设计例外。

### 未完成 / 已知限制

- **服务端 `yanzi/api` 无需改动**：本次只改客户端取值逻辑，载荷字段集合（15 个顶层字段）与 v1.35.9 完全一致，服务端 `resolveEvent` 的 `install` / `heartbeat` 分支不变。
- **安装量语义变化（需服务端知悉）**：同一设备**每次重启都会收到一条 `upapi:"install"`**；不能再依赖「同一 `device_uuid` 只应出现一次 `install`」去重，应改为 **`device_uuid` upsert + 比对 `installedAt`**（标识文件创建时间）。
- **限流例外**：标识文件在 24 小时限流窗口内被改写时，非 `startup` 触发报 `heartbeat`（防安装量被反复改写刷高）；`startup` 触发不受此限。
- 上报端点仍 NXDOMAIN，无法端到端联调，仅验证报文发出。
- 中心统计服务端由独立后端实现，本项目不做（暂缓）。

### 下一步

- 发布 v1.35.10：先推源码，再建 GitHub Release（`--merge-from <上一已发布 TAG>`）。
- 发布顺序不变：**先服务端 `yanzi/api`（执行前备份 `api/data/yanzi-admin.db`）→ 再发客户端**。
- 服务端如需区分「真正的首次安装」，请以 `device_uuid` upsert + 比对 `installedAt` 为准（本版起每次重启都会收到一条 `install`）。

### 交付包

- `build-upload/docker-manager-yanzi-linux-x64-v1.35.10.zip` —— **43,032,780 B** / SHA-256 `7b6f80359a0d3af194908e9dfbf80c5bddc746f6a5442633c35a4b397884eeb7`（内嵌二进制 **130,092,224 B** / SHA-256 `e4284a6a15e0e48a8a9630dc29d326c4ecd99f209975e5cc27b6ad39a0c20b62`，ELF `7f454c46` 已校验、`CURRENT_VERSION = true ? "1.35.10" : "0.0.0-dev"`、含 `resolveUpapi`）+ 无版本号 `latest` 别名（`build-upload/docker-manager-yanzi-linux-x64.zip`）同字节。包成员 5 个（二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`）。前端内嵌资产 `assets/index-qKFpBsAY.js`（1,085,357 B）。**v1.35.9 的包（`0571cb86…`）自本版起作废并已删除。**

---

## v1.35.9 — 2026-09-29（**已出包 · 已随 v1.35.11 发布**）

**主题：上报字段收敛 —— 把「常量 `event` + 布尔 `install`」两个冗余字段合并为单字段 `upapi`；跨两仓删除失效的 `hw_fingerprint` 列；修掉「关闭上传开关后每 10 分钟空转」。**

### 已完成

- **载荷模型收敛为单字段（客户端 `server/telemetry.ts`，16 处）**：上报类型由「始终为常量 `"report"` 的 `event` 字段 + 布尔 `install` 字段」两个字段，**合并为一个字段 `upapi: "install" | "heartbeat"`**——信息量严格等价（`install` ⇔ 覆盖快照、刷新安装时间；`heartbeat` ⇔ 纯心跳、只刷在线）。类型 `TelemetryEvent` 由 `"report"` 改为 `"install" | "heartbeat"`；`buildPayload()` 删 `hw_fingerprint` / `event` / `install`，改为单行 `upapi`；`sendReport()` / `reportOnce()` / `reportOnToggle()` 签名与内部统一用 `upapi`，取值 `needInstall ? "install" : "heartbeat"`。
- **运行态字段合并**：`lastReportAt` / `lastActiveAt` 合并为**单一 `lastReportAt`**（原两者恒同值）。`readState()` 兼容读旧文件（`raw.lastReportAt ?? raw.lastActiveAt`），旧运行态不丢；`dueForActive` 重命名 `dueForPeriodic`；`getTelemetryStatus()` 与前端 `TelemetryStatus`（`src/api.ts`）同步删 `lastActiveAt`。
- **`hw_fingerprint` 彻底删除（跨客户端 + 服务端两仓）**：该列是早期辅标识，主键改为 6 维硬件指纹后与 `device_uuid` **恒同值**、服务端只 `str()` 保存、不参与任何判定（真风控靠 `device_key` + `key_mismatch`），后台也只在两者不等时渲染 ⇒ 已是死列。客户端载荷不再发送；服务端 `yanzi/api` 在 `db.js` 建表语句、`telemetry.js` 归一/行映射/upsert、`routes.js`、`migrate-json-to-sqlite.mjs`、`check-live-schema.mjs` 全部移除；`backstage/src/app.js` 删「硬件指纹（客户端另报）」整行。**存量 DB 用幂等 `ALTER TABLE telemetry_devices DROP COLUMN hw_fingerprint` 迁移**（需 SQLite ≥ 3.35，Node 内置 `node:sqlite` 自带 3.46+），放在 `migrateTelemetryColumns()` 里，已删除则跳过。
- **服务端三代兼容归一（`yanzi/api/src/telemetry.js` 的 `resolveEvent` 是唯一接线点）**：取值来源 `body.event || body.upapi`（同时出现以 `event` 为准）。`install` → 安装；`active` / `heartbeat` → 心跳；`report` → 看 `body.install === true`；其余非法（400）。四种历史类型名统一折成 `isInstall` 布尔，下游 `handleInstall` / `handleActive` 语义不变。`routes.js` 同步取值与 400 文案。
- **修掉「关闭上传开关后每 10 分钟空转」**：`reportOnce()` 在 `!cfg.enabled` 时返回 `{ error: "上传已关闭", fatal: true }`，被调度器识别为**不可重试**，直接退回 12 小时周期（原先被判为可重试 ⇒ 每 10 分钟空转重试）。
- **文档与回归同步**：`docs/上报触发与接口及上报内容.md`（35 处）/ `docs/上报.json`（**改为用新构建的 bundle 真实抓包刷新**：本机起抓包服务 + `TELEMETRY_ENDPOINT` 指向它，捕获到 `POST /api/yanzi-docker/event`、头 `X-Telemetry-Key: <deviceId>`、体 `upapi:"install"` 共 **15 个顶层字段**，确认无 `event` / `install` / `hw_fingerprint`）；服务端 `README.md`（5 处）+ `yanzi/docs/api-yanzi-docker-event.md`（12 处）+ `backstage/src/docs.md`；`scripts/verify-telemetry.mjs` 新增 8 条 `upapi` 用例（含 `event` 优先、`upapi` trim、未知值）+ 接线检查改 `/body\.event\s*\|\|\s*body\.upapi/` + ⑦ 新增删列幂等断言（加回列 → 重启 → 自动 `DROP` 且不丢数据）。
- **修正文档字段计数错误**：`docs/上报触发与接口及上报内容.md` §5 原写「16 个顶层字段」（v1.35.8 应为 17 → 本次 15），实测抓包为 **15**，已改为 15 并补算式 `17 − 1（hw_fingerprint） − 2（event + install） + 1（upapi） = 15`。
- **涉及文件**：客户端 `server/telemetry.ts`、`src/api.ts`、`docs/上报触发与接口及上报内容.md`、`docs/上报.json`、`package.json`；服务端 `yanzi/api/src/{telemetry,db,routes}.js`、`yanzi/api/scripts/*`、`yanzi/api/README.md`、`yanzi/backstage/src/app.js`、`yanzi/backstage/src/docs.md`、`yanzi/backstage/README.md`、`yanzi/docs/api-yanzi-docker-event.md`。
- **验证**：① 服务端回归 `scripts/verify-telemetry.mjs` **78/0**（日志确认 `DROP COLUMN` 真执行）；② 客户端前后端 `tsc` 双 `exit 0`；③ `npm run test:gates` **exit 0**（hooks 44 + auth 24/0 & 29/0 + restart 18/0 + thermal 15/0 + install 34/0）；④ 删 `dist/` 重跑 `vite build` ⇒ 新资产 `assets/index-d-CniirZ.js`（1,085,356 B，js 内 `"1.35.9"`×1 / `"1.35.8"`×0）。

### 未完成 / 已知限制

- **服务端 `yanzi/api` 尚未部署到 ECS1**（沿用历史状态；且必须**先于客户端**部署，见「部署注意」）。
- 上报端点 `https://yanzi-api.ziruxue.top/api/yanzi-docker/event` 仍 **NXDOMAIN**，无法端到端联调，仅验证报文发出。
- 中心统计服务端由独立后端实现，本项目不做（暂缓）。

### 下一步

- 先部署服务端 `yanzi/api`（含 DB 迁移，执行前备份 `api/data/yanzi-admin.db`），再发客户端 v1.35.9。
- 真包冒烟：`GET /api/system/version` = `1.35.9`、载荷 `upapi:"install"` 落地、旧运行态 `lastActiveAt` 迁移不丢、`hw_fingerprint` 不再出现。

> **⚠️ 部署顺序铁律**：ECS1 现役服务端**只认 `event: install|active`**，不认 `upapi` / `heartbeat` / `report`；而 400 在客户端被判为**非致命**（仅 401/403 触发 fatal）⇒ **新版客户端先上会每 10 分钟无限重试**。**务必服务端先上。**

### 交付包

- `build-upload/docker-manager-yanzi-linux-x64-v1.35.9.zip` —— **43,032,672 B** / SHA-256 `0571cb86933268523c26bf909f4d252dee17ef6617a0e976d569949473df36d1`（内嵌二进制 **130,092,224 B** / SHA-256 `cc320b778a0a975e46a569acf68a8fded3694f43b6b18b18ef27c23379a864ee`，ELF `7f454c46` 已校验、`CURRENT_VERSION = "1.35.9"`；包成员 5 个：二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`）+ 无版本号 `latest` 别名（`build-upload/docker-manager-yanzi-linux-x64.zip`）同字节。前端内嵌资产 `assets/index-d-CniirZ.js`（1,085,356 B）。
- **真包冒烟**：起 `bundle.js`（临时 DATA/CONFIG/LOG 目录）→ `POST /api/auth/init` + `/login` → `GET /api/system/version` = **1.35.9**；`GET /` 引用 `assets/index-d-CniirZ.js`，服务端返回该 asset **1,085,356 B 与本地 `dist/` 逐字节一致**；缓存头 `/` = `no-cache, must-revalidate`、`/assets/*` = `public, max-age=3600`；bundle 内 `upapi` ✔ / `hw_fingerprint` ✘（已删净）/ `lastActiveAt` ✔（兼容读）/ `上传已关闭` ✔（fatal 分支）。

---

## v1.35.8 — 2026-09-29（已出包 · 已随 v1.35.11 发布）

> **版本号说明**：本版由 **v1.35.7 升号**而来（约定「**每次出包都升版本号**」）。v1.35.7 **从未发布**，其两次出包（首版 `951a7420…` 43,030,942 B、重出 `61b721df…` 43,032,580 B）**均已作废** —— 重出时已含 `install.sh` 的 drivetemp 改动与前端提示条文案，语义上就是 v1.35.8。

**主题：温度能力落地 —— ① 仪表盘磁盘卡片显示温度、「利用率」列去掉进度条；② 设置页新增「温度」卡片（CPU + 各盘 + `drivetemp` 检测），原「本机设备」页更名「硬件信息」；③ **安装脚本（`install.sh`）自动加载 `drivetemp` 并持久化**，装完即有 SATA/HDD 温度。按用户要求不做 S.M.A.R.T.。**

### 已完成

- **后端新增 `readDiskTempC()`**（`server/docker.ts`）：读整盘温度，**不需要 root**（hwmon 文件是 0444 世界可读）。三档路径探测：① `/sys/block/<dev>/device/hwmon/hwmonN/temp1_input`（drivetemp / nvme 常见形态）② `/sys/block/<dev>/hwmon/hwmonN/temp1_input`（少数 mmc / 虚拟盘）③ NVMe 控制器 `/sys/class/nvme/<ctrl>/hwmonN/temp1_input`（`nvme0n1 → nvme0`）。毫摄氏度 ÷1000 四舍五入；读不到（无传感器 / 缺 `drivetemp` 模块 / 非 Linux）返回 `null`。
- `DiskStat` 新增 `tempC: number | null`（后端 `server/docker.ts` + 前端 `src/types.ts` 同步），`sampleHostDisks()` 填充。
- **磁盘卡片新增「温度」列**（`src/pages/Dashboard.tsx` `DiskTile`）：列序 = 设备 / 文件系统 / **温度** / 状态 / 读写速率 / 利用率；阈值配色 `tempTextColor()`（≥60℃ 红加粗、≥50℃ 琥珀、其余常规）；`null` 显示「—」（`title` 提示「无温度传感器，或 SATA 盘未加载 drivetemp 内核模块」）。
- 删除原占位说明「温度 / S.M.A.R.T. 需 root（smartctl），当前版本未提供」——温度已提供，且**不做 S.M.A.R.T.**，不再保留该提示。
- 表格 `min-w-[520px]` → `min-w-[600px]`（多一列）。
- **磁盘「利用率」列去掉进度条**（`DiskTile`，用户要求）：该列只保留百分比数值（`{d.busyPct}%`），删掉 `<Bar>` 与其 `w-[200px]` 固定列宽；表格宽度由 `min-w-[600px]` 回调为 `min-w-[520px]`，**表内不再有任何 `<div>`**（`Bar` 的 DOM 已清零）。

- **设置页新增「温度」卡片**（`src/components/ActivityPanel.tsx`，用户要求「显示硬盘温度 + CPU 温度，同时检测 drivetemp」）：① CPU 温度一行（`coretemp` / `k10temp` 等芯片名 + 温度值，读不到显示「—」+「无传感器」）；② 各整盘温度逐行列出（`fmtTemp` + `tempTextColor`，`null` →「—」）；③ **`drivetemp` 检测提示**——仅当 `!drivetempLoaded && sataWithoutTemp.length > 0`（缺温度的 **SATA** 盘非空且模块未加载）时出现琥珀色提示条，写明缺温度的盘名 + 一条可直接复制的加载命令（`echo drivetemp | sudo tee /etc/modules-load.d/drivetemp.conf && sudo modprobe drivetemp`，含持久化、免重启说明）；NVMe 盘自带 hwmon，故 NVMe-only 机器**不会**看到该提示。
- **后端新增 CPU 温度与整机温度快照**（`server/docker.ts`，全部读 sysfs、**零提权**）：`readCpuTempC()` 遍历 `/sys/class/hwmon` 匹配 `coretemp` > `k10temp` > `zenpower` > `cpu_thermal`（优先级固定，不受目录遍历顺序影响），读 `temp1_input` 并附带 `temp1_label`（如 `k10temp Tctl`）；匹配不到时回退 `/sys/class/thermal` 的 `x86_pkg_temp`。`listWholeDisks()` 复用 `DISK_WHOLE` 正则列整盘（过滤分区 / `loop` / `dm` / `md`）。`isDrivetempLoaded()` 先看 `/sys/module/drivetemp`，再看 hwmon 芯片名是否 `drivetemp`。对外暴露 `getThermalStatus(): ThermalStatus`（`{ cpu, disks, drivetempLoaded, sataWithoutTemp }`）。
- **新增本机接口 `GET /api/system/thermal`**（`server/index.ts`，落在 `/api` 鉴权守卫内）；前端 `src/api.ts` 增加 `ThermalStatus` 类型与 `fetchThermalStatus()`。
- **抽出共享温度工具 `src/lib/thermal.ts`**（`tempTextColor` / `fmtTemp`）：磁盘卡片与设置页温度卡片**共用同一套阈值配色与「—」口径**，避免两处各写一份漂移；`Dashboard.tsx` 内联的那份已删除、改为 import。
- **「本机设备」更名「硬件信息」**（用户要求）：设置页左侧 tab `src/pages/Settings.tsx` 的 label 与面板标题 `<h2>`、卡片标题「本机设备标识」→「硬件信息标识」；`src/types.ts` / `server/settings.ts` / `server/telemetry.ts` / `server/unit-status.ts` / `server/index.ts` 中所有指向该页的注释文案同步改写（**仅改页面名，指「本机设备标识（硬件指纹）」这一语义的文案保留**）。
- **新增温度采集门禁 `scripts/check-thermal.mjs`**（接入 `npm run test:gates`）：本仓库在 Windows 开发，没有 `/sys` 也没有 root，温度采集逻辑原本**完全无法验证**（改坏了只会「界面显示 —」，静默失败）。该门禁从 `server/docker.ts` 抽出真实函数体，用 `Object.create(fs)` 造**影子 fs** 注入 vm 的 `require`（**不改真实 fs 模块**），在内存里构造虚拟 sysfs 树跑真身代码，**15 项断言**覆盖：coretemp / k10temp+label / 芯片优先级 / thermal zone 回退 / 无传感器 / NVMe 路径 / SATA+drivetemp 路径 / drivetemp 两种判定 / 完整快照 / 分区与 loop 过滤 / 空 sysfs 不抛异常。
- **安装脚本自动加载 `drivetemp` 内核模块**（`deploy/linux/install.sh`，用户要求「安装时自动执行」）：新增「配置磁盘温度传感器（drivetemp）」段（第 178–224 行），等价于用户手动执行 `echo drivetemp | sudo tee /etc/modules-load.d/drivetemp.conf && sudo modprobe drivetemp`。① `modprobe drivetemp` **立即加载**（免重启即有温度）；② 写 `/etc/modules-load.d/drivetemp.conf`（首行为归属标记注释）⇒ systemd **开机自动加载**；③ 新增 `--no-drivetemp` / `--skip-drivetemp` 开关跳过该段。★ **尽力而为、绝不阻塞安装**：内核未编 `drivetemp` / 已编入内核（`modinfo` 失败）、无 `modprobe`、`modprobe` 失败、非 systemd（无 `systemctl` 且无 `/etc/modules-load.d`）四种情形**一律只告警不退出**（`set -euo pipefail` 下每个可能失败的调用都显式判返回值），任一环境都必须 `exit 0`。
- **卸载脚本按归属清理**（`deploy/linux/uninstall.sh`）：仅当 `/etc/modules-load.d/drivetemp.conf` 含本应用归属标记（`grep -q "^# ${APP_NAME}:"`）才 `rm -f` —— **用户自建的 conf 不动**；也**不主动 `modprobe -r drivetemp`**（别的盘可能正用）。
- `deploy/linux/README.md`：安装步骤插入「2. **配置磁盘温度传感器**」并顺延其余步骤；可选参数表新增 `--no-drivetemp`。
- **前端提示条文案对齐**（`src/components/ActivityPanel.tsx`）：`drivetemp` 提示条改为「**安装脚本（install.sh）会自动加载**；在线升级不更新安装脚本，老部署可手动执行下面这条命令（无需重启）」——避免对新装用户给出无意义的指导。
- **新增安装脚本门禁 `scripts/check-install-drivetemp.sh`**（新增 `npm run test:install` 并纳入 `test:gates`）：`install.sh` 要 root + systemd 才能真跑，Windows 开发机**无法执行**，改坏只在用户机器上暴露。该门禁从 `install.sh` / `uninstall.sh` **按注释锚点抽出真实代码块**（不是复制一份，避免与实现漂移），把 `/etc/modules-load.d` 改写到工作区沙箱，用桩命令（`modinfo` / `modprobe` / `systemctl`）驱动 **7 种环境** ⇒ **34 项断言**，核心不变量是「**绝不阻塞安装**」。

涉及文件：`server/docker.ts`、`server/index.ts`、`server/settings.ts`、`server/telemetry.ts`、`server/unit-status.ts`、`src/types.ts`、`src/api.ts`、`src/lib/thermal.ts`（新增）、`src/components/ActivityPanel.tsx`、`src/pages/Dashboard.tsx`、`src/pages/Settings.tsx`、`scripts/check-thermal.mjs`（新增）、`scripts/check-install-drivetemp.sh`（新增）、`deploy/linux/install.sh`、`deploy/linux/uninstall.sh`、`deploy/linux/README.md`、`package.json`（version → 1.35.8、新增 `test:thermal` / `test:install` 并入 `test:gates`）。

### 验证

- `scripts/check-hooks.mjs` PASS（44 文件）+ 前后端 `tsc` 双 `exit 0` + `vite build` PASS + `test:gates` 全绿（hooks 44 + auth 24/0 & 29/0 + restart 18/0 + **thermal 15/0**）。
- **温度采集门禁 `scripts/check-thermal.mjs` 15/15 PASS**（跑的是 `server/docker.ts` 的真实函数体，只把 fs 换成虚拟 sysfs 树）：coretemp `47000m→47`、k10temp+`Tctl` label `61500m→62`、芯片优先级（`coretemp` 压过 `k10temp`，与目录顺序无关）、thermal zone 回退 `52000m→52`、无传感器→`null`、NVMe `38500m→39`、SATA+drivetemp `41300m→41`、drivetemp 两种判定、完整快照（`sdb` 缺温度 → `sataWithoutTemp:["sdb"]`）、分区/`loop`/`dm` 被过滤、空 sysfs 返回空结构且不抛异常。
- **该门禁的负向自检**：把 `server/docker.ts` 里的 `Math.round(milli / 1000)`（3 处）改成 `/ 100` ⇒ **PASS 15→7、FAIL=8、进程 `exit 1`**；`cp` 还原后 `cmp` 逐字节一致 ⇒ 再跑回 **15/0、`exit 0`**。证明门禁不是「永远为真」的摆设。
- **安装脚本门禁 `scripts/check-install-drivetemp.sh` 34/34 PASS**（跑的是 `install.sh` / `uninstall.sh` 里抽出的**真实代码块**）：默认（模块可用）→ `modprobe` 调用 1 次 + 写 conf（含 `drivetemp` 行与归属标记）；`--no-drivetemp` → 不改 conf 也不探测（`modinfo` 0 次）；`modinfo` 失败（内核未编 / 已内置）→ 不写 conf、不调 `modprobe`、**`exit 0`**；`modprobe` 失败 → 仍写 conf（重启后还有机会）+ **`exit 0`**；非 systemd → 不写多余文件、`modprobe` 仍被调用、**`exit 0`**；无 `modprobe` → 仍写 conf、打印「未找到 modprobe」、**`exit 0`**。卸载侧：带归属标记的 conf 删除、**用户自建的 conf（无标记）保留**。
- **该门禁的负向自检**：给「模块不可用」分支注入 `; exit 7`（模拟「温度功能导致安装中断」这一最危险的回归）⇒ **PASS 34→33、FAIL=1、进程 `exit 1`**；确定性反替换还原（`grep -n "exit 7"` 无命中、该行与原文逐字一致）后 ⇒ 回到 **34/0、`exit 0`**。
- **agent-browser 组件级实测**（临时 `tmp-preview-temp.html` + `src/__preview_temp_main.tsx` 渲染 `Dashboard` + fetch 桩，验完即删）：
  - 表头 = `设备 / 文件系统 / 温度 / 状态 / 读写速率 / 利用率`；
  - 行值：sda `37 °C`（`text-slate-600`）、sdb `51 °C`（`text-amber-600`）、nvme0n1 `62 °C`（`text-red-600 font-semibold`）、mmcblk0 `—`（`text-slate-400`）；
  - 页面文本**不再包含 `S.M.A.R.T`**；截图与断言一致；控制台**无报错**。
  - **利用率列去进度条断言**（同一次实测）：四行利用率单元格 `utilChildElements = 0`、`utilHasDiv = 0`，且 `divsInsideDiskTable = 0` ⇒ **进度条已彻底移除**，仅剩 `3.1% / 0% / 12.3% / 0%` 文本。
- **设置页「温度」卡片 + 改名：agent-browser 组件级实测三场景**（临时 `tmp-preview-thermal.html` + `src/__preview_thermal.tsx` 渲染 `ActivityPanel` + fetch 桩，验完即删）：面板 `h2` = **`硬件信息`**、两张卡片标题 = **`温度` / `硬件信息标识`**、`svg.lucide-thermometer` 存在、**页面文本不含「本机设备」**（改名生效）。三场景断言：
  - `?s=nodrv`（sdb 无温度 + drivetemp 未加载）：CPU `47 °C`（`rgb(71,85,105)` 常规色）+「传感器 coretemp」；磁盘 `nvme0n1 40 °C` / `sda 41 °C` / `sdb —`；**提示条恰好 1 条**（文案含「检测到 1 块 SATA 盘没有温度」「drivetemp」）+「复制加载命令」按钮存在；
  - `?s=ok`（drivetemp 已加载、CPU 62℃）：CPU `62 °C` 且 `color = rgb(220, 38, 38)`、`font-weight = 600`（**红加粗阈值分支命中**）；**提示条 0 条** ⇒ 证明提示条件是「未加载 且 缺温度 SATA 盘非空」的**与**关系，而非只看 `sataWithoutTemp`；
  - `?s=empty`（无任何传感器 / 远程引擎）：CPU 显示「—」+「无传感器」、磁盘显示「未检测到整盘设备」、无提示条、`disks` 为空。
  - 三次均**无 console error**；截图与断言一致。

### 交付包

| 项 | 值 |
|---|---|
| zip | `build-upload/docker-manager-yanzi-linux-x64-v1.35.8.zip` — **43,032,727 B** / SHA-256 `d2f5216362d8c75c73e1bccdadc7205b10e54a4cee512f9ef9b80f6f4ab6bd06`（5 成员：二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`；`make-package.py` 复验权限位 `0755/0755/0755/0644/0644`；另存无版本号别名 `docker-manager-yanzi-linux-x64.zip`，**同字节同哈希**） |
| 二进制 | **130,092,224 B** / SHA-256 `3800a5d064e69181db122c4f29f014f4a548cd56b5b34a6adab470995ae3d33a`；ELF magic `7f 45 4c 46` 已校验 |
| 构建 | Windows 交叉构建：`bundle.js` 5,132,564 B（已读入 4 个前端文件 + 嵌入 `.service` 模板 1,985 B）→ `sea-prep.blob` 5,363,465 B → 复制 Linux node v22.22.2（124,679,552 B）为 base → `postject` 注入（`💉 Injection done!`）→ `make-package.py` 打 zip |
| 硬证据 ① | `bundle.js` 内嵌 `base64(dist/index.html)`（482 B）、`base64(dist/assets/index-Dni1gLC0.js)`（1,447,144 B）、`base64(dist/assets/index-D4ubT5WG.css)`（62,984 B）、`base64(dist/docker.png)`（19,396 B）**逐字节包含为真**（4/4）；`bundle` 引用新 asset 名 `index-Dni1gLC0.js`，**不含**上一个 asset 名 `index-D2d2vkV6`；`bundle.includes("1.35.8")` 命中 2 次、`"1.35.7"` **0 次**；嵌入 systemd 单元模板 1,985 B |
| 硬证据 ② | 真包冒烟（`cp bundle.js smoke.cjs` + 临时 `DATA_DIR` / `CONFIG_DIR` / `LOG_DIR`，PORT=5031）：`GET /api/system/version` → **1.35.8**（需登录）；`GET /api/system/thermal` **无 Cookie 401**（受 `/api` 守卫保护）、**带 Cookie 200** 且结构 `{cpu:null,disks:[],drivetempLoaded:false,sataWithoutTemp:[]}`（Windows 无 sysfs，符合预期）；服务端日志 `📦 二进制模式：从嵌入式数据托管前端 (4 文件)` + `Backend running on http://localhost:5031` |
| 硬证据 ③ | 从**运行中的服务**取 asset：`/` 引用 `assets/index-Dni1gLC0.js` 与 `dist/assets/` **完全一致**；`curl .../assets/index-Dni1gLC0.js \| wc -c` = **1,085,356 B** 与本地文件字节数相同；缓存头 `index.html: no-cache, must-revalidate` / asset: `public, max-age=3600`；asset 内新 UI 文案可见（硬件信息 ×3 / 传感器 ×5 / 未检测到整盘设备 ×1 / drivetemp ×7 / 复制加载命令 ×1 / **安装脚本（install.sh）会自动加载 ×1** / 版本串 `1.35.8` ×1），旧文案「以 root 加载即可，无需重启」与旧版本串 `1.35.7` **均 0 命中** |
| 出包前校验 | 本版**前端确有改动**（`package.json` 升版本号 ⇒ vite 的 `__APP_VERSION__` 变了、提示条文案也变了）⇒ 删 `dist/` 后重跑 `vite build`（新 asset `index-Dni1gLC0.js`；`index-D4ubT5WG.css` 未变）；产物 SHA-256 = `index.html` `0be10777…` / js `865092c5…` / css `57986964…`，且与 `bundle.js` 内嵌 base64 解码结果**逐字节一致**（见硬证据 ①） |
| 硬证据 ④ | 交付包成员校验（`zipfile` 直读 zip）：恰好 **5 成员**（二进制 / `install.sh` / `uninstall.sh` / `.service` / `README.md`），权限位 `0o755/0o755/0o755/0o644/0o644`；**zip 内 `install.sh` 与工作区 `deploy/linux/install.sh` 逐字节一致**（17,229 B / SHA-256 `3f185db8899c8e35…`）⇒ 确认含「配置磁盘温度传感器（drivetemp）」段、`--no-drivetemp` 与 `SKIP_DRIVETEMP`；`uninstall.sh` 含归属识别清理、`README.md` 含 `--no-drivetemp` |

**出包后清理**：`build-upload/` 仅保留 `…-v1.35.8.zip` + 无版本号别名；`deploy/linux/` 仅保留当前 zip 与二进制；v1.35.6 与 v1.35.7 的包（`build-upload/` + `deploy/linux/` 共四处）已删除。


### 未完成 / 已知限制

- **SATA/HDD 需宿主内核加载 `drivetemp` 模块**（`modprobe drivetemp`，持久化 `/etc/modules-load.d/drivetemp.conf`）；NVMe 无需额外模块。**v1.35.8 起 `install.sh` 已自动完成这两步**（`--no-drivetemp` 可跳过）；⚠️ **OTA 在线升级只替换二进制、不跑安装脚本**，老部署需手动执行一次或重跑 `install.sh`（界面上有可复制命令）。未加载时该盘显示「—」，其余功能不受影响。
- 未做 S.M.A.R.T.（需 root / `CAP_SYS_RAWIO` + `smartmontools`），按用户要求不做。
- **真机 Linux 端到端验证待环境**（本机 Windows 无 `/sys`，温度恒为 `null`，已由 `scripts/check-thermal.mjs` 的虚拟 sysfs 树覆盖全部分支）。
- **CPU 温度取 `temp1`（封装 / Tctl 级）**，不展示每核温度（`coretemp` 的 `temp2..N_input` 未采集）；`zenpower` 等第三方芯片若把 `temp1` 用作非封装点位，读数可能偏移（未做芯片级校准）。
- **远程引擎（TCP / SSH）与容器内运行时，宿主 `/sys` 不可读** ⇒ 温度卡片整体为空（显示「无传感器」/「未检测到整盘设备」），属设计预期，不是故障。
- 温度提示条**只覆盖 SATA 缺温度**这一种「可自愈」情形；`mmcblk` / 虚拟盘 / 无传感器盘不给提示（无从修复）。

### 下一步

- 发布 v1.35.8（GitHub Release + 同步 `build-upload` 包）。
- ★ **约定：每次出包都升版本号**（Patch 连号），**不要重出同版本包** —— 旧包 SHA 即刻作废、极易与新版混淆（v1.35.7 正因重出而作废了两次，最终整体升为 v1.35.8）。

## v1.35.7 — 2026-09-29（已随 v1.35.11 发布 · **已作废 · 内容并入 v1.35.8**）

> 本版**从未发布**，两次出包（首版 `951a7420…` 43,030,942 B、重出 `61b721df…` 43,032,580 B）**均已作废**；全部改动已并入 **v1.35.8**，此处不再重复记录。

## v1.35.6 — 2026-09-29（已出包 · 已随 v1.35.11 发布 · **包已被 v1.35.8 取代**）

**主题：处理器 / 内存图标提示由原生 `title` 改为卡片式自定义 tooltip（分栏排版，不再拥挤）。**

### 已完成

- **新增本地组件 `IconTip`**（`src/pages/Dashboard.tsx`）：卡片式圆角 + 边框 + 阴影，首行加粗标题（`text-sm font-semibold text-slate-800`），次行是若干「标签 值」对（标签 `text-xs text-slate-400`、值 `text-xs font-mono text-slate-700`，`flex flex-wrap` 自动分栏）。
  - 位置钉在图标左下方（`absolute left-0 top-full mt-2`，`w-max max-w-[360px]`），`group-hover` 淡入（`opacity-0 → group-hover:opacity-100`）；`pointer-events-none` 保证不拦截鼠标、不遮挡磁贴上的其它交互。
  - 元素常驻 DOM（仅透明度切换）⇒ 可被自动化断言读取，且不产生布局抖动。
- **处理器图标**（`CpuTile`）：标题 = `cpuModel` 全串（原原生 `title` 被系统挤成「Intel(R) Xeon(R) Platinum」，现完整显示 `Intel(R) Xeon(R) Platinum 8269CY CPU @ 2.50GHz`）；配对项 = `物理核心 / 逻辑核心 / CPU 频率`（远程引擎无型号 ⇒ 标题退化为「处理器」+ 单项「逻辑核心」）。
- **内存图标**（`MemTile`）：标题 = `内存总量 X`；配对项 = `已用 / 系统占用 / Docker 占用`（`memFreeMB > 0` 时加 `剩余`）——与副标题同一口径。
- 删除原 `cpuTip` / `memTip` 字符串拼接与 `title={...}`，改为 `IconTip` 的 `items` 数组驱动。

涉及文件：`src/pages/Dashboard.tsx`、`package.json`（version → 1.35.6）。

### 验证

- `scripts/check-hooks.mjs` PASS（43 文件）+ 前端 `tsc` `exit 0`。
- **agent-browser 组件级实测**（临时验证台 `__preview_tip_main.tsx` 渲染 `Dashboard` + fetch 桩，验完即删）：
  - `[role="tooltip"]` 计数 = **2**（处理器 / 内存各一，原生 `title` 已不再出现）；
  - 处理器提示文本：标题 `Intel(R) Xeon(R) Platinum 8269CY CPU @ 2.50GHz` + `物理核心 2 / 逻辑核心 4 / CPU 频率 2500 MHz`（与参考图一致）；
  - 内存提示文本：标题 `内存总量 7.8 GB` + `已用 3.9 GB / 系统占用 2.4 GB / Docker 占用 1.5 GB / 剩余 3.9 GB`；
  - 样式：`background rgb(255,255,255)`、`border rgb(226,232,240)`（slate-200）、`position absolute`；初始 `opacity 0` → hover 图标后 `opacity 1`（未 hover 的内存提示仍为 `0`）；
  - 控制台**无报错**。

### 交付包

- **已构建（2026-09-29）**：`build-upload/docker-manager-yanzi-linux-x64-v1.35.6.zip` **43,027,762 B** / SHA-256 `b2de271699598916efc4c1c69aaecc35acf052dee5982188bdc092e7adc23357`（5 成员，权限位 `0755`/`0644` 已校验）；`latest` 别名 `docker-manager-yanzi-linux-x64.zip` 同字节。
- 内嵌二进制 `deploy/linux/docker-manager-yanzi` **130,092,224 B** / SHA-256 `90dea067f4e2e53cb920d3a5dd2e14c5220ccc24f820283acf7cfde74abe269f`，ELF magic `7f 45 4c 46` 已校验、含版本串 `1.35.6`。
- **硬证据**：`bundle.js` 内嵌 `base64(dist/assets/index-bJy6SM4h.js)` 与 `base64(dist/assets/index-DICH2dR2.css)` **逐字节包含为真**，解码后含 `role:"tooltip"` / `物理核心` / `内存总量` / `系统占用`；二进制引用的 asset 名 = `index-bJy6SM4h.js`（旧 `index-BPhtcYpA.js` 不存在）⇒ **本次 tooltip 改动确实进了包**。
- **未发布、未部署**。⚠️ **v1.35.5 的包已被本版取代，勿部署**（旧包已从 `build-upload/`、`deploy/linux/` 清除）。

### 未完成 / 已知限制

- 提示卡由 `group-hover`（纯 CSS 悬停）驱动，**键盘 / 触屏无等价触发**（与原生 `title` 的差异：原生在部分平台焦点也显示）；如需可加 `focus-visible` 或点击弹出。
- 卡片宽度上限固定 `max-w-[360px]`，超长型号会换行（当前型号单行放得下）。

### 下一步

- 出包 + 发布 v1.35.6（含 v1.35.4 目录打包下载）：v1.35.5 包已出但被本版取代。

## v1.35.5 — 2026-09-29（已出包 · 已随 v1.35.11 发布 · **包已被 v1.35.6 取代**）

**主题：仪表盘系统概览改 7 字段 + 处理器/内存图标 hover tooltip + 磁盘卡片显示文件系统 + 处理器/磁盘曲线默认折叠。**

### 已完成

- **系统概览磁贴重写 7 字段**（`src/pages/Dashboard.tsx` `SystemTile`）：删除原「运行容器 / 内存总量 / 镜像占用 / 数据卷占用 / 引擎 ID / 磁盘设备 / 正常运行时间」栅格，改为 `主机名称 / 发行版本 / 内核版本 / 系统类型 / 主机地址 / 启动时间 / 运行时间` 七项，与本机 socket 引擎采集的宿主机库存对齐。
  - 字段来源：本机引擎读 `os.hostname()` / `/etc/os-release` PRETTY_NAME / `os.arch()` / `os.networkInterfaces()` 首个非回环 IPv4；远程引擎回退 `docker.info()` 的 `Name / OperatingSystem / Architecture` 与 `ncpu`。
  - `启动时间` = `bootTimeSec` 秒级 → `toLocaleString`（远程引擎为 0 → 「—」）；`运行时间` 取宿主机 `/proc/uptime`（远程读不到 →「—」），单独 `col-span-2` 占满一行。
- **后端宿主机库存采集**（`server/docker.ts` `getEngineResourceStats`）：本机 `isLocal` 分支新增读取 `hostName / osName / kernelVersion / arch / hostAddress / bootTimeSec / cpuModel / cpuPhysicalCores / cpuLogicalCores / cpuMhz`；远程分支回退 `info.Name / OperatingSystem / Architecture` 与 `ncpu`。新增辅助 `readHostCpuInfo()`（解析 `/proc/cpuinfo` model name / cpu cores / cpu MHz / processor 计数）、`readOsReleasePretty()`（`/etc/os-release` PRETTY_NAME）、`readHostAddress()`（首个非回环 IPv4）、`readDiskFstypes()`（解析 `/proc/mounts`，`/dev/sda1→sda` 去尾部数字聚合 fstype）。
- **`EngineResourceStats` / `DiskStat` 类型扩展**（`src/types.ts`）：新增上述宿主机库存字段（注释标明本机/远程来源）；`DiskStat` 新增 `fstypes: string[]`。
- **处理器 / 内存图标 hover tooltip**：
  - `CpuTile` 图标 `<span title={cpuTip}>`：`cpuTip` 本机含 `型号\n物理核心 N · 逻辑核心 N · CPU 频率 N MHz`，远程仅 `逻辑核心 N`。
  - `MemTile` 图标 `<span title={memTip}>`：`memTip` = `内存总量 X · 已用 Y · 系统占用 A · Docker 占用 B · 剩余 Z`（与副标题同一口径）。
- **磁盘卡片新增「文件系统」列**（`DiskTile` 表格）：表头加 `<th>文件系统</th>`，行内 `d.fstypes?.join(" / ") || "—"`。
- **处理器 / 磁盘曲线默认折叠**：`useStoredFlag("dm.tile.cpu.chart", true)` → `false`、`useStoredFlag("dm.tile.disk.chart", true)` → `false`（持久化到 localStorage；内存 / 网络曲线仍默认展开，保持原行为）。

涉及文件：`src/pages/Dashboard.tsx`、`server/docker.ts`、`src/types.ts`、`package.json`（version → 1.35.5）。

### 验证

- 前后端 `tsc` 双 `exit 0`；`npm run lint:hooks` PASS（43 文件）；`npm run build:frontend` PASS（`dist` 产物生成）。
- **agent-browser 组件级实测**（`__preview_sys.tsx` 同时导出 SystemTile/CpuTile/MemTile/DiskTile，临时验证台验完即删）：
  - SystemTile 渲染 7 字段全部正确：启动时间 `2024/4/28 17:09:19`、运行时间 `883 天 22 小时 39 分`；
  - 处理器图标 `title` 含 `Intel(R) Xeon(R) Platinum 8269CY CPU @ 2.50GHz\n物理核心 2 · 逻辑核心 4 · CPU 频率 2500 MHz`（`cpuTipOk:true`）；
  - 内存图标 `title` 含 `内存总量 7.8 GB · 已用 3.9 GB · 系统占用 2.4 GB · Docker 占用 1.5 GB · 剩余 3.9 GB`（`memTipOk:true`）；
  - 磁盘表含「文件系统」表头且单元显示 `ext4` / `xfs`（`hasFsHeader:true`、`fstypeShown:true`）；
  - 处理器 / 磁盘曲线折叠开关初始值 `["false","false"]`（默认折叠）；
  - 控制台**无报错**。

### 交付包

- **已构建（2026-09-29）**：`build-upload/docker-manager-yanzi-linux-x64-v1.35.5.zip` **43,027,539 B** / SHA-256 `8b680592e668c769ef0ea6ec490b056ad9c6c4f8f5f70b90f78d7a7e6879de03`（5 成员，权限位 `0755`/`0644` 已校验）；`latest` 别名 `docker-manager-yanzi-linux-x64.zip` 同字节。
- 内嵌二进制 `deploy/linux/docker-manager-yanzi` **130,092,224 B** / SHA-256 `2d0a83796e871f92a6a6c9cb73898300c9d5eda978c4c0e14358a465fa2a75b2`，ELF magic `7f 45 4c 46` 已校验、含版本串 `1.35.5`。
- **未发布、未部署**。⚠️ **v1.35.3 的包已被本版取代，勿部署**。

### 未完成 / 已知限制

- 远程引擎（TCP/SSH）读不到 `/proc/uptime`、`/proc/cpuinfo` 等宿主机文件，`hostName / osName / kernelVersion / arch` 等回退到 `docker.info()`、`bootTimeSec` 为 0（界面显示「—」）；`cpuModel / cpuPhysicalCores / cpuMhz` 远程恒为空（处理器图标 tooltip 退化为「逻辑核心 N」）。
- 处理器 / 磁盘曲线默认折叠后，用户手动展开的选择按 `dm.tile.cpu.chart` / `dm.tile.disk.chart` 持久化；与磁贴整体折叠是两套独立状态。

### 下一步

- 出包 + 发布 v1.35.5；运行中容器端到端真机验证（本机无 Docker，待环境）。

## v1.35.4 — 2026-09-29（已编译 · 未出包 · 已随 v1.35.11 发布）

**主题：容器文件管理支持「目录打包下载（tar.gz）」。**

### 已完成

- **后端新增目录归档路由**（`server/index.ts` `GET /api/engines/:id/containers/:cid/files/archive`）：在鉴权守卫之后，对登录用户用 `archiveContainerPath()` 把目标路径（目录或文件）打成 `tar.gz`，以 `Content-Type: application/gzip` + `Content-Disposition: attachment; filename="<基名>.tar.gz"` 下发。选 tar 而非 zip：镜像内 tar 几乎必装、zip 常缺。
  - 合法性：空 `path` → `400`；根目录（`/` 或空）在 handler 内拒绝；体积超阈值（500MB 档）抛错提示「上限」，避免一次性把大目录读进内存。
  - 既有 `GET .../files/content`（查看/下载文件）、`PUT .../files/content`（写入）保持不动。
  - `server/docker.ts` 新增 `archiveContainerPath()`（复用 `buildEngineDockerCmd` 三态 + `tar czf -`）、`readContainerFile()`、`writeContainerFile()`，与既有的 `getContainerEntries()` / `execInContainer()` 共用同一套引擎抽象。
- **前端目录 / 文件分支下载**（`src/pages/Containers.tsx` 文件管理详情面板）：选中目录时按钮文案「打包下载」→ 调 `downloadContainerArchiveApi()`（打 `GET /files/archive?path=...`）；选中文件时按钮「下载」→ 调 `downloadContainerFileApi()`（打 `GET /files/content?path=...&download=1`）。`src/api.ts` 新增 `downloadContainerArchiveApi()` / `downloadContainerFileApi()`，均走 `downloadAsBlob()`（禁 `<a href>` 导航，避免被当页面跳转）。提示文案注明「目录会打包为 tar.gz」。

涉及文件：`server/index.ts`、`server/docker.ts`、`src/pages/Containers.tsx`、`src/api.ts`、`package.json`（version → 1.35.4）。

### 验证

- **路由层 13/13 PASS**（esbuild 复刻官方构建 → `server-bundle.cjs` 0.31MB，`format:cjs` + `--define:BUILD_BINARY=true` 消除顶层 await；桩 docker 经 cmd.exe 拉起，PATH 用 `cygpath -w` 反斜杠）：
  - 未登录 `archive` / `content` → 401（撞 `/api` 守卫）；登录后 `nope` 路由 → 404（负对照，确认 404 仅对登录态生效）；
  - `auth/init` → 200；根目录 → 拒绝；缺 `path` → 400；引擎不存在 → 404；
  - `archive` → 200 + `application/gzip` + 文件名 `sub.tar.gz` + gzip 魔数 `1f 8b` + 归档成员 `["sub/","sub/a.txt","sub/deep/","sub/deep/b.txt"]`；
  - 体积上限测试 → 提示「上限」。
- **前端组件级实测**（临时验证台，验完即删）：目录行选中 → 按钮「打包下载」、点击打到 `GET /files/archive?path=%2Fsub`、blob 类型 `application/gzip`；文件行 → 按钮「下载」、打到 `GET /files/content?path=%2Fa.txt&download=1`；提示文案含「目录会打包为 tar.gz」；控制台**无报错**。

### 未完成 / 已知限制

- 归档走 `tar czf -` 全量读内存后下发，超大目录（>500MB）会被体积上限拦截，未做流式分块下载。
- 端到端真机验证待运行中的 Docker 环境（本机无 Docker）。

### 下一步

- 合并进 v1.35.5 一并出包（v1.35.4 仅服务端/前端文件管理增强，未单独出包）。

## v1.35.3 — 2026-09-29（已出包 · 已随 v1.35.11 发布）

**主题：所有曲线的 X 轴显示时间刻度。**

### 已完成

- **`LineChart` 新增 X 轴时间刻度**（`src/components/LineChart.tsx`）：只要调用方传了 `labels`（时间串），图表底部就显示**首 / 中 / 尾**三个时间点；`len < 2` 或未传 `labels` 时不渲染、不占位 ⇒ **老调用方零回归**。
  - **必须走 HTML 层**：SVG 是 `preserveAspectRatio="none"` 横向拉伸的，画进 viewBox 的文字会连同线宽一起被**非等比缩放拉变形**（与既有 hover 圆点 / 提示框同样的理由）。
  - 用 `flex + justify-between` 排布：首尾标签贴边、中间居中，与数据点位置**天然对齐**，任意宽度下都**不会重叠或溢出**。
  - 图表本体高度仍由 `height` 决定，标签行**额外占位**（`mt-1` + `text-[10px] font-mono`）⇒ 曲线尺寸**不缩水**。
- **8 条曲线一次性全部生效**（组件级改动，无需逐个改调用方）：容器详情「资源监控」4 张卡（CPU / 内存 / 网络 I/O / 磁盘 I/O，`labels={statsLabels}`）＋ 仪表盘 4 处（处理器 / 内存 / 网络 / 磁盘，`labels={clockLabels(pts)}`）。
- 时间格式沿用调用方已有的 `fmtClock`（`HH:MM:SS`）。

涉及文件：`src/components/LineChart.tsx`、`package.json`（version → 1.35.3）。

### 验证

- `scripts/check-hooks.mjs` PASS（43 文件）+ 前后端 `tsc` 双 `exit 0` + `vite build` PASS（`index-Bq-Z6nLB.js`）+ `test:gates` 全绿（auth 29/0、restart 18/0）。
- **agent-browser 组件级实测**（临时验证台 4 种形态，验完即删）：
  - 单序列 + `labels` / 双序列 + `labels` ⇒ 均渲染 **1 行、3 个刻度**，内容 `10:23:15 / 10:23:29 / 10:23:44`（30 点、1s 步长，首尾跨 29 秒、中点为第 15 点）✅ 索引计算正确；
  - `len < 2`（空态）与**未传 `labels`** ⇒ 刻度行数 **0**，且 `svgH` 仍为 **104**（= 传入 `height`）⇒ 曲线本体未缩水、**零回归**；
  - `font-mono` 已生效；控制台**无报错**。

### 交付包

- **已构建（2026-09-29）**：`build-upload/docker-manager-yanzi-linux-x64-v1.35.3.zip` **43,024,883 B** / SHA-256 `c426bd300f811134c7e9fce8555b22e205d09f50ced78fb86c10da6a8e8f6b7d`（5 成员，权限位 `0755`/`0644` 已校验）；`latest` 别名同字节。
- 内嵌二进制 `deploy/linux/docker-manager-yanzi` **130,092,224 B** / SHA-256 `802665cd546817996786f7a7564feb823229c3f430a3543ced33ef3c06f784b2`，ELF magic `7f 45 4c 46` 已校验、含版本串 `1.35.3`。
- **未发布、未部署**。⚠️ **v1.35.2 的包已被本版取代，勿部署**。

### 未完成 / 已知限制

- 刻度固定 **3 个**（首 / 中 / 尾），未做「按容器宽度自适应增减个数」；窄卡片下偏松、宽卡片下偏疏（但**永不重叠**，这是刻意取舍）。
- X 轴刻度与 Y 轴 `formatMin` 的「0」标签在右下角相邻（间距 4px），视觉略挤但**不重叠**。

### 下一步

- 发布 v1.35.3（GitHub Release + 同步 `build-upload` 包）+ 在运行中的容器上做文件管理端到端验证（列 / 读 / 写 / 上传 / 下载 / 增删改 chmod）。

## v1.35.2 — 2026-09-29（已出包 · 已随 v1.35.11 发布 · **包已被 v1.35.3 取代**）

> 主题：**「资源监控」曲线时长可设置（默认 30 秒）** —— 四张卡的曲线窗口由固定 2 分钟改为**可选时长**（10 秒 / 30 秒 / 1 分钟 / 2 分钟 / 5 分钟，与仪表盘同一套档位），默认 **30 秒**，选择按 localStorage 持久化；采样间隔同步收紧到 **1 秒**（与仪表盘曲线口径一致），切换时长只在**本地切片**、不产生额外请求。

### 已完成

- **时长选择器**（`src/pages/Containers.tsx`）：资源监控页签顶部新增一行「曲线窗口：最近 30 秒（每 1 秒采样，当前 N 个点）」+ 右侧 `<select title="选择曲线显示的时长">`；档位沿用仪表盘 `RANGES`（`10s / 30s / 1m / 2m / 5m`），**默认 30 秒**。
- **采样与保留**：`STATS_SAMPLE_MS` 2000 → **1000**，`STATS_MAX_POINTS` 60 → **300**（1s × 300 = 最近 5 分钟，即窗口上限）；显示时 `statsHistory.slice(-statsPoints)` **本地切片**，切时长不发请求。
- **防重入**：1s 间隔下远端 SSH/TCP 引擎单次 `docker stats` 可能来不及返回，`pull()` 加 `inFlight` 守卫，上一轮未返回则跳过本轮。
- **持久化**：`dm.container.statsRange`（与仪表盘 `dm.chart.*.range` 同风格），初始化校验取值合法、读写均包 `try/catch`（隐私模式降级为默认值）。
- `package.json` version → 1.35.2（按 **Patch** 递增）。

### 涉及文件
`src/pages/Containers.tsx`、`package.json`（version → 1.35.2）。

### 验证
`npm run lint:hooks` PASS + 前后端 `tsc` 双 0 + `npm run build:frontend` PASS + `test:gates` 全绿（18/0）+ **agent-browser 实测**（临时预览 + `vite --port 8093`，视口 1440×900）：
- 进页签默认 `value="30s"`、5 个档位（10 秒 / 30 秒 / 1 分钟 / 2 分钟 / 5 分钟）、提示文案「最近 30 秒（每 1 秒采样，当前 N 个点）」；
- 1s 采样生效：2 秒后 5 点 → 22 秒后曲线点数被窗口**截断在 30**；
- 切 **10 秒** ⇒ 点数 30 → **10**（截断生效）；切 **5 分钟** ⇒ 45 点（未截断）；
- `localStorage` 依次写入 `30s → 10s → 5m`；**reload 后重开详情仍为 `5m`** ⇒ 持久化生效；
- 网络卡图例与 mock 对上（每次 +100KB、1s 采样 ⇒ 实测 **100.7 KB/s**）；
- `agent-browser errors` 无控制台报错。

### 交付包
- **已构建（2026-09-29）**：`build-upload/docker-manager-yanzi-linux-x64-v1.35.2.zip` **43,024,837 B** / SHA-256 `e96cdfb3440073d3249672253e61826db71a633d19ef71020818c28e939a0042`（5 成员，权限位 `0755`/`0644` 已校验）；`latest` 别名同字节。
- 内嵌二进制 `deploy/linux/docker-manager-yanzi` **130,092,224 B** / SHA-256 `53647d2d8a455fb4192ea399f6611ddb8cbcca64fe0bde8813dbf387579f9952`，ELF magic `7f 45 4c 46` 已校验、含版本串 `1.35.2`（`1.35.1` 已不存在）。
- **未发布、未部署**。⚠️ **v1.35.1 的包已被本版取代，勿部署**。

### 未完成 / 已知限制
- 曲线窗口只在**页签激活**时累积；切走再回来从空窗口重算（首点速率为 0），不保留历史。
- 1s 采样使远端引擎的请求频率翻倍；若单次 `docker stats` 超过 1s，防重入守卫会跳过若干点、曲线变稀（正常降级）。
- 时长选择四张卡**共用一份**（不做单卡独立设置）。

### 下一步
- 发布 v1.35.2（GitHub Release + 同步 `build-upload` 包）+ 在运行中的容器上做端到端验证（列 / 读 / 写 / 上传 / 下载 / 增删改 chmod）。

---

## v1.35.1 — 2026-09-29（已出包 · 已随 v1.35.11 发布 · **包已被 v1.35.2 取代**）

> **版本号更正**：本轮内容曾按 `1.35.0` 记为 Minor，按约定更正为 **Patch（`1.35.0` → `1.35.1`）** —— 此类「UI / 交互小改动」走第三位递增，Minor 只留给「新增功能模块 / 新页面」。`1.35.0` 未发布、未交付过，故直接以 `1.35.1` 出包。
>
> 主题：**容器详情「资源监控」增加历史曲线 + 头部精简** —— ① 弹窗与半页面下，「资源监控」四张卡（CPU / 内存 / 网络 I/O / 磁盘 I/O）各增加**历史曲线**（轮询采样，约 2 分钟窗口，支持悬停取值）；② 网络 / 磁盘的数值由「自容器启动累计」改为**实时速率**（与曲线口径一致）；③ 详情头部副标题去掉镜像串，只留「状态 + 运行时长」。

### 已完成

- **轮询采样 + 曲线窗口**（`src/pages/Containers.tsx`）：进入「资源监控」页签后按 `STATS_SAMPLE_MS = 2000` 轮询 `fetchContainerStats`，把最近 `STATS_MAX_POINTS = 60` 点（≈2 分钟）累积进 `statsHistory`；离开页签清掉定时器并**清空速率基线**（避免下次进来用几分钟前的快照差出偏低的平均速率）。
- **累计值差分出速率**：服务端 `getContainerStats` 返回的 `netInput / netOutput / blockInput / blockOutput` 是**自容器启动累计 KB**，直接画曲线只会得到一条单调上升的斜线。新增 `toRate(cur, prev, dtSec)`：与上次快照差分再除以间隔秒数；**首采样无基线、以及容器重启导致计数器回卷（`cur < prev`）时返回 0**。
- **四张卡各挂 `LineChart`**（`src/components/LineChart.tsx`，高 104px）：CPU「`#3b82f6` / `yMax 100`」、内存「`#a855f7` / `yMax = memoryLimit`」、网络「接收 `#ef4444` + 发送 `#f59e0b`」、磁盘「读取 `#3b82f6` + 写入 `#f59e0b`」——配色与仪表盘同源；卡片结构统一为「数值 + 进度条/图例 + 分隔线 + 曲线」。
- **网络 / 磁盘数值改为实时速率**：卡片右上角改为带色点的图例（`接收 50.1 KB/s` / `写入 30 KB/s`），与曲线末点一致；新增 `fmtKbRate` / `fmtMB` / `fmtClock` 三个模块级格式化函数（与仪表盘同一口径）。
- **详情头部去掉镜像**：副标题由「状态 badge · 镜像 · 运行时长」收敛为「状态 badge + 运行时长」，长镜像串不再挤占标题行。
- `package.json` version → 1.35.1（由 `1.35.0` 更正，Patch 递增）。

### 涉及文件
`src/pages/Containers.tsx`、`package.json`（version → 1.35.1）。

### 验证
`npm run lint:hooks` PASS（43 文件）+ 前后端 `tsc` 双 0 + `npm run build:frontend` PASS（新 asset `index-BcA-Gffz.js` / `index-a20i0UvE.css`）+ `test:gates` 全绿（PASS=18 / FAIL=0）+ **agent-browser 实测**（临时预览 + `vite --port 8093`，视口 1440×900，mock 每次调用递增累计计数）：
- 资源监控页出现 **4 张曲线**，路径数 = 1 / 1 / 2 / 2、颜色 = `#3b82f6` / `#a855f7` / (`#ef4444`,`#f59e0b`) / (`#3b82f6`,`#f59e0b`)，高度均 104px；
- 轮询确实在累积：首采样 7 点 → 21 秒后 11 点；
- **差分速率与 mock 完全对上**：mock 每次 +100KB、间隔 2s ⇒ 实测「接收 **50.1 KB/s**」；+40 ⇒ 20 KB/s；+60 ⇒ 30/30.1 KB/s；+20 ⇒ 10 KB/s；
- 真实鼠标 `hover` 到曲线 ⇒ 悬停提示框出现（`09:40:35 / CPU 16.8%`）+ 游标竖线与圆点；
- 头部副标题 = `运行中 运行 36 hours (healthy)`（镜像串已消失）；
- `agent-browser errors` 无控制台报错。

### 交付包
- **已构建（2026-09-29）**：`build-upload/docker-manager-yanzi-linux-x64-v1.35.1.zip` **43,024,293 B** / SHA-256 `7c3c6f05e12dfee78c15fb6c87cf51ca8dbc4cc0c7ae3ebde9664012be0591f4`（5 成员，权限位 `0755`/`0644` 已校验）。
- ⚠️ **该包已被 v1.35.2 取代，勿部署**（`latest` 别名现指向 v1.35.2 包）；此处仅作历史留存。
- 内嵌二进制 `deploy/linux/docker-manager-yanzi` **130,092,224 B** / SHA-256 `8b0e3cdc6599a79ff178351896a0f935cb76f77a1403c31f40ce79bb33bef635`，ELF magic `7f 45 4c 46` 已校验、含版本串 `1.35.1`（`1.35.0` / `1.34.0` 均已不存在）。
- ⚠️ 改号前的 `…-v1.35.0.zip`（43,024,339 B / `fc882355…`）**未发布、已作废**，勿使用。
- **内嵌 dist 校验**：解出二进制里 base64 dist 段（3,484,168 + 1,436,268 字符）后直搜 UTF-8 中文，命中「正在采样网络」×2、「磁盘 I/O」×2 ⇒ 本轮前端确已进包。
  ⚠️ **修正一条旧结论**：前端 dist 里的中文是 **UTF-8 原样**（可直搜）；二进制里搜不到只是因为 **dist 整段被 base64 编码**，并非「CJK 被转义成 `\uXXXX`」——那是 `bundle.js`（esbuild CLI 打包 server）那一侧的形态。两者编码形态不同，判据别混用。
- **未发布、未部署**。⚠️ **v1.34.0 的包已被本版取代，勿部署**。

### 未完成 / 已知限制
- 曲线**不做时间范围下拉**（固定 2s × 60 点 ≈ 2 分钟窗口）；若要 5 分钟或更稀采样，后续再加。
- 采样仅在「资源监控」页签激活时进行（不常驻后台轮询）；切回该页签从空窗口重新累积，首点速率为 0。
- 内存曲线量程钉在容器 `memoryLimit`；容器**未设内存上限**时 Docker 返回宿主机总内存，曲线会显得很平。
- 基于 `stream=false` 的**瞬时采样**（非 Prometheus 式），短于 2s 的尖峰可能采不到。

### 下一步
- 发布 v1.35.1（GitHub Release + 同步 `build-upload` 包）+ 在运行中的容器上做端到端验证（列 / 读 / 写 / 上传 / 下载 / 增删改 chmod）。

---

## v1.34.0 — 2026-09-29（已出包 · 已随 v1.35.11 发布 · **包已被 v1.35.1 取代**）

> 主题：**容器详情「半页面」体验优化** —— ① 半页面支持**左右拖动改变宽度**（拖左缘，双击手柄复位半屏）；② 「基本信息」与「资源监控」改为**单列**展示（半屏窄栏下两列会把长值挤压换行）；③ 「日志」与「终端」**撑满内容区**，修掉输入框 / 日志框下方的大片空白。

### 已完成

- **半页面可拖动改宽**（`src/components/Modal.tsx`）：`Drawer` 新增 `resizable` / `minWidth`（默认 380px）/ `maxWidthRatio`（默认 0.92）三个 prop；面板左缘新增拖拽手柄（`w-2.5` 竖条，hover 变蓝、`cursor-col-resize`、`title="拖动调整宽度（双击复位）"`），`mousedown` 起手 → `window` 上 `mousemove` 实时反算宽度（向左拖变宽）→ `mouseup` 收尾并还原 `userSelect`/`cursor`；双击手柄复位为半屏；拖动结束后紧跟的那次 click 用 `justDraggedRef` 吞掉，避免落在遮罩上被当成「点外部关闭」。
- **基本信息单列**（`src/pages/Containers.tsx` `ContainerInfoTab`）：`grid grid-cols-2 gap-4` → 单列（`space-y-0.5`），行内 `items-center` → `items-start`、值加 `break-all min-w-0`，长镜像名不再横向溢出。
- **资源监控单列**：4 张指标卡 `grid grid-cols-2 gap-4` → `space-y-4` 纵向堆叠。
- **日志 / 终端撑满内容区**（`Containers.tsx`）：内容区按页签切换布局——`logs` / `terminal` 走 `flex-1 min-h-0 flex flex-col`（内部自行撑满），其余页签保持 `overflow-y-auto` 整体滚动；日志框去掉 `max-h-[50vh]`（实测 450px → 665px），顶部工具栏加 `flex-shrink-0`。
- **终端尺寸自适应**（`src/components/XTermTerminal.tsx`）：新增 `fill` prop（`fill` 时容器 `flex flex-col h-full min-h-0`、终端区 `flex-1 min-h-0` + `minHeight:220px`，去掉原 `height:50vh`）；新增 `ResizeObserver`，容器尺寸变化（抽屉拖宽 / 页签切换 / 布局变化）时自动 `fitAddon.fit()` 并向 PTY 回传 `resize`，避免终端停在旧列数；渲染期把 `terminalRef.current` 收敛为局部 `el` 供观察者闭包使用。

### 涉及文件
`src/components/Modal.tsx`、`src/components/XTermTerminal.tsx`、`src/pages/Containers.tsx`、`package.json`（version → 1.34.0）。

### 验证
`npm run lint:hooks` PASS（43 文件）+ 前后端 `tsc` 双 0 + `npm run build:frontend` PASS（新 asset `index-wBfIvXqE.js` / `index-DN2aBH6t.css`）+ `test:gates` 全绿（PASS=18 / FAIL=0）+ **agent-browser 实测**（临时预览 `src/__preview_detail.tsx` + `tmp-preview.html` + `vite --port 8093`，视口 1440×900，真实鼠标事件）：
- 打开详情：面板 `x=720 / w=720 / h=900`、overlay `position:fixed`、拖拽手柄存在；
- 真实鼠标拖动（`mouse move/down/up`，x 724 → 450）：面板 `x=446 / w=994`（目标 990，取整差 4px）；
- 双击手柄复位：回到 `x=720 / w=720`；
- 基本信息：`display:block`、`grid-template-columns:none`、8 行、行宽 = 面板内宽（672）⇒ 确认单列；
- 资源监控：两卡 `stacked:true` ⇒ 确认单列；
- 日志：日志框高 **665px**（原 `max-h-50vh` = 450px）、底距 16px（`py-4`）、`scrollH 1492 > clientH 665` 可滚；
- 终端：终端区高 **712px**、底距 16px；
- 全程 `agent-browser errors` 无控制台报错。验完临时文件与截图已全部删除。

### 交付包
- **已构建（2026-09-29）**：`build-upload/docker-manager-yanzi-linux-x64-v1.34.0.zip` **43,022,924 B** / SHA-256 `86d48c53f732cfbe614939d798ccd44a3586daf9bfb3e1e012ecda01417f8a44`（5 成员，权限位 `0755`/`0644` 已校验）。
- ⚠️ **该包已被 v1.35.1 取代，勿部署**（`latest` 别名现指向 v1.35.1 包）；此处仅作历史留存。
- 内嵌二进制 `deploy/linux/docker-manager-yanzi` **130,092,224 B** / SHA-256 `ae34ec50ca24c6f791f4226320ff01ad65bb9a04e3cc9b659470e5ea42d903b9`，ELF magic `7f 45 4c 46` 已校验、含版本串 `1.34.0`（`1.33.0` 已不存在）。
- **内嵌 dist 校验**：解出二进制里的 base64 dist 段（3,484,168 / 1,432,776 字符）后搜到 `col-resize`×2、`drawer-content`×1、`w-2.5`×1 ⇒ 本轮前端改动确已进包（CJK 被 esbuild 转 `\uXXXX`，直接搜中文/类名查不到属正常）。
- **未发布、未部署**。⚠️ **v1.33.0 的包已被本版取代，勿部署**（v1.34.0 = v1.33.0 全部内容 + 本轮详情视图优化）。

### 未完成 / 已知限制
- 拖动宽度**不持久化**（刷新或重开回到半屏）；如需记住用户偏好，后续可存 `localStorage` 或纳入系统设置。
- 仅「半页面」可拖动；「弹窗」形式的宽度仍由 `Modal` 的 `size` 决定（`xl` = `max-w-6xl`）。
- 日志 / 终端撑满依赖父级 `flex` 高度链，后续若在中间再嵌一层非 flex 容器会退化为顶部贴合。

### 下一步
- 发布 v1.34.0（GitHub Release + 同步 `build-upload` 包）+ 在运行中的容器上做端到端验证（列 / 读 / 写 / 上传 / 下载 / 增删改 chmod）。

---

## v1.33.0 — 2026-09-28（已出包 · 已随 v1.35.11 发布 · **包已被 v1.34.0 取代**）

> 主题：**容器详情视图（文件管理 + 半页面/弹窗样式）** —— ① 容器详情新增「文件」标签页，支持浏览 / 查看 / 文本编辑 / 上传 / 下载 / 新建文件与文件夹 / 重命名 / 删除 / 改权限（chmod），仅运行中容器可用（docker exec 必需，未运行显示「请先启动容器」）；② 容器详情支持 **半页面（右侧抽屉，参考 1panel）** 与 **居中弹窗** 两种展示形式，可在「系统设置 → 弹窗设置」切换。

### 已完成
- **后端 `server/docker.ts`（7 个函数 + 3 个 helper）**：
  - `execInContainer(engine, cid, script, {input?, scriptArgs?})`：统一入口，复用 `buildEngineDockerCmd`（socket/tcp/ssh 三态）走 `docker exec`，读取类自动关闭 stdin 防挂起、写入类用 `-i` + stdin 透传 Buffer（二进制安全）；脚本路径一律作为 `sh -c` 的位置参数 `$1`/`$2` 传入，杜绝容器路径里的引号冲突（SSH 引擎尤其关键）。
  - `assertContainerRunning()`：用 `docker exec true` 判运行态，非运行抛「容器未运行，文件管理需要运行中的容器」。
  - `normalizeContainerPath()`：POSIX 归一化 + 解析 `..`，确保绝对路径。
  - `listContainerFiles()`：容器内 `ls -1a` + `stat -c` 解析 `权限|大小|mtime|名称|链接目标`（GNU coreutils 与 busybox 均支持），目录在前、符号链接带 `target`。
  - `readContainerFile()`（Buffer）/ `writeContainerFile()`（覆盖写）/ `createContainerEntry()`（touch|mkdir -p）/ `renameContainerPath()`（mv）/ `removeContainerPath()`（rm -rf）/ `chmodContainerPath()`（chmod，模式做白名单清洗）。
  - 导出 `ContainerFileEntry` 类型。
- **后端 `server/index.ts`（4 条路由）**：`GET …/files?path=`（列表）、`GET …/files/content?path=&download=1`（查看/下载，文本按 utf-8、二进制回 `isBinary` 并以附件下发）、`PUT …/files/content`（原始字节写，express.raw 50MB）、`POST …/files`（`{action:'create'|'rename'|'delete'|'chmod'}`）。统一 getEngine 404 + try/catch 500 包裹。
- **前端 `src/types.ts`**：新增 `ContainerFileEntry`（`name/path/size/mtime/mode/isDir/isSymlink/target`）。
- **前端 `src/api.ts`（8 个 API）**：`listContainerFilesApi` / `readContainerFileApi` / `writeContainerFileApi`（文本 PUT）/ `uploadContainerFileApi`（ArrayBuffer 二进制 PUT）/ `downloadContainerFileApi`（复用 `downloadAsBlob`）/ `createContainerEntryApi` / `renameContainerPathApi` / `removeContainerPathApi` / `chmodContainerPathApi`。
- **前端 `src/pages/Containers.tsx`**：详情弹窗 tabs 新增「文件」（`ContainerFileTab` 组件）——面包屑导航、列表（双击进目录 / 双击文件编辑）、选中后操作条（下载/重命名/权限/删除）、编辑器弹窗（textarea 保存、二进制提示下载）、新建文件/文件夹弹窗、重命名弹窗、权限弹窗、删除二次确认；`container.status !== "running"` 时显示 EmptyState 提示先启动。
- **容器详情视图样式（半页面 / 弹窗）**：
  - `src/components/Modal.tsx` 新增 `Drawer` 组件：右侧抽屉浮层（`fixed inset-0 flex justify-end` + `md:w-1/2` 铺满高度面板），ESC / 点遮罩关闭、滚动锁定、`slideInRight` 入场动画。
  - `ContainerDetailModal` 重构为「共享内容 `detailInner` + 二选一外壳」：`presentation="drawer"` 渲染 `<Drawer>`，`="modal"` 渲染原 `<Modal bodyClassName="p-0 …">`；内容区改为 `flex-1 min-h-0 overflow-y-auto`（原 `max-h-[60vh]`），高度随宿主自适应。
  - `src/types.ts` `ModalConfig` 新增 `containerDetailStyle: "drawer" | "modal"`；`server/settings.ts` 默认 `"drawer"`；`src/App.tsx` 把 `settings.modal.containerDetailStyle` 透传给 `<Containers>`。
  - `src/pages/Settings.tsx`「弹窗设置」新增「容器详情视图」卡片（半页面 / 弹窗 二分选择）；`src/index.css` 新增 `slideInRight` 关键帧。
- **涉及文件**：`server/docker.ts`、`server/index.ts`、`server/settings.ts`、`src/types.ts`、`src/api.ts`、`src/pages/Containers.tsx`、`src/pages/Settings.tsx`、`src/components/Modal.tsx`、`src/App.tsx`、`src/index.css`、`package.json`（version → 1.33.0）。
- **验证**：`npm run lint:hooks` PASS（43 文件）+ 前后端 `tsc` 双 0（含 `tsc --noEmit -p tsconfig.json` 前端严格检查）+ `vite build` 成功 + **半页面抽屉实测**（临时预览 + agent-browser：视口 1440×900 下面板 `x=720 / w=720 / h=900`、overlay `position:fixed`、内容区内部可滚动、无控制台报错，截图与 1panel 参考一致）+ `test:gates` 全绿。

### 交付包
- **已构建（2026-09-29 重建，含容器详情视图改动）**：`build-upload/docker-manager-yanzi-linux-x64-v1.33.0.zip` **43,022,049 B** / SHA-256 `82aafaf202ab3bde5942e761c2c8851979de8457a9fd6c7a4c73f4b64649c8a8`（5 成员，权限位 `0755`/`0644` 已校验）。
- ⚠️ **该包已被 v1.34.0 取代，勿部署**（`latest` 别名 `docker-manager-yanzi-linux-x64.zip` 现指向 v1.34.0 包）；此处仅作历史留存。
- 内嵌二进制 `deploy/linux/docker-manager-yanzi` **130,092,224 B** / SHA-256 `aecc88a374285c295bebb4607066f6e4e814d139e0f925a5b432b61fe956c54f`，ELF magic `7f 45 4c 46` 已校验、含版本串 `1.33.0`。
- **Windows 交叉构建路径（不走 `build.sh`）**：`scripts/build-binary.mjs`（bundle.js）→ 以 `/tmp/sea-build/node-v22.22.2-linux-x64/bin/node`（**Linux node**）为 base 生成 SEA blob → `postject` 注入 → `make-package.py` 打 zip。⚠️ `deploy/linux/build.sh` 是「在 Linux 上」的构建路径（用本机 `command -v node`），**在 Windows 上跑它会拿 Windows node 当 base，产不出 Linux ELF**。
- **未发布、未部署**（部署无副作用；与服务端遥测改造是否上 ECS1 无关）。

### 未完成 / 已知限制
- 仅运行中容器支持；未运行容器走 `docker cp` 上传/下载（SSH 需 scp 中转）的复杂路径**推迟到后续版本**。
- 文件列表用 `ls`+`stat` 逐条取 stat，目录条目极多时偏慢（数百量级可接受）；distroless 等无 shell 镜像不可用（exec 失败，前端报错）。
- 编辑器为纯文本 textarea，无语法高亮、无大文件分片（>50MB 上传被 express.raw 上限拦截）。

### 下一步
- 发布 v1.33.0（GitHub Release + 同步 `build-upload` 包）+ 在运行中的容器上做端到端验证（列/读/写/上传/下载/增删改 chmod）。

---

## v1.32.1 — 2026-09-28（已出包 · 已随 v1.35.11 发布）

> 主题：**修复「小堆栈备份过小被误判为无效文件」** —— 创建堆栈选「堆栈备份」上传几百字节的合法 zip，前端显示 `0.0 MB` 且后端报红「未收到有效的堆栈备份文件」。

### 已完成
- **根因**：`server/docker.ts` 的 `createStackFromBackup` 用 `buf.length < 1024` 当「有效文件」门槛；仅含 compose 的合法小备份 zip 实测约 382~535 B（ZIP 理论最小 22 B，空归档 EOCD），远小于 1KB ⇒ 被误杀。前端 `(size/1024/1024).toFixed(1)` 对 <1MB 恒显 `0.0 MB`，双重误导。
- **改法**：
  - `server/docker.ts`：阈值 `1024` → `22`（只拦「请求体完全为空」；其后 `buf[0..1]!=="PK"` 仍拦非 zip，`extractZip` 的结构 / CRC 校验兜底）。下游解包逻辑不变。
  - `src/pages/Stacks.tsx`：文件提示由 `(backupFile.size/1024/1024).toFixed(1)+" MB"` 改为复用 `src/transforms.ts` 的 `formatBytes()`（输出 `382.0 B` / `1.2 KB` / `3.4 MB` 自适应）。
- **涉及文件**：`server/docker.ts`、`src/pages/Stacks.tsx`（新增 import `formatBytes`）、`src/transforms.ts`（复用，未改）、`package.json`（version → 1.32.1）。
- **验证**：hooks（43 文件）PASS + 前后端 `tsc` 双 0 + `npm run test:gates` 全绿；**端到端实传 299B `_tiny.zip`** 到 `/api/engines/e1/stacks/from-backup?name=tiny` → `{"success":true,"data":{"name":"tiny","path":"…dockercompose\\tiny\\docker-compose.yaml"}}`，落盘内容正确（旧阈值必拒，新阈值通过）。

### 未完成 / 已知限制
- 交付包**未发布、未部署**（与遥测无关，部署无副作用；服务端 `yanzi/api` 改造仍未上 ECS1 是独立搁置项）。
- 仅修「过小被拒」与「大小显示」；上传交互其余逻辑未动。

### 下一步
- 发布 v1.32.1（GitHub Release + 同步 `build-upload` 包）。

---

## v1.32.0 — 2026-09-28（已出包 · 已作废 · 被 v1.32.1 取代）

> 主题：**上报事件合并为一条** —— 原先 `install` / `active` 两个事件（且上传开关变更时会**连发 2 条请求**）收敛为
> **单一事件 `report`**；是否「安装 / 重装」改由载荷布尔字段 **`install`** 表达。客户端一次上报**恒定只发 1 条请求**。

### 一、变更内容

| 项 | 改前 | 改后 |
|---|---|---|
| 事件名 | `event: "install" \| "active"`（二选一） | **`event: "report"`（唯一取值）** |
| 是否安装 | 由事件名隐含 | 载荷显式字段 **`install: true \| false`** |
| `reportOnce()` | 一次最多发 1 条（install 优先，否则 active） | 一次**恒定最多 1 条**，`install` 标记随本次语义 |
| `reportOnToggle()` | **连发 2 条**（install + active） | **只发 1 条** |
| 服务端语义 | `event === 'install'` 才覆盖设备快照 | `install === true`（或旧客户端 `event === 'install'`）才覆盖快照 |

**触发判据未变**：`needInstall = 标识文件刚被重建（且过 24h 限流）|| 从未成功上报过安装`；
`shouldSend = needInstall || force || 距上次成功上报满 12 小时`；12 小时周期、10 分钟重试、401/403 不密集重试均不变。

### 二、涉及文件

- `server/telemetry.ts`：`TelemetryEvent` 收敛为 `"report"`；`buildPayload()` 改签名（去掉 `event` 形参、新增 `install`）并在载荷里新增 `install`；`sendEvent()` → **`sendReport()`**（唯一出口）；`reportOnce()` / `reportOnToggle()` 重写为单条发送；新增导出类型 **`ReportResult`**（`{ sent, install, error?, fatal? }`）。
- `src/api.ts`：`reportTelemetryNow()` 返回类型补 `install`；上传状态字段注释同步。
- `docs/上报.json`：样例更新为新契约（`event: "report"` + `install: true`），由客户端真实生成后落盘。
- `docs/上报触发与接口及上报内容.md`：全文同步（速览 / 时机表 / 事件选择规则 / 开关例外 / 接口 / 字段字典 / 实测样例）。

### 三、验证

| 项 | 结果 |
|---|---|
| 前端 `tsc --noEmit` / 服务端 `tsc -p server/tsconfig.json` | ✅ 双 0 退出 |
| `npm run test:gates`（hooks 43 + auth 53 + restart 18） | ✅ 全绿 |
| **新契约隔离实测**（esbuild 打包 `server/telemetry.ts` → 桩 `fetch` + 临时 `CONFIG_DIR`） | ✅ **25/25 PASS** |

**隔离实测覆盖**：首报只 1 条请求 / `event` 恒为 `report` / `install=true` / 端点与 `X-Telemetry-Key` 正确 / `device_uuid` 为 64 位 hex /
`device.info` 与 `installReported` 正常落盘；周期未到**一条都不发**；`force` 时 `install=false`（纯心跳）；
**开关变更由 2 条降为 1 条**且 `uploadEnabled` 随方向翻转；开关关闭态下常规上报 0 请求 + 返回「上传已关闭」；契约字段齐全且不含任何业务数据。

### 未完成 / 已知限制

- ✅ **服务端已同步改造完成**（2026-09-28，`yanzi/api` 本地仓库，共 4 个文件）：
  - `src/telemetry.js` 新增导出纯函数 **`resolveEvent(event, payload)`** —— 事件语义归一的**唯一入口**：`install` → 安装；`active` → 心跳；`report` → 看载荷 `install`（**严格 `=== true`**，字符串 `"true"` / 数字 `1` / 缺失都按心跳）；其余事件名 `valid:false`。
  - `src/routes.js` 白名单放行三种事件名，改由 `telemetry.resolveEvent()` 分流；400 文案 → `仅支持 report / install / active`。
  - `README.md` 13 处契约说明同步；`scripts/verify-telemetry.mjs` 新增 **④c 节（15 条，含「路由是否真的调了归一出品」的接线检查）**。
  - ★ **`telemetry.js` 既有语义一行未改**（`upsert` / `handleInstall` / `handleActive` 原样，`normalizePayload` 本就不读 `event`）—— 归一化只发生在路由层。
  - ⚠️ **尚未部署到 ECS1**：线上跑的还是旧代码。
- ✅ **v1.32.0 交付包已构建**（2026-09-28，按用户明确要求**先出包**；仅本地产物、**未发布**到 GitHub Releases）。⚠️ **部署顺序约束依然有效**：服务端（ECS1）上线前**不要部署此包** —— 新版客户端恒发 `event:"report"`，而线上旧服务端对未知事件名直接 **400**，会导致**上报全 400**（不影响业务功能，仅统计断流）。
- ⚠️ **服务端回归在本机会有一条 `skip`**：`verify-telemetry.mjs` 第 ⑥ 节要起子进程，Windows 沙箱禁止 spawn（`EBUSY`）⇒ 打印 `skip` 而非 `FAIL`（已加降级：仅明确的进程启动类错误才跳过，JSON 解析失败 / 子进程内部抛错仍判 FAIL）。**该节必须在部署机 / CI 上真实跑过**。
- 统计口径不变：安装量 = 设备数（`registered`），活跃 = `last_heartbeat_at` 在窗口内；合并后 `install` 只影响「是否覆盖设备快照」。

### 交付包

| 项 | 值 |
|---|---|
| 文件 | `build-upload/docker-manager-yanzi-linux-x64-v1.32.0.zip`（另存无版本名别名 `build-upload/docker-manager-yanzi-linux-x64.zip`，两者 SHA-256 相同） |
| 体积 / SHA-256 | **43,012,362 B** / `2132d9c6ae1fdd4d53ace43d38b48635c02428f7e3c60161e793f045e63bcec4` |
| 内嵌二进制 | 130,026,688 B / SHA-256 `f4289fcafa80e25431fcfca73037e7c125d868a83989404d4eefd7d413f0d337`（ELF magic `7f454c46`） |
| 前端产物 | `index-BTIxYAro.js`（1,054,919 B）+ `index-DXQY1OXf.css`（46,486 B）；CSS 与 v1.31.1 **字节级相同**，JS **等长替换**（仅构建期 `__APP_VERSION__` 由 `1.31.1` → `1.32.0`）⇒ 前端逻辑零变化 |
| 包成员 | 5 个：二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`；权限位 `0755`/`0644` 正确，脚本与单元文件**全 LF** |
| 状态 | **未发布**（未上传 GitHub Releases）—— ⚠️ 部署前必须先完成 ECS1 服务端上线 |

### 下一步

- 部署 ECS1（`yanzi/api` 的 `routes.js` / `telemetry.js` / `README.md`）→ 跑 `npm run verify`（应全绿，含第 ⑥ 节）→ 真机点「立即上报」核对服务端 `telemetry-samples/` 原始报文含 `event:"report"` + `install` → ✅ **v1.32.0 交付包已出**（2026-09-28，⚠️ 服务端上线前勿部署）→ 随下次发布合并 notes。

---

## v1.31.1 — 2026-09-27（**已发布 2026-09-27** · 合并 v1.25.0 → v1.31.1）

> 主题：**修复「OTA 更新完成后页面永不自动刷新」** —— 升级后浏览器停在旧前端 bundle，界面看着仍是「已登录」，但点任何业务功能都 `403`，用户感知为「**更新完成后不会自动退出登录 / 没有回到账号重设页**」。

### 一、根因（两个机制叠加）

**机制 1（设计如此，非缺陷）**：`server/auth.ts` 的会话**跨重启持久化**到 `<data>/sessions.json`，启动时按**原到期时间**恢复（`loadSessions()`）。所以 OTA 的 systemd 重启**不会**让任何人掉线 —— 这是刻意设计（避免重启掉线）。

**机制 2（真缺陷）**：两条更新链路都拿 `fetchAppVersion()`（`/api/system/version`，**需登录**）当作「新进程是否已上线」的判据，而它走的是 `request()` 封装（**非 2xx 会抛异常**）：
- `src/App.tsx` 的 `triggerAutoUpdate()`（自动更新）
- `src/pages/Settings.tsx` 的 `waitForRestartAndReload()`（手动「应用更新」/「应用本地更新包」）

v1.31.0 新增的 `REINIT_REQUIRED` 拦截层把该端点**排除在白名单之外**（`REINIT_ALLOWED_AUTH` 只有 6 个 `/auth/*`）⇒ 升级后（老账号尚未重走账号初始化）该请求**必然返回 `403 REINIT_REQUIRED`** ⇒ 被读成「进程还没起来」⇒

| 链路 | 后果 |
|---|---|
| `App.tsx` | `sawDown` 恒为 true，`reload()` **永不执行** |
| `Settings.tsx` | `.catch()` 分支**无计数**，`setTimeout(tick, 1000)` **无限轮询** |

**机制 3（`App.tsx` 独有）**：`attempts > 40` 的计数**只在 `.then()` 里累加** ⇒ 下载/替换超过 60s（慢速 GitHub 常见）时，**旧进程还活着就把轮询停掉了** ⇒ 即使没有 REINIT 拦截也刷不新。

**后果**：浏览器停在**旧前端 bundle**（v1.30.3 既无 reinit 概念、也无 `auth:reinit-required` 监听），界面看似仍是「已登录」，业务请求全 403。

### 二、修法

新增共享模块 **`src/lib/restart-wait.ts`**（`waitForRestartAndReload()`，约 130 行），把「等重启 → 刷新页面」的判断**与 HTTP 状态码解耦**：

| 探活结果 | 含义 | 动作 |
|---|---|---|
| **`403` + `code === "REINIT_REQUIRED"`** | **新进程铁证**（仅带拦截层的版本才会这么答；旧版本无此逻辑） | **立即刷新** |
| 任意其它响应 | 服务在线（可能是旧进程，也可能是已完成重设的新进程） | 结合阶段判断 |
| 网络错误 / 连接被拒 | 进程未上线（重启窗口内） | 记「已失联」，继续等 |

- 探活用**裸 `fetch`**（不经 `request()` 封装），因此 403/401 都只是「在线」而非异常；且**不派发 `auth:*` 事件**，避免探活干扰鉴权状态机。
- 两阶段判据：① 等旧进程失联 → ② 失联后重新拿到响应即刷新。
- **兜底盲刷**：`blindReloadAfterMs` 参数区分两条链路 ——
  - **手动更新**传 `60_000`：二进制已替换、只剩重启，**刷新是安全的**，宁可多刷一次也不卡死；
  - **自动更新**传 `null`：`applyUpdateApi()` 刚被调用、二进制**可能还在下载**，此刻盲刷会打断下载进度并丢掉随后重启的监听 ⇒ **不盲刷**。
- **总超时** `giveUpAfterMs`（默认 10 分钟）后静默放弃，**绝不无限轮询**。

**接线改动**

- `src/App.tsx`：`triggerAutoUpdate()` 改调用共享实现（`blindReloadAfterMs: null`）；新增 `restartWaitRef` —— 重复触发时先取消上一个等待循环，并在**独立的「仅挂载/卸载」effect** 里清理。⚠️ **不能并进那个依赖 `authState` 的 effect**：升级期间若因 403 切到「账号重新设置」态，该 effect 会重跑并取消等待，反而丢掉刷新。
- `src/pages/Settings.tsx`：删掉本地那份 33 行的旧实现，改调用共享实现（`blindReloadAfterMs: 60_000`），同样加 `restartWaitRef` 并在既有卸载清理里收掉。

**落点（按用户确认的方案）**：**保留会话**，刷新后由 `App.tsx` 启动检测按 `needsReinit && meRes` 进入**「账号重新设置」页**（不强制登出，少输一次旧密码）；普通重启（版本未变）仍不掉线。

### 三、验证

| 项 | 结果 |
|---|---|
| hooks 门禁 `scripts/check-hooks.mjs` | ✅ 0 退出（扫描 **43** 个 tsx/ts） |
| 前端 `tsc --noEmit` | ✅ 0 退出 |
| 账号渲染断言 `check-auth-render.mjs` | ✅ 24/24 PASS |
| 账号接线断言 `check-auth-wiring.mjs` | ✅ 29/29 PASS |
| **重启等待断言 `scripts/check-restart-wait.mjs`（本版新增）** | ✅ **18/18 PASS** |
| **门禁自检**：负向注入 2 处真实回归 | ✅ 均**退出码 1**；注入文件**字节级还原**（SHA-256 比对一致） |

**新增门禁 `check-restart-wait.mjs` 的覆盖**（esbuild 打包纯逻辑模块 → 桩 `fetch` / `window` → 5ms 轮询跑完 6 种探活序列）：

1. **核心回归**：探活得 `403 REINIT_REQUIRED` ⇒ **立即刷新**（旧实现永不刷新），且**首次探测即刷新**；
2. 前两次失联、之后恢复 ⇒ 刷新，且恢复后不再探测；
3. `blindReloadAfterMs: null` + 一直在线 ⇒ **不刷新**（避免打断下载）；
4. `blindReloadAfterMs: 20` + 一直在线 ⇒ **到时兜底刷新**；
5. 一直失联且超过总超时 ⇒ 不刷新、**停止轮询**；
6. 判据精确到 code：**普通 403（非 `REINIT_REQUIRED`）不算「新进程」**；
7. 取消函数生效；**接线契约**（两处调用点均走共享实现、无旧轮询残留、都有 `restartWaitRef`、实现侧用裸 `fetch`）。

**负向自检**：① 摘掉 `restart-wait.ts` 里的 `REINIT_REQUIRED` 识别 ⇒ 门禁退出码 1、**2 条 FAIL**；② 把 `Settings.tsx` 的 `blindReloadAfterMs: 60_000` 改成 `null` ⇒ 退出码 1、**1 条 FAIL**（接线契约断言命中）。两次注入后文件均**按 SHA-256 验证字节级还原**。

**写这个脚本时踩到的自身缺陷（已修正并写入注释）**：等待循环是**全局**的，场景之间若不 `cancel()`，上一个循环会继续调用 `globalThis.fetch`（已被下一场景换成新桩）⇒ **计数串台、3 条用例被误报为 FAIL**。修法是每个场景跑完立即 `cancel()` —— 与「不会失败的检查就是装饰」互补的另一面：**会误报的检查同样不可信**。

### 未完成 / 已知限制

- **★ 本修复无法「自愈」本次 v1.31.0 → v1.31.1 这一次升级**：OTA 替换期间浏览器里跑的是**旧前端**（v1.31.0 那份带缺陷的等待逻辑），所以这次仍需**手动刷新一次页面**（或点任意功能 —— v1.31.0 前端已有 `auth:reinit-required` 监听，会因业务请求 403 切到「账号重新设置」页）。**从 v1.31.1 起的后续升级才会自动刷新**。补充：若账号**已完成重设**（`credentialVersion=2`），新进程的 `/api/system/version` 返回 200，「失联→恢复」判据本就生效，不受此限。
- **未做真机 OTA 复现**（需 Linux 部署 + 老凭据版本账号）：本次结论为**代码级推导 + 桩序列断言**，未走一次真实的「下载 → 替换 → systemd 重启 → 页面刷新」。复现步骤：老账号（`credentialVersion` 缺失）+ 升级到本版 + 点「应用更新」→ 观察 `Network` 中 `/api/system/version` 由 200 变 403、且页面自动刷新进入「账号重新设置」页。
- **重启窗口比轮询间隔短时抓不到「失联」**：若 systemd 重启 < 1s 且**账号已完成重设**（新进程也返回 200），则两条判据都不命中 ⇒ 依赖 `blindReloadAfterMs` 兜底（手动路径 60s 会刷新；**自动路径传 `null`，此场景不会自动刷新**，需手动 F5）。这是刻意取舍：自动路径若盲刷会在下载中途刷新、更容易卡死。
- **刷新后落点是「账号重新设置」页而非登录页**：因会话跨重启保留（按用户确认的方案），若期望「升级即登出」需另加「会话与二进制版本绑定」的服务端兜底，本版不做。
- ~~未发布~~ ✅ **已于 2026-09-27 发布** [Release v1.31.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.31.1)：notes 合并 **v1.25.0 → v1.31.1 共 15 个版本段**（59,222 字符，含升级须知前置块），源码 commit `841770d1b131a28e3d915d7d40c856424fd2da3d`，tag `v1.31.1` 指向同一 commit。

### 交付包（2026-09-27 18:09）

`build-upload/docker-manager-yanzi-linux-x64-v1.31.1.zip` **43,012,286 B**，SHA-256 `a4d2a9b37d0f8d6d20c8f0b1b8c336e6f4e750aed59f003740f21dca7fd9037b`（5 成员；`latest` 别名 `docker-manager-yanzi-linux-x64.zip` 同字节）。内嵌前端 `index-VmWdxDzK.js`（1,054,919 B）+ `index-DXQY1OXf.css`（46,486 B，与上一包同哈希 —— CSS 未变）；二进制 **130,026,688 B**（ELF `7f 45 4c 46` 已校验），SHA-256 `ccadc027e68b2ff0f288ed39d36eaecb7b737f02b65d64445f43078c394e2350`。

**包内产物端到端 15/15 PASS**（起包内 `deploy/linux/bundle.js` + 真实 HTTP）：asset 名与字节数双对齐本地 `dist/`（`index-VmWdxDzK.js` / 1,054,919 B）、缓存头正确（`/` 为 `no-cache, must-revalidate`、hash asset 为 `max-age=3600`）、asset 内含 `blindReloadAfterMs` / `giveUpAfterMs` / `REINIT_REQUIRED` 且**旧轮询残留 0 命中**、未登录守卫 `401`、全新实例 `init-status` 为 `initialized=false / needsReinit=false`。`bundle.js` 自检：含版本号 `1.31.1`、含新 asset 名、**不含**上一包的 `index-DnzIT-rt.js`。

> 上一包 `docker-manager-yanzi-linux-x64-v1.31.0.zip`（43,011,657 B / `52b1bde0…`）**已作废** —— 它不含本次的自动刷新修复。

### 发布记录（2026-09-27）

| 项 | 值 |
|---|---|
| Tag | `v1.31.1` → commit `841770d1b131a28e3d915d7d40c856424fd2da3d`（与源码分支发布点一致） |
| Release | [v1.31.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.31.1)（非 draft / 非 pre / 已设为 **Latest**；target = `main`） |
| assets | `docker-manager-yanzi-linux-x64-v1.31.1.zip`（43,012,286 B，远端 digest `sha256:a4d2a9b37d0f8d6d20c8f0b1b8c336e6f4e750aed59f003740f21dca7fd9037b` **与本地 SHA 完全一致**）、`docker-manager-yanzi-linux-x64.zip`（latest 别名，同字节）、`quick-install.sh`（9,371 B） |
| notes | 合并 **v1.25.0 → v1.31.1 共 15 个版本段**（59,222 字符），含「升级须知」前置块 |
| 通道 | GitHub REST API（本机 `node` 无法 spawn `gh`/`git`，`publish-release.mjs` 已加 `--via-api` 回退） |
| OTA 核验 | `/releases/latest` → `tag_name=v1.31.1`；正则 `/linux-x64.*\.zip$/i` 命中版本化 zip；下载地址 `https://github.com/yanziruxue/docker-manager/releases/download/v1.31.1/docker-manager-yanzi-linux-x64-v1.31.1.zip` |

### 下一步

- ~~发布 GitHub Release~~ ✅ **已完成**（2026-09-27）：notes 合并 v1.25.0 → v1.31.1 共 15 个版本段（`publish-release.mjs --merge-from`），已含「OTA 升级后需重走一次账号初始化」与「本次升级页面不会自动刷新，请手动 F5」两条须知。
- 补 `needsReinit → reinit → 回 login` 的**点击级**运行时回归（建议 `jsdom` 或真实浏览器）。
- （可选）给 `POST /api/auth/login` 加失败限流。

---

## v1.31.0 — 2026-09-27（已随 v1.31.1 发布）

> 主题：**找回码规则改为 18~24 位 + 区分大小写**（撤销 v1.30.3 的「仅 24 位 + `allowLegacy` 放行」临时策略）+ **升级后强制重走账号初始化**（用户名 / 密码 / 找回码）。

### 一、升级后强制重走账号初始化（新功能）

老 `users.json` 没有「凭据版本」概念，本次引入 **`credentialVersion`**（本版本要求 `2`）：

- **`server/users.ts`**：新增 `CREDENTIAL_VERSION = 2`、`UserRecord.credentialVersion` / `credentialUpdatedAt`、`needsReinit(record)`、`requiresAccountReinit()`、`reinitUser(id, input)`（覆盖用户名 / 密码 / 找回码，**保留 `id` 与 `createdAt`**，写版本 2，清 `recoveryLastUsedAt` 解除限流，**不校验旧密码**）；`createUser` 同步写版本号。
- **触发判据**：记录**无 `credentialVersion` 或值 < 2** ⇒ 该账号需重走初始化。

**服务端拦截**（`server/index.ts`）

- 新增 `app.use("/api", …)` 拦截层，**必须注册在 `/api/auth/*` 路由之前**（Express 按注册顺序执行，放后面拦不住 auth 路由 —— 首次实现时踩到的坑）。
- 白名单 `REINIT_ALLOWED_AUTH`：`/auth/init-status`、`/auth/login`、`/auth/logout`、`/auth/me`、`/auth/reinit`、`/auth/reset-by-recovery`；其余（含 `/api/auth/recovery`、`/api/auth/password` 与**全部业务接口**）→ **`403 { code: "REINIT_REQUIRED" }`**。
- 新增 **`POST /api/auth/reinit`**（`requireAuth`）：已重设过则 `409「账号已完成重新设置」`；成功后调 `destroySessionsForUser(userId)` 作废该用户**全部会话** + `destroySession(req, res)`（连当前会话一并作废）⇒ 前端回登录页用新凭据重登。
- `server/auth.ts` 新增 `destroySessionsForUser(userId)`。
- `GET /api/auth/init-status` 补 **`needsReinit`**；`POST /api/auth/login` 补 **`needsReinit`**。

**前端状态机**（`src/App.tsx` / `src/api.ts`）

- `authState` 增 `"reinit"`；启动检测 `init.needsReinit` ⇒ 已登录进 `reinit`、未登录进 `login`。
- `request()` 捕获 `403 + code === "REINIT_REQUIRED"` → `window.dispatchEvent(new Event("auth:reinit-required"))` → App 切 `reinit`（覆盖「已登录状态下被 OTA 升级」的场景）。
- `SetupWizard` 支持 `mode="create" | "reinit"` + `initialUsername`：reinit 模式标题「账号重新设置」+ 琥珀提示条 + 找回码必填 + 按钮「保存并继续」，提交走 `reinitAccount()`。
- `LoginPage` 支持 `notice` 绿色提示条 —— reinit 完成回登录页时显示「账号已重新设置，请用新凭据登录」。

> **安全底线**：reinit 仍需**先以旧凭据登录**（`requireAuth`）。否则任何能访问该实例的人都能直接夺取管理员账号。

### 二、找回码规则：18~24 位、区分大小写（含历史记录兼容）

- **长度**：前端 `RECOVERY_MIN_LENGTH = 18` / `RECOVERY_MAX_LENGTH = 24`，后端 `RECOVERY_MIN_CODE_LENGTH = 18` / `RECOVERY_MAX_CODE_LENGTH = 24`；输入期 `sanitizeRecoveryInput` 即截断到 24。
- **字符集不变**：`[A-Za-z0-9]`，含符号一律 `400「找回码仅支持字母和数字」`。
- **文案统一**为 **「找回码需 18~24 位」**；`GET /api/auth/recovery` 补 `minLength` / `maxLength`（`length` 保留为兼容字段＝上限）。
- **区分大小写**：`normalizeRecoveryCode` 由 `toUpperCase()` 改为 **`trim()`**。
- **撤销 `allowLegacy`**（v1.30.3 引入）：18 位本身已在合法区间内，无需再放宽；四个入口（`init` / `reinit` / `recovery` 设置 / `reset-by-recovery`）共用同一套判定，`RECOVERY_LEGACY_CODE_LENGTH` 常量一并删除。
- **历史记录兼容回退（关键，避免把已设码的用户锁死）**：老记录是「转大写后哈希」，直接改成大小写敏感会让这批用户的找回码彻底失效。新增 `legacyUpperVariants(code)` —— **仅当输入码自身含小写时**返回其大写变体，`verifyRecoveryCode` 依次尝试 `[原样, 大写变体]`。
  - 效果：**老记录**输入小写形式仍可用（回退命中）；**新记录**输入错误大小写**不会被削弱**（大写变体 ≠ 原码 ⇒ 仍 `401`）。

### 三、验证

| 项 | 结果 |
|---|---|
| hooks 门禁 `scripts/check-hooks.mjs` | ✅ 0 退出（扫描 42 个 tsx/ts） |
| 前端 `tsc --noEmit` | ✅ 0 退出 |
| 后端 `tsc -p server/tsconfig.json` | ✅ 0 退出 |
| 老库全链路冒烟 `_reinit_probe.cjs` | ✅ **40/40 PASS** |
| 全新安装路径冒烟 `_fresh_probe.cjs` | ✅ **11/11 PASS** |
| **包内产物端到端冒烟**（起 `deploy/linux/bundle.js` + 真实 HTTP） | ✅ **29/29 PASS** |
| **账号 UI 渲染断言** `scripts/check-auth-render.mjs`（`npm run test:auth`） | ✅ **24/24 PASS**（Node 里 SSR 渲**真身组件** + 正负对照） |
| **账号接线断言** `scripts/check-auth-wiring.mjs`（`npm run test:auth`） | ✅ **29/29 PASS**（TS 编译器 API 结构断言，含**跨文件事件名契约**） |
| **门禁自检**：负向注入 2 处回归（默认 `mode` 改 reinit / 篡改事件名） | ✅ 两个脚本**均退出码 1**；注入文件已**字节级还原**（SHA-256 比对一致） |

**老库冒烟关键用例**：`needsReinit=true` → 业务接口 `403 REINIT_REQUIRED` → 白名单 `/api/auth/me` 200 → reinit 17 / 25 位与含符号分别 `400`、密码过短 `400`、用户名为空 `400` → 合法 20 位混合大小写 `200` → **原会话 A / B 双双 `401`（全部作废）** → `needsReinit=false` → 旧凭据 `401` / 新凭据 `200` → 重复 reinit `409` → `length=24 / minLength=18 / maxLength=24` → **新记录输入全大写、全小写各 `401`，原样大小写 `200`** → `users.json` 保留 `id` / `createdAt`、`credentialVersion=2`、无明文。
**零锁死用例**：库中按**大写**哈希的旧记录，输入**小写**形式 → `200`（回退命中）。
**全新安装冒烟**：`initialized=false` 且 `needsReinit=false`（拦截不误伤首次部署）、`init` 17 / 25 位各 `400`、24 位 `200`、建号后业务接口非 403、`createUser` 写 `credentialVersion=2`。

### 四、文档同步

| 文件 | 变更 |
|---|---|
| `docs/用户登录与密码找回方案.md` | **新增第三部分「账号重新初始化」**（§19 背景 / §20 服务端 / §21 前端）；§5 拆 4 小节（新增 §5.1 拦截层，含**注册顺序硬要求**）；§6 状态机改五态；§7 接口表加 `reinit` 并新增 §7.4；§8 改「账号设置向导」两模式对照；§11 重写（新增 §11.1 大小写语义与回退、§11.3 规则演进史）；**新增 §17.4「账号 UI 接线断言」**（做法表 + 负向自检表 + 覆盖边界诚实声明）；§18 把「浏览器端 UI 回归未做」精确化为「**状态迁移的运行时回归未做**」 |
| `docs/项目文件目录说明.md` | §2 / §3 同步 10 个改动文件的行数与描述；**§4 新增三行 `check-hooks.mjs`(153) / `check-auth-render.mjs`(157) / `check-auth-wiring.mjs`(277)**；§1 `package.json` 补 `lint:hooks` / `test:auth`；**§9 新增「`test:auth` 不挂构建链、`lint:hooks` 反之」**；文档版本行由陈旧的 `v1.15.1` 改为「增量维护至 v1.31.0」 |
| `docs/CHANGELOG.md` | 本段 |

> `docs/` 不在交付包成员内（包成员固定 5 个：二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`）⇒ **不影响已出的 v1.31.0 包**，无需重新出包。

### 未完成 / 已知限制

- **真实浏览器交互回归仍未做**（但前端接线已从「零验证」提升为「可执行断言」）：`agent-browser` 拉起的 Chromium 启动时会去连 **`clients2.google.com`**（组件更新 / 网络时间 / 域名可靠性上报）——**该域在国内不可达**，且 WorkBuddy 沙箱会拦截并询问，询问期间整条命令被 `SIGTERM`，故上一次浏览器验证被中断。
  **本次新增 `npm run test:auth`（零新依赖、零外网）作为替代**：`scripts/check-auth-render.mjs` 用**已在装的 esbuild** 打包临时入口 → Node 里 `react-dom/server` 渲染**真身组件**，断言 `mode="create"|"reinit"` 的标题/按钮/提示条/hint 必填性/用户名预填/计数器、`LoginPage` 传与不传 `notice` 的正负对照、以及**渲染期零网络请求**（24 项）；`scripts/check-auth-wiring.mjs` 用 **TS 编译器 API** 断言 `authState` 五态联合、`mode="reinit"` 的 `SetupWizard` 接线（含 `initialUsername` / `onDone=handleReinitDone`）、`handleReinitDone` 回 `login` 而非 `authed`、`handleAuthDone` 按 `needsReinit` 分流、`403+REINIT_REQUIRED` 的派发位置、**派发端与监听端事件名一致且无孤儿事件**、`mode` 缺省值为 `create`、`notice` 可选并透传、找回码常量 `18/24`（29 项）。
  **两个脚本都做了负向自检**（注入回归 → 退出码 1 → 字节级还原），避免「不会失败的检查＝装饰」。
  ⚠️ **能覆盖**：组件接线、文案、常量、分支存在性与顺序。⚠️ **不能覆盖**：状态**迁移**（无 DOM 环境，无法触发点击）—— 故 `needsReinit → reinit → 回 login` 的运行时迁移仍建议后续补一次真实浏览器或 `jsdom` 回归。
  ⚠️ 未把 `test:auth` 挂进 `build:frontend`：它是**本版特性**的作用域检查（若将来重新设计 reinit，断言需同步改），挂进常驻构建链会变成长期摩擦；故以独立脚本暴露，靠 CHANGELOG / 文档提醒执行。
- **OTA 升级用户首次打开会被强制重走「用户名 + 密码 + 找回码」**（设计如此）⇒ 必须写进 Release notes 提示。
- 升级后**老记录的回退仅在「全小写输入」时命中**；**混合大小写输入无法回退**（老逻辑只存了大写形式，原始大小写无从还原）。

### 交付包（2026-09-27 17:18）

`build-upload/docker-manager-yanzi-linux-x64-v1.31.0.zip` **43,011,657 B**，SHA-256 `52b1bde0b22fea3c136c6dbd3ebb0efeabb7d2347c3aba3ce1dfdf67dd4fa868`（5 成员；`latest` 别名同字节）。内嵌前端 `index-DnzIT-rt.js`（1,054,253 B）+ `index-DXQY1OXf.css`；二进制 130,026,688 B（ELF 已校验），SHA-256 `2938d6f760da08462f213cda3dfbfecd02aec8d00714ec3e48f6c29c7bc8ab4a`。

**包内产物端到端 29/29 PASS**：asset 名与字节数双对齐本地 `dist/`、缓存头正确、新旧文案正负命中、全新安装不误伤、找回码 17/18/25 位与符号、`minLength/maxLength` 字段、**大小写敏感三连（全大写 401 / 全小写 401 / 原样 200）**、`credentialVersion=2` 落盘。`bundle.js` 内 `allowLegacy` 与 `RECOVERY_LEGACY_CODE_LENGTH` 均已消失。

> **本包仍为当前交付物，无需重新出包**：本次后续新增的 `scripts/check-auth-render.mjs` / `scripts/check-auth-wiring.mjs` 与 `package.json` 的 `test:auth` 脚本**都不进交付物**（`scripts/` 不入 bundle；`build-binary.mjs` 只从 `package.json` 读 `version`，未变）。
> 已用**重构建逐字节比对**证明：以当前源码重新 `vite build` 到临时目录，`index.html` / `index-DnzIT-rt.js` / `index-DXQY1OXf.css` 三者 SHA-256 与 `dist/` **完全一致** ⇒ 生产代码零改动，前端产物零漂移。

### 下一步

- **发布 GitHub Release**：合并 v1.25.0 → v1.31.0 的 notes（脚本只提取当前 TAG 一段），并在 notes 里**明确提示「OTA 升级后需重走一次账号初始化」**。
- 补**状态迁移**的运行时回归（`needsReinit → reinit → 回 login` 的点击级验证）：本轮已用 `npm run test:auth` 覆盖「组件接线 + 文案 + 常量 + 分支存在性」，但无 DOM 环境无法触发交互，建议后续用 `jsdom` 或真实浏览器补一次。
- 考虑给 `POST /api/auth/login` 加失败限流（§18 已知限制，与本次改动无关）。

---

## v1.30.3 — 2026-09-27（已随 v1.31.1 发布）

> 主题：**密码找回码长度 18 → 24 位**（仍为「仅字母和数字、忽略大小写」）+ **旧 18 位码兼容策略**（重置入口放行，零锁死）。

### 一、长度提升 18 → 24（`src/lib/recovery-code.ts`、`server/users.ts`）

- 前端 `RECOVERY_LENGTH`、后端 `RECOVERY_CODE_LENGTH` 由 `18` 改为 **`24`**。
- 三处界面文案（`LoginPage` / `SetupWizard` / `Settings`）与 `n/N` 计数器**全部走模板常量**，自动跟随，无需单独改。

### 二、旧码兼容（关键，避免把已设旧码的用户锁死）

`POST /api/auth/reset-by-recovery` 的处理顺序是**先格式校验、再比对哈希**。若三处入口一律强制 24 位，
历史上已设 18 位码的用户一旦忘记密码，会被 `400「找回码必须满 24 位」` 挡在自救通道之外 —— 等于永久锁死。

因此新增 **`allowLegacy` 开关**：

| 入口 | 长度要求 |
|---|---|
| `POST /api/auth/init`（首次建号带码） | **仅 24 位** |
| `POST /api/auth/recovery`（设置 / 重设） | **仅 24 位** |
| `POST /api/auth/reset-by-recovery`（用码重置密码） | **24 位 或历史 18 位**（`validateRecoveryCode(code, true)`） |

- 前端 `validateRecoveryCode(v, allowLegacy = false)` 同步加参；`LoginPage` 的 `RecoveryForm` 传 `true`，
  `SetupWizard` / `Settings` 用默认值（严格）。
- 放宽**仅在长度**：字符集仍强制 `[A-Za-z0-9]`（含符号的旧码照旧 `400`）；
  **哈希比对与 10 分钟限流不受影响**（校验不过仍 `401`、超频仍 `429`）。
- 登录页找回表单加一行小字提示「历史 18 位找回码仍可使用」。
- ⚠️ 旧码**不会自动迁移**（库里只有 scrypt 哈希，物理上无法知道原码）；用户在「系统设置 → 用户 → 密码找回码」重设一次即为 24 位。

### 三、文档

- `docs/用户登录与密码找回方案.md`：全文 18 → 24（规则表、校验顺序、代码片段、流程、测试用例表）；
  新增 **§11.3 长度升级与旧码兼容**；测试表补 4 条兼容用例；`文档适用版本` 补 v1.30.3。
- `docs/项目文件目录说明.md`：`SetupWizard.tsx` / `recovery-code.ts` 描述与行数同步。
- **新增 `docs/上报触发与接口及上报内容.md`**（**纯文档，无代码改动**）：把 v1.29.0 起的上报子系统一次性写清 ——
  触发时机全表（安装·重装 / 启动·重启 30 秒后 / 每 12 小时 / 失败 10 分钟重试 / 开关切换瞬间 / 设置页读取的副作用）、
  事件选择规则（`install` 优先、一次最多发一个）、时间常量表、定时器状态机、
  上传开关的三条行为（含「切换瞬间固定发 install+active 且绕过守卫」）、
  **对远端上报接口**（端点 / `X-Telemetry-Key` / 10s 超时 / 401·403 不重试）与**本机 REST 接口**
  （`/api/telemetry/status`、`/api/telemetry/report`、`PUT /api/settings` 联动；`/api/telemetry/stats` 已删 404）、
  **载荷 16 字段字典**（含 `hardware` 6 维与 `details` 5 组逐字段采集来源）、
  统计主键 6 维 sha256 与虚拟化归零、标识文件「写一次 + 自愈校验」（btime vs mtime、2s 容差、只比 mtime、24h 限流、**必须 tmp+rename**）、
  容错与失败分类、**排查手册**（含「代理伪造 502」判据与「端点 NXDOMAIN 属预期」）、已知限制（含开关关闭后 10 分钟空转、`POST /api/telemetry/report` 前端未接线）。

### 涉及文件

`src/lib/recovery-code.ts`、`server/users.ts`、`server/index.ts`、`src/components/auth/LoginPage.tsx`、`package.json`（version → 1.30.3）、`docs/用户登录与密码找回方案.md`、`docs/项目文件目录说明.md`、`docs/上报触发与接口及上报内容.md`（新增）、本文件。

### 如何验证

- hooks 门禁 + 前后端 `tsc --noEmit` 全绿。
- **隔离单测 32/32 通过**（esbuild 打包前后端两份 `validateRecoveryCode` 同进程对比）：常量值；设置入口 24 通过 / 18 与 23 被拒 / 25 位前端截断通过；重置入口 24 与 18 通过、20 与 19 被拒；清洗（剔符号 / 截断 / 保大小写）；后端 trim 与大小写不参与判定；前后端在长度 ≤ 24 时判定与文案一致，并显式断言两处「既有设计差异」（前端输入期清洗截断、后端校验原始值）。
- **真实服务端冒烟 21/21 通过**（`tsx server/index.ts` + 临时 `DATA_DIR/CONFIG_DIR/LOG_DIR` + 独立端口）：init 带 24 位码 200；`GET /auth/recovery` 返回 `length: 24`；**设置入口** 18 位 → `400 必须满 24 位`、23 位 → 400、小写 24 位 → 200、当前密码错 → 400；**重置入口** 23 位 → 400、**18 位 → 401（而非 400，证明格式已放行）**、24 位正确码 → 200、立即复用 → 429、改后新密码可登录；**核心兼容用例**：直接把 `users.json` 的哈希换成 18 位码的 scrypt 值（模拟历史记录）→ 用该 18 位码重置 **200**，小写形式在冷却中返回 429（证明格式与大小写均已通过）；`users.json` 无任何明文码。

### 交付包（本轮已出包 · 已随 v1.31.1 发布）

- `build-upload/docker-manager-yanzi-linux-x64-v1.30.3.zip` **43,009,477 B**，
  SHA-256 `81f44f2ab9dcc8b1b7e9987ca7da3eb45270e9e83af94e3c95c8d10d498b093b`（5 成员；`latest` 别名
  `docker-manager-yanzi-linux-x64.zip` **同字节**、SHA 一致）。
- 内嵌前端 `index-DTZwuIZz.js`（1,031,860 B）+ `index-DXQY1OXf.css`；二进制 **130,026,688 B**
  （ELF magic `7f 45 4c 46` 已校验），二进制 SHA-256 `234df32ad36d363a28814ec1338391bbee1058ad8c3f1fd1402f69e0c55b00f4`。
- **端到端（最强证据，13/13 PASS）**：直接起 `deploy/linux/bundle.js` 产物（临时 `DATA_DIR/CONFIG_DIR/LOG_DIR` + 独立端口）——
  ① `GET /` 实际下发的 asset 名与 `dist/assets/` **完全一致**（`index-DTZwuIZz.js` / `index-DXQY1OXf.css`，字节数相同）、
  下发 JS 含新提示「历史 18 位找回码仍可使用」；② **找回码规则全链路**：`init` 带 24 位码 → 200、
  `GET /api/auth/recovery` 返回 **`length: 24`**、**设置入口 18 位 → 400「找回码必须满 24 位」**、
  **重置入口 18 位 → 401（而非 400，证明格式已放行）**、重置入口 24 位 → 200、
  **★ 把 `users.json` 哈希换成 18 位码的 scrypt 值后，用该 18 位码重置 → 200（零锁死兼容）**、
  重置后新密码可登录；③ `users.json` 无任何明文码。
- ⚠️ **本包取代同日 v1.30.2 / v1.30.1 包**（`be77bdea…` / `b18dba14…`，**均已作废**）——本包在 v1.30.2 基础上再改找回码长度，前端资产哈希已变（`index-DFTUNF1u.js` → `index-DTZwuIZz.js`）。
- 📄 本版段的 `docs/上报触发与接口及上报内容.md` 为**纯文档新增**，`docs/` **不在交付包成员内**（包成员固定 5 个：二进制 + `install.sh` + `uninstall.sh` + `.service` + `README.md`）⇒ **不影响本包，无需重新出包**。

### 未完成 / 已知限制

- 旧 18 位码无自动迁移（见上）；`RECOVERY_LEGACY_CODE_LENGTH` 属**过渡期常量**，未来可评估移除。

### 下一步

- 若确认不再需要兼容旧码，可把 `allowLegacy` 分支与 `RECOVERY_LEGACY_*` 常量一并删除（同时更新 §11.3）。

---

## v1.30.2 — 2026-09-27（已随 v1.31.1 发布）

> 主题：**补齐 v1.30.0 未落地的两条规范**（去引号 / 空集合紧凑）+ 新增 **`docs/编码规范compose.md`** 规范文档。
> 背景：编写规范文档时对「格式化」做隔离实测，发现 ① §1.4「端口无需引号」**并未实现**（`- '8080:80'` 格式化后原样保留引号）；② §2.2 相关的**空集合**被 `forceBlockStyle` 误展开成两行（`data: {}` → `data:` + `    {}`）。经确认后一并修正。

### 一、列表去引号（`src/components/YamlEditor.tsx`，§1.4）

- 新增 `unquoteListScalars()`，作用于 `ports` / `expose` / `environment` / `env_file` / `volumes` / `devices` / `tmpfs` / `labels` 的**列表项**，把引号标量改为纯量：`- '8080:80'` → `- 8080:80`。
- **安全判据＝逐值回验**（新增 `plainSafeString()`）：把引号内容当纯量**重新解析一次**，必须仍为**同一个字符串**才去引号。因此自动挡下：
  - `"123"` → 会被解析成数字 `123` ⇒ **保留引号**；
  - `'true'` → 布尔 ⇒ **保留引号**；`"1.0"` 同理；
  - `"[::1]:8080:80"` → 以 `[` 开头、纯量形式不合法 ⇒ **保留引号**；
  - 含 `: ` 或 ` #` 的值 ⇒ **保留引号**。
- 只处理**值**、不动键；非标量列表项（`- {a: b}`）跳过。

### 二、空集合保持紧凑（同文件，§2.2）

- `forceBlockStyle()` 改为**只对非空集合**置 `flow=false`；空 `{}` / `[]` 不再被展开成两行。

### 三、新增规范文档 `docs/编码规范compose.md`

把《YAML 编码规范 · Docker Compose 专用》固化为项目文档，并把「规范」与「实现」写在一起：

- §1~§4：缩进（2 空格/级，三级节点绝对 4 空格）/ 键值对 / 注释 / 引号 / 数组 / 顶层与服务内排序（**附权重表**）/ 禁止清单；
- §5：**规范化管线**（6 步）＋ 去引号**作用范围与安全边界表** ＋ 关键性质表；
- §6：与实现的**已知限制**（块首注释位置、`environment` map↔`- K=V` 不互转）＋ v1.30.2 已修正差异的回看记录；
- §7：提交前自检清单；附录 A：格式化前后对照（**实测输出**）；附录 B：本地自测方法与三个坑。

### 涉及文件

`src/components/YamlEditor.tsx`、`package.json`（version → 1.30.2）、`docs/编码规范compose.md`（新增）、`docs/项目文件目录说明.md`（§6 表补 3 条）、本文件。

### 如何验证

- hooks 门禁 + 前后端 `tsc --noEmit` 全绿。
- **修复隔离单测 20/20 通过**：去引号（单/双引号端口、`environment`、`volumes`）✓；危险值保留引号（`"123"` / `'true'` / `"[::1]:8080:80"`）✓；`8080:80/udp` 可去引号 ✓；空 map / 空 seq 保持紧凑 ✓；4 组**语义等价（键序无关深比）** ✓；4 组**幂等** ✓；非法 YAML 原样返回 ✓。
- **文档自校验 11/11 通过**：脚本抽取 `docs/编码规范compose.md` 内全部 ```` ```yaml ```` 块 → 逐个 `js-yaml.load` ＋ 断言 `formatComposeYaml(block) === block`。其中 **附录 A 的「输出」示例与格式化器真实产出逐字节一致**；6 个规范性示例全部「已符合规范」；反例块（§1.2 错误写法 / §2.2 行内数组）如预期会被格式化改动。

### 交付包（本轮已出包 · 已随 v1.31.1 发布）

- `build-upload/docker-manager-yanzi-linux-x64-v1.30.2.zip` **43,009,268 B**，
  SHA-256 `be77bdeab728a9a4967efec4acaa4181b01052fb24aff6038a91e09c9b029d0c`（5 成员；`latest` 别名
  `docker-manager-yanzi-linux-x64.zip` **同字节**、SHA 一致）。
- 内嵌前端 `index-DFTUNF1u.js`（1,052,288 B）+ `index-DXQY1OXf.css`；二进制 **130,026,688 B**
  （ELF magic `7f 45 4c 46` 已校验），二进制 SHA-256 `6e06cca180f0291ff60a7a7d2f49ffe06b3877b7074db084462b3ab8baa8c1ee`。
- 包内校验：`bundle.js` 含 `1.30.2` / `deviceFile` / `collectHardwareDetails` / `DEVICE_FILE` /
  `reportOnToggle` / `yanzi-docker/event` / `X-Telemetry-Key`，且引用 `index-DFTUNF1u.js` 与
  `index-DXQY1OXf.css`；base64 段解码后含 **`QUOTE_SINGLE` / `QUOTE_DOUBLE`**（＝本次新增的去引号代码）
  与格式化按钮新 title，旧文案 0 命中。
- **端到端（最强证据）**：起 bundle 服务 `GET /` 实际下发的 asset 名与 `dist/assets/` **完全一致**
  （`index-DFTUNF1u.js`，字节数同为 1,052,288）、`/` 下发 `no-cache, must-revalidate`；拉该 asset 复核
  **`QUOTE_SINGLE` ×5 / `QUOTE_DOUBLE` ×8**（新代码确在包内）、新文案 1、旧文案 0。
- ⚠️ **本包取代同日 v1.30.1 包**（`b18dba14…`，**已作废**）——该包不含本次两项规范修正。

### 未完成 / 已知限制

- 去引号只覆盖上述 8 个列表键的**列表项**；`environment` 以 **map 写法**（`FOO: bar`）书写的值时不做处理。
- 其余限制同 v1.30.0 / v1.30.1（块首注释位置、`environment` 写法不互转）。

### 下一步

- 如需扩展到 map 值或更多键，可在同一管线内补白名单。

---

## v1.30.1 — 2026-09-27（已随 v1.31.1 发布）

> 主题：**安装数量上报载荷补全**（与本机设备卡片逐项对齐）+ 卡片文案调整。

### 一、上报载荷补全（`server/telemetry.ts` 的 `buildPayload`）

「系统设置 → 本机设备」卡片展示的 13 项此前**并非全部上报**——缺「标识文件 / 主板型号 / 产品序列号 / 系统UUID / CPU / GPU / 内存 / 硬盘 明细」。现全部并入载荷（新增字段以**粗体**标出）：

| 卡片项 | 载荷字段 |
|---|---|
| 运行环境 | `virtualized` |
| 应用版本 | `appVersion` |
| 架构 | `arch` |
| 系统 | `osVersion`（+ `os`） |
| 标识文件 | **`deviceFile`（新增）** |
| 主板 | `hardware.boardSerial` |
| 主板型号 | **`details.dmi.boardName`（新增）** |
| 产品序列号 | **`details.dmi.productSerial`（新增）** |
| 系统UUID | **`details.dmi.productUuid`（新增）** |
| CPU | **`details.cpu`（新增：model / cores / threads / freqGHz）** |
| GPU | **`details.gpu`（新增：model / memory）** |
| 内存 | **`details.memory`（新增：model / sizeGB）** |
| 硬盘 | **`details.disk`（新增：serial / model / size）** |

- 新增 `deviceFile` 与 `details`（复用既有 `collectHardwareDetails()`）；`details` 与硬件字段同受 `collectHw` 开关控制。
- 仍然**不含容器 / 镜像 / 堆栈等任何业务数据，也不含账号信息**。

### 二、卡片文案调整（`src/components/ActivityPanel.tsx`）

- 「仅上传本机**设备信息（硬件指纹、系统版本、应用版本）**用于安装数量收集」→ **「仅上传本机应用安装信息用于安装数量收集」**（后续「不含容器 / 镜像 / 堆栈…也不含账号信息。默认开启，可随时关闭；关闭后不再发送任何数据。」**保持不变**）。

### 涉及文件

`server/telemetry.ts`、`src/components/ActivityPanel.tsx`、`package.json`（version → 1.30.1）、本文件。

### 如何验证

- hooks 门禁 + 前后端 `tsc --noEmit` 全绿。
- **载荷隔离实测**（esbuild 打包 `telemetry.ts` + 桩 `fetch` + 临时 `CONFIG_DIR`）：打印真实上报 JSON，断言 13 项对应字段（含 `deviceFile`、`details.dmi.{boardName,productSerial,productUuid}`、`details.{cpu,gpu,memory,disk}`）**全部存在**；请求 URL / `Content-Type` / `X-Telemetry-Key` 均正确。

### 交付包（本轮已出包 · 已随 v1.31.1 发布）

- **⛔ 本包已作废**（同日 v1.30.2 包取代）：不含 v1.30.2 的两项规范修正（列表去引号、空集合紧凑），**勿再部署**。
- 本包**合并 v1.30.0 + v1.30.1 两项改动**（v1.30.0 引入前端依赖 `yaml@2`，故必须整链路重建）。
- `build-upload/docker-manager-yanzi-linux-x64-v1.30.1.zip` **43,008,983 B**，
  SHA-256 `b18dba145720fa1bb27b59e04a1827e89010260fcbfede797724ff120b030b4f`（5 成员；`latest` 别名
  `docker-manager-yanzi-linux-x64.zip` **同字节**、SHA 一致）。
- 内嵌前端 `index-DP_7QR3z.js`（1,051,545 B）+ `index-DXQY1OXf.css`；二进制 **130,026,688 B**
  （较上版 129,895,616 B 增大 ≈131 KB，即新增的 `yaml@2` 体积；ELF magic `7f 45 4c 46` 已校验），
  二进制 SHA-256 `9112ce47ff8886520661a0b4880f59fc9568bc1428b7abec26dd1505d01c644a`。
- 包内校验：`bundle.js` 含 `1.30.1` / `deviceFile` / `collectHardwareDetails` / `DEVICE_FILE` /
  `reportOnToggle` / `yanzi-docker/event` / `X-Telemetry-Key` / `fix-perms`，且引用 `index-DP_7QR3z.js`
  与 `index-DXQY1OXf.css`；长 base64 段解码后**新文案命中、旧文案 0 命中**、格式化按钮新 title 命中。
- **端到端（最强证据）**：起 bundle 服务 `GET /` 实际下发的 asset 名与 `dist/assets/` **完全一致**
  （`index-DP_7QR3z.js`，字节数同为 1,051,545）、`/` 下发 `no-cache, must-revalidate`；拉该 asset
  复核「仅上传本机应用安装信息用于安装数量收集」命中 1、「仅上传本机设备信息」0、「格式化 YAML（2 空格缩进」命中 1。

### 未完成 / 已知限制

- 非 Linux 或非 root 环境下 `details` 与部分硬件维度可能为空串（`lspci` / `dmidecode` / `lsblk` 缺失，或 DMI 权限 0400）——属既有行为，服务端需容忍空值。
- **Compose 格式化不做 `environment` 的 map ↔ `- K=V` 互转**（防注释错位，见 v1.30.0 段）。

### 下一步

- 远端接口开放后核对新增字段的落库与展示。
- 待确认后发 GitHub Release（需把 v1.29.0 / v1.30.0 / v1.30.1 三段 notes 合并）。

## v1.30.0 — 2026-09-27（已随 v1.31.1 发布）

> 主题：**Compose 编辑器「格式化」升级为「规范对齐 + 保留注释」**（对齐《YAML 编码规范 · Docker Compose 专用》）。

### 一、YAML 编辑器「格式化」（`src/components/YamlEditor.tsx`）

原实现用 js-yaml `load → dump`，**会丢弃全部注释**，且把纯标量序列**折叠成行内 `[a, b]`**、服务参数保持原顺序——与规范 §3.1（推荐多行连字符写法）/ §5.5（禁单文件混用两种数组写法）/ §4.2（参数固定排序）直接冲突。现改用 **`yaml`(eemeli) 文档模型**做**保注释往返**，只做三件事再序列化：

| 规范条目 | 改造后行为 |
|---|---|
| §2.1 / §2.2 缩进与键值 | 2 空格缩进、`key: value` 冒号后 1 空格（由序列化器保证） |
| §3.1 / §3.2 / §5.5 数组 | 所有 map / seq 节点 `flow = false` ⇒ **一律块状 `- `**，消除行内数组与「混用」 |
| §4.2 服务内排序 | 网络(`network_mode`/`networks`) > 重启(`restart`) > 容器信息(`container_name`/`hostname`) > 端口(`ports`/`expose`) > 环境变量(`environment`/`env_file`) > 数据挂载(`volumes`) > 其余参数 > **镜像(`image` 置末)** |
| §4.1 顶层顺序 | `services` → `volumes` → `networks` → 其余（`version` / `x-*` **保留**，仅排序，不删） |
| §2.3 注释 | **全程保留**（整行注释随属主节点一起移动、行尾注释随本行） |

- 格式化逻辑提炼为**可导出的纯函数 `formatComposeYaml(value)`**（无 React / CSS 依赖，便于复用与单测）；组件内「格式化」按钮改为一行调用。
- 保留「扁平无缩进（全顶格）输入先走 `autoIndentYaml` 启发式补缩进」的既有能力；**非法 YAML 原样返回**（不破坏内容）。
- **不做** `environment` map ↔ `- K=V` 互转（保持用户原写法，避免注释错位）。
- ⚠️ 已知行为：块**首键**前的整行注释会被 `yaml` 视为「块级注释」留在块顶（保留不丢，位置固定在块顶）。

### 二、同源产出对齐（§4.2）

- `src/lib/compose-convert.ts`（docker run → compose）：服务参数按 §4.2 装配，**`image` 由「首行」改为「末行」**。
- `src/pages/Stacks.tsx`：新建堆栈默认模板与两处编辑器占位符改为 `restart > ports > image` 顺序。

### 依赖

- 新增前端依赖 **`yaml@^2.9.1`**（注释保留往返）；前端 bundle 由 933KB → 1031KB（min，约 +98KB）。

### 涉及文件

`src/components/YamlEditor.tsx`、`src/lib/compose-convert.ts`、`src/pages/Stacks.tsx`、`package.json`（+`yaml`、`version` → 1.30.0）、`docs/编码规范compose.md`（**规范落地文档**：把本版实现对齐的规范条目 + 排序权重表 + 管线说明 + **与实现的已知差异** + 自检清单固化为项目文档）、本文件。

### 如何验证

- hooks 门禁 + 前后端 `tsc --noEmit` 全绿；`vite build` 成功。
- **格式化隔离单测**（esbuild 打包 `formatComposeYaml`，**9 组断言全过**）：① 顶层排序 §4.1；② 行内数组消除 §3.1/§5.5；③ 整行 + 行尾注释保留 §2.3；④ 服务内排序 `restart>ports>environment>image` §4.2；⑤ 幂等（再次格式化不变）；⑥ `image` 置末；⑦ 全顶格输入补缩进；⑧ 非法 YAML 原样返回；⑨ 已规范内容稳定不变。
- **转换器单测**：`docker run -d --name web -p 8080:80 -p 443:443 -e FOO=bar -v /data:/data --restart unless-stopped nginx:alpine` → 输出键序 `restart > container_name > ports > environment > volumes > image`（image 最末）+ 块状数组。

### 未完成 / 已知限制

- 块首键前的整行注释固定留在块顶（见上）；`environment` 不做 map ↔ 数组互转。

### 下一步

- 如需保留「锚点 / 别名」或自定义排序规则，可在同一条管线（`formatComposeYaml`）内扩展。

## v1.29.0 — 2026-09-26（已随 v1.31.1 发布）

> 主题：**安装量 / 活跃度上报模型重构**（对接新接口契约）+ **设备标识文件「写一次 + 自愈校验」** + **上传开关**。

### 一、上报接口与周期（对接新契约）

| 项 | 旧（v1.28.0） | 新（v1.29.0） |
|---|---|---|
| 端点 | `https://docker-yanzi.ziruxue.top` | **`https://yanzi-api.ziruxue.top`**（可用环境变量 `TELEMETRY_ENDPOINT` 覆盖） |
| 路径 | `/api/telemetry/event` | **`/api/yanzi-docker/event`** |
| 鉴权 | 无 | **`X-Telemetry-Key: <设备标识>`**（＝6 维硬件指纹哈希） |
| 周期 | 启动后 30 秒首报 + 每 30 分钟心跳（`active` 走 **UTC 日粒度去重**） | **安装 / 重装 + 每次启动或重启 + 每 12 小时** |
| 事件 | `install` / `active`（日粒度去重） | `install`（新装 / 重装 / 标识文件重建）/ `active`（启动、重启、12 小时周期） |
| 失败处理 | 只记 `lastError`，等下次 30 分钟心跳 | **10 分钟退避重试**（网络 / 5xx）；**401 / 403 不做密集重试**，等下一个 12 小时周期 |
| 载荷 | 硬件 6 维 + 系统信息 + 应用版本 | 同上 **+ `installedAt`**（安装时间＝标识文件创建时间）；**不含任何业务数据**（容器 / 镜像 / 堆栈计数一律不上报） |
| 聚合查询 | `GET /api/telemetry/stats`（后端代理远端，**前端从未接线**＝死代码） | **删除**（路由 + `src/api.ts` 的 `fetchTelemetryStats` / `TelemetryStats` 一并移除） |

### 二、设备标识文件：写一次 + 自愈校验

- 落点从 `/etc/docker-manager-yanzi/device.info` 改为 **`<安装目录>/config/device.info`**（随数据盘持久化）；不再有「`/etc` 是否可写」的探测与双路径逻辑（`DEVICE_FILE_GLOBAL` / `tryWrite` / `resolveDeviceFile()` 全部移除）。
- **身份与运行态拆开**（这是「写一次」的前提）：
  - `config/device.info`（标识文件）＝ `deviceId` / `createdAt`（≈安装时间）/ `virtualized` / `hardware`（安装时快照），**只在创建时写一次，之后纯只读**；
  - `config/telemetry-state.json`（新增·运行态）＝ `installReported` / `lastReportAt` / `lastActiveAt` / `lastRebuildAt` / `lastError`，每次上报后写 —— **不参与标识文件校验**。
  - 正面副作用：上报状态不再写进标识文件 ⇒ **删除 / 重建标识文件不会再让 install 反复上报**；老配置里的 `installReported` 会在首次读取时**迁移**到运行态文件（避免存量部署升级后被误判为「首次安装」）。
- **自愈校验**：重装 / 更新后启动时比较**创建时间（btime）与修改时间（mtime）**——一致 → 不做任何修改；不一致（或文件被删）→ **重新生成标识文件**（`deviceId` 按当前硬件指纹重算、安装时间取当下）。
  - 只比 `mtime`、**不比 `ctime`** ⇒ `chmod` / `chown`（安装脚本改权限）不会误触发重建；
  - 容差 **2 秒**（创建本身是 create + write 两个动作，可能跨秒）；`btime` 不可用（部分文件系统）→ **跳过校验**，宁可放过不误重建；
  - **限流**：距上次重建不足 24 小时的**照常重建，但不重报 install**（防被外部脚本反复改写把统计端安装量刷爆）；限流窗口不因被限流的重建而顺延。
- ⚠️ **踩坑（本次最关键）**：重建**不能直接覆写已有文件** —— 覆写复用旧 inode，其**创建时间保持为最初时刻**（Linux ext4 / Windows 均如此）⇒ 刚重建出来的文件立刻又满足「mtime > btime」→ 每次调用都重建、`createdAt` 每次都变。改为**先写 `device.info.tmp` → `renameSync` 原子替换**（rename 带上临时文件自己的 btime），`btime === mtime` 才成立。
- 标识文件权限 `0600`（`chmod` 只动 ctime，不影响判据）；写入只此一处。

### 三、上传开关（系统设置 → 本机设备）

- 新增开关 **「上传安装数量统计」**，**默认开启**，可随时关闭；关闭后**不再发送任何请求**（`reportOnce` 直接返回「上传已关闭」）。
- 持久化在 `settings.json` 的 `telemetry.enabled`（`server/settings.ts` 的 `DEFAULT_SETTINGS` + 二级合并）→ **随「APPLY 保存设置」生效、随备份恢复**；顺带修掉旧 `readConfig()` 恒返回默认值（改不了地址、关不掉遥测）的问题。
- 卡片写明用途：**仅上传本机设备信息（硬件指纹、系统版本、应用版本）用于安装数量收集，不含容器 / 镜像 / 堆栈等业务数据，也不含账号信息**。
- 卡片上报状态**只保留「安装时间」一行**（**按用户要求已依次移除**：「下次上报」「上报地址」「上次上报」三行、「上报时机：安装 / 重装时一次，之后每次启动或重启、并每 12 小时一次；失败 10 分钟后重试。」说明段，以及「最近一次上报未成功…（接口未就绪 / 无外网时属正常，会自动重试）」失败块——`nextReportAt` / `endpoint` / `reportIntervalHours` / `lastReportAt` / `lastError` 字段仍在 `GET /api/telemetry/status` 返回值中，只是不再渲染，**保留接口契约**）；`GET /api/telemetry/status` 新增 `enabled` / `endpoint` / `reportIntervalHours` / `installReported` / `lastReportAt` / `lastActiveAt` / `nextReportAt` / `lastError` / `stateFile`，`hardware` 改为**实时采集值**（标识文件里保留的是安装时快照）。
- **「安装时间」的定义**：＝标识文件 `config/device.info` 的**创建时刻**（首次生成该文件的时间，ISO 8601），写入 `DeviceInfo.createdAt`；文件校验通过时**原样沿用**（即最初安装时刻），重装 / 重建后取当下时间。它同时作为上报载荷的 `installedAt`。卡片用 `status.createdAt` 按浏览器本地时区格式化显示。
- **开关变更即上报（开启与关闭都触发）**：`PUT /api/settings` 保存前取旧 `telemetry.enabled`、保存后取新值，**两者不一致**则在响应前 `void reportOnToggle(nextEnabled)` 异步触发一次上报（不阻塞响应、失败只写 `lastError`）。`reportOnToggle` 不论开启或关闭都**同时上报 `install` 与 `active`**（发 `install` 必带 `active`），并让载荷携带 **`uploadEnabled`** 字段（＝本次开关新值），使服务端可记录本机最新 opt-in 状态；关闭方向用 `{ ...readConfig(), enabled: true }` 绕过 `reportOnce` 的「上传已关闭」提前返回，保证「关掉上传」仍会把最后状态透出。

### 涉及文件

`server/telemetry.ts`（上报模型重写 + `reportOnToggle` 新增）、`server/settings.ts`（`telemetry.enabled` 默认值 + 二级合并）、`server/index.ts`（删 `/api/telemetry/stats` + `PUT /api/settings` 开关变更触发 `reportOnToggle`）、`src/api.ts`（`TelemetryStatus` 扩字段、删统计接口）、`src/types.ts`（`SystemSettings.telemetry` + `TelemetryConfig`）、`src/components/ActivityPanel.tsx`（开关 + 上报状态展示）、`src/pages/Settings.tsx`（默认值 + 传参）、`package.json`（→ 1.29.0）、本文件。

### 如何验证（隔离实测 · Node 22 · 2026-09-26）

用 esbuild 打包 `server/telemetry.ts`（补 `--define:__APP_VERSION__`）并**桩掉 `globalThis.fetch`**，以临时 `CONFIG_DIR` 跑（不依赖远端接口）：

1. 首次上报 → 生成标识文件 + 发 `install`，且 `btime === mtime` 成立；
2. 连续调用 `getTelemetryStatus()` → **标识文件时间戳完全不变**（纯只读，不再「每次调用都写回」）；
3. 周期内 `reportOnce()` → **不发请求**；`reportOnce(true)`（进程启动语义）→ 发 `active`；
4. 跨过 2 秒容差改写文件 → **重建**且 24 小时内**不重报 install**；再改一次 → 仍重建、仍不重报；
5. 删除文件 → **立即重建**（不受限流）；把 `lastRebuildAt` 推到 25 小时前再删 → **重建 + 发 install**，且 `installedAt` ＝ 新 `createdAt`；
6. **关闭开关** → `reportOnce(true)` **不发任何请求**，返回「上传已关闭」；
7. **报文核对**：URL ＝ `https://yanzi-api.ziruxue.top/api/yanzi-docker/event`、`X-Telemetry-Key` ＝ `deviceId`、body 含 `installedAt`、**无任何业务字段**；
7b. **开关变更即上报**：`reportOnToggle(true)`（开启）→ 依次发 `install` + `active`、body 均含 `uploadEnabled: true`；`reportOnToggle(false)`（关闭）→ 绕过「上传已关闭」、**同样**发 `install` + `active`、body 均含 `uploadEnabled: false`；两次均只产生 2 次 fetch 调用（顺序 install→active），`GET /api/telemetry/status` 的 `lastError` 仅在 fetch 失败时写入；`PUT /api/settings` 在 `telemetry.enabled` 前后值不一致时才调用 `reportOnToggle`（一致时不发额外请求）。
8. **老版本部署模拟**（旧 `device.info` 混存运行态 + `mtime ≠ btime`）→ 重建 + 发一次 `install`，运行态正确迁移到新文件；
9. `startTelemetryHeartbeat()` 后进程可正常退出（定时器 `unref`）；
10. `scripts/check-hooks.mjs` + 前后端 `tsc --noEmit` 全绿。

**前端卡片浏览器实测**（vite dev `:8093` + 临时预览入口，mock 掉 `/api/telemetry/status` 与 `/api/system/service-unit`；**验完即删临时文件**）：`#root` 非白屏、`window.__errs` 为 **0**；页面上**「下次上报」「上报地址」「上次上报」「从未成功上报」「最近一次上报未成功」「接口未就绪」「会自动重试」全部不存在**（`false`），「安装时间」「上传安装数量统计」「不含容器 / 镜像 / 堆栈等任何业务数据」均在位、上传开关为**开启态**；**`?err=1`（后端返回 `lastError: "fetch failed"`）时失败块仍不渲染**（`.border-amber-200` 元素数 **0**、页面文字不含 `fetch failed`）。截图留存 `.workbuddy/artifacts/v1.29.0-device-panel.png`（最终形态）与 `v1.29.0-device-panel-lasterror.png`（lastError 有值时的形态，可见仍无失败提示）。

### 未完成 / 已知限制

- **远端接口暂未开放**：`yanzi-api.ziruxue.top` 目前 **NXDOMAIN**（DNS 未配解析，非本机出口问题），**无法端到端联调**，只验证到「报文正确发出」。上报失败属预期：卡片显示「最近一次上报未成功」并按 10 分钟重试。
- **升级会产生一次「重装」事件**：老版本 `device.info` 因旧逻辑「每次心跳都写回」必然 `mtime ≠ btime`，升级后首启会判定为被改写 → 重新生成标识文件并上报一次 `install`（`installedAt` 更新为升级时刻）。属**一次性**行为。
- 虚拟化环境（容器 / VM）六维指纹仍全归零 ⇒ 同镜像实例**共用同一 deviceId**（旧设计遗留，本次未改）；`system` 维度含内核版本，但标识文件已改为「写一次」，**内核升级不再换 ID**（只在重建时才重算指纹）。
- 重建限流只作用于「是否上报 install」；被限流期间文件仍会重建。

### 下一步

- 远端接口开放后做一次真机联调（核对 `X-Telemetry-Key` 鉴权与「最后活跃时间」刷新）；
- 中心统计服务另行建设；若要区分虚拟化实例，再调整指纹维度（会改变存量 deviceId，需谨慎）。

## v1.28.0 — 2026-09-25（已随 v1.31.1 发布）

> 两项仪表盘能力：**磁盘曲线**（读写速率 + 利用率双轴）+ **曲线悬停取值**（四个磁贴共享）。
> 均为 Minor（新增可视化能力），无破坏性改动。

### ✅ 已完成

#### ① 磁盘磁贴新增「读写速率 + 利用率」双轴曲线

- **后端**（`server/docker.ts`）：`ResourceSample` 增加 `disks?: Record<string, { read: number; write: number; busy: number }>`
  （`read` / `write` 单位 MB/s，`busy` 为利用率百分比）。采样时**直接复用同一帧已算好的 `disks`**，
  **刻意不重调 `sampleHostDisks()`** —— 该函数内部会写「上次采样」快照以做差分，二次调用会把时间基准挪到
  采样间隔中间，导致**下一帧速率虚高**（与 v1.27.0 `listNetInterfaces` 不复用 `sampleHostNetIfaces` 同坑）。
  磁盘为空时字段不下发（`undefined`），远程引擎天然缺省。
- **前端类型**（`src/types.ts`）：`ResourceSample` 同步加 `disks?`（与后端同构）。
- **前端**（`src/pages/Dashboard.tsx`）：`DiskTile` 入参新增 `history`；把原「利用率表」降为**可折叠区**，
  在其**下方**（`Tile` 的 `persistent.bottom` 插槽）新增常驻曲线小节：
  - 三条序列：**读速率**（蓝，带面积）/ **写速率**（橙，带面积）/ **平均利用率**（绿，虚线）；
  - **双 Y 轴**：速率（MB/s）走左轴、利用率（%）走右轴并固定 `yMaxRight={100}`；
    量纲不同必须各自定标，否则利用率会被速率的量级压成贴底直线；
  - 形态**与处理器曲线完全一致**：常驻显示、自带折叠开关（`dm.tile.disk.chart`，默认展开），
    时间范围下拉复用同一个 `RangeSelect`（`dm.chart.disk.range`）；
  - 速率格式化 `fmtDiskRate()`：≥1 MB/s 显示 MB/s，小值退化到 KB/s（避免出现 `0.03 MB/s` 这种读数）；
  - 无磁盘数据且历史也无样本时，不渲染曲线小节（不占位）。
- **调用点**：`<DiskTile stats={resourceStats} history={history} />`（两处 → 实际为同一渲染分支）。

#### ② 四处曲线统一支持「悬停取值」

- **`src/components/LineChart.tsx`**：
  - 新增 props：`labels?: string[]`（每点的横轴标签，用于提示框首行时间）、
    `formatValue?: (value, series) => string`（按序列/轴格式化数值）、
    `yMaxRight?` / `formatMaxRight?`（右轴定标与刻度文案）；
  - `LineSeries` 增加 `axis?: "left" | "right"`，左右轴各自求最大值（`maxOf()`），互不干扰；
  - 悬停交互：`onMouseMove` 按**容器宽度比例**换算索引（svg 用 `preserveAspectRatio="none"` 横向拉伸，
    不能按 viewBox 坐标算）；`hoverIdx` / `hoverRatio` / `tipFlip`（> 0.55 时提示框向左翻，避免溢出右边界）；
  - **游标竖线**画在 viewBox 内（竖线方向不受横向拉伸影响，加 `vectorEffect="non-scaling-stroke"` 保证 1px）；
  - **圆点与提示框放在 HTML 层用百分比定位**（`left: ratio%`、`top: y/VB_H%`）——
    viewBox 内的圆会被非等比缩放拉成椭圆，必须落在 HTML 层；
  - 提示框内容：首行**时间标签**（`labels[hoverIdx]`，缺省回退「第 N 点」）+ 每个序列一行
    （色点 + 名称 + `formatValue` 数值）。
- **四个磁贴全部接入**（`Dashboard.tsx`）：处理器 / 内存 / 网络 / 磁盘的 `LineChart` 均传
  `labels={clockLabels(pts)}` 与各自的 `formatValue`；新增 `fmtClock()` / `clockLabels()` 从样本 `ts` 取时间标签。

### 验证

- **编译门禁**：`node scripts/check-hooks.mjs` ✅（扫描 42 个文件 0 命中）、
  后端 `tsc -p server/tsconfig.json --noEmit` ✅、前端 `tsc --noEmit -p tsconfig.json` ✅。
- **真实鼠标悬停实测**（页面级预览入口 + agent-browser，**真实 CDP 鼠标**而非合成事件）：
  高视口 1400×2400 让曲线进入可视区后 `mouse move` 到磁盘曲线 62% 处，读数
  `{tipFound:true, tipLeft:"62.069%", lines:["22:30:28","读速率","87 MB/s","写速率","39 MB/s","利用率","33.6%"], crosshair:1, dots:3}`，
  `window.__errs` 为空。**证明**：时间标签正确、三序列各自按轴格式化、提示框按 >55% 翻边、
  游标 1 条、圆点 3 个（= 序列数）。
  - 排查记录：首轮 `hover` 不触发是因为**磁盘曲线在 1100 视口下位于 y=1408（视口外）**，真实鼠标够不到
    —— 属测试环境假象；后续另一次 `dots:0` 是**我脚本选择器写成 `div` 而圆点实际是 `span`**，同样非产品缺陷。
    两次都是**测试脚本的问题**，修正后全绿（这类「先怀疑代码、实际错在测试」的误判值得记一笔）。
  - 另注意：预览入口里曲线索引与磁贴不一一对应（1400px 宽下为 2 列档，磁盘落到列 1），
    定位目标图表要**按容器实际归属**去找，别按列编排硬编码索引。

### 未完成 / 已知限制

- **发布**：已并入 [v1.31.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.31.1)（2026-09-27）发布；当时未单独推源码 / 建 Release。
- 磁盘曲线仅覆盖**本机（socket 引擎）**：远程 TCP/SSH 引擎不采 `/proc/diskstats`，曲线小节自动不渲染。
- 悬停取值依赖鼠标事件，**触屏设备无对应交互**（未做长按/点击取值）。

### 下一步

- ~~发布时…~~ ✅ 已随 [v1.31.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.31.1) 发布（notes 实际合并 v1.25.0 → v1.31.1 共 15 段）。

---

## v1.27.2 — 2026-09-25（已随 v1.31.1 发布）

> 🚨 **P0 回归修复：登录后白屏** —— v1.27.1 引入的 React Hooks 调用顺序违规。

### 🐞 缺陷与根因

- **现象**（用户线上部署 v1.27.1 后）：登录页正常，**一进主界面整页白屏**（`192.168.24.16:5024` 只剩空白）。
- **先排除的项**：`GET /` = 200（482 B）、`/assets/index-NezwHrp_.js` = 200（947,139 B）、`/assets/index-MBxwDWR1.css` = 200、`/docker.png` = 200，且 `/` 下发 `no-cache, must-revalidate`、hash asset 下发 `public, max-age=3600` —— **不是静态资源 404、不是缓存问题**。
- **根因**：`src/pages/Dashboard.tsx` 新增的两个 `useMinWidth()` hook 被写在了**提前 return 之后**：
  ```tsx
  if (loading && containers.length === 0) return <LoadingState .../>;  // ← 首次渲染走这里
  if (error) return <ErrorState .../>;
  const threeCol = useMinWidth(1800);   // ← hook 在 return 之后，违规
  const twoCol = useMinWidth(1024);
  ```
  首次渲染 `loading=true`（`App.tsx` 正在拉数据）→ 只调用 `useState` / `useEffect` **2 个 hook**；数据到达后 `loading=false` → 这一次要多调 2 个 → React 抛
  `Rendered more hooks than during the previous render` 并**卸载整棵树** → `#root` 为空 = 白屏。
  （`dataLoading` 初值 `false`、拉数据时置 `true`，所以**只要加载状态切换一次就必然触发**。）
- **浏览器实测证据**（A/B 对照见下）：缺陷版实捕到
  `Warning: React has detected a change in the order of Hooks called by Dashboard` +
  `Uncaught Error: Rendered more hooks than during the previous render`，且 `#root.innerHTML.length === 0`。

### ✅ 已完成

- `src/pages/Dashboard.tsx`：把 `threeCol` / `twoCol` / `mergeIo` **移到提前 return 之前**，并在原位写明「hook 必须在提前 return 之前」的原因（防止再改回去）。
- **新增门禁 `scripts/check-hooks.mjs`**（本项目没有 eslint）：用 TypeScript 编译器 API 做 AST 扫描，报两类违规——
  - **A**：某个 hook 调用之前存在「可能提前退出的 `return`」（return 可嵌在 `if` / `switch` / `try` 里；**必须逐个 hook 比对**，只比「首个 hook vs 首个 return」会漏报——本次真实缺陷正是「前面的 hook 在 return 前、后面的 hook 在 return 后」这种形状）；
  - **B**：hook 位于条件分支 / 逻辑表达式 / 循环体内。
  已接入 `npm run lint:hooks`，并**挂在 `npm run build:frontend` 之前**（违规即中止构建，退出码 1）。
  有效性用**已知违规样本反向验证**过：A / B 两类都能命中；修复后的源码扫描 42 个文件 0 命中。

### 验证（A/B 浏览器实测 · 页面级预览入口）

关键改进：预览入口**必须复现 `loading=true（列表为空）→ loading=false（数据到达）` 的状态切换**。
v1.27.1 当初漏掉这个 P0，就是因为 mock 直接给了非空数据、`loading` 又没传（falsy）→ 提前 return 分支从未走过 → hook 数始终一致。

| 组 | 代码状态 | `window.__phase` | `#root.innerHTML.length` | 捕获到的错误 |
|---|---|---|---|---|
| **A（缺陷放回）** | hook 在 return 之后 | `loaded` | **0**（白屏） | `change in the order of Hooks called by Dashboard` + `Rendered more hooks than during the previous render` |
| **B（修复后）** | hook 移到 return 之前 | `loaded` | **31778** | **0 条** |

- B 组同时断言：列元素 **2**（1440px 属 2 列档）、磁贴 **8** 个、`整体负载` / 网络 / 磁盘 / 系统概览 文案全部在。
- ⚠️ 首轮 B 组残留 1 条 `Each child in a list should have a unique "key"` —— 排查确认是**我的 mock 字段名写错**（`DiskStat` 实际为 `name / readMBps / writeMBps / busyPct / active`，我写成了 `device / size / utilization / …`，导致 `key={d.name}` 为 `undefined`），**非产品缺陷**；修正 mock 后 `errs: 0`。
- `scripts/check-hooks.mjs` 扫描 42 文件 0 命中；前端 `tsc --noEmit` 0。

### 📦 打包与冒烟（21:53）

- 产物：`build-upload/docker-manager-yanzi-linux-x64-v1.27.2.zip` **42,960,127 B**，SHA-256 `c620d4ba87373e05698d0839999a9222b209e9939564a4d92f0a6de244729142`（5 成员；`latest` 别名 `docker-manager-yanzi-linux-x64.zip` 同字节）。
- 内嵌前端 `index-DHivVXy8.js` + `index-MBxwDWR1.css`；二进制 129,895,616 B，ELF magic `7f 45 4c 46` 已校验；`bundle.js` 自检 `has 1.27.2: true`。
- 包内校验（比假造静态服务更硬）：**`dist/` 全部 4 个文件以 base64 形式在 `bundle.js` 中逐字节命中（4/4）**；内嵌 `index.html` 引用的 asset 名与 `dist/assets/` 实际文件名完全一致。

### 未完成 / 已知限制

- **v1.27.1 是坏的**：已部署 v1.27.1 的实例会白屏。**不要部署 v1.27.1**，请直接上 v1.27.2（或回退 v1.27.0 —— v1.27.0 没有这两个 hook，只是保留了折叠重排缺陷）。
- **发布**：已并入 [v1.31.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.31.1)（2026-09-27）发布；当时未单独推源码 / 建 Release。

### 下一步

- ✅ 已随 [v1.31.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.31.1) 发布（2026-09-27）。

---

## v1.27.1 — 2026-09-25（已随 v1.31.1 发布 · **线上白屏事故 · 已被 v1.27.2 取代，勿部署**）

> ⚠️ 本版**把线上界面打挂过**（登录后白屏，React Hooks 调用顺序违规），修复见上方 v1.27.2。
> 本版对「折叠重排」缺陷的修复本身有效，已保留在 v1.27.2 中。

> 缺陷修复（仪表盘布局）：**折叠磁贴后，下方的磁贴不会上移**——2 列档左列空出一大片。

### 🐞 缺陷与根因

- **现象**（用户在 1320px 窗口的截图）：折叠左列「系统概览 / 处理器 / 内存」后，「网络 / 磁盘」两个磁贴**停在左下角不动**，左列上方留出约 400 CSS px 空白。
- **根因**：`TileGrid` 在 `lg` 断点只有 **2 列**，而 `Dashboard` 传了 **3 个列元素** → 第 3 列（网络 / 磁盘）被折到**第 2 行第 1 格**。栅格**行高 = 该行最高单元**，第 1 行的高度由第 2 列（容器 / 堆栈 / 镜像）决定；折叠第 1 列的磁贴只让本列变矮，**第 2 行纹丝不动**，于是表现为「下方的磁贴不上移」。
- 纯 CSS 解决不了：断点能改 `grid-cols-*`，但**改不了子元素个数**，必须按断点重组「哪几个磁贴放进哪一列」。

### ✅ 已完成

- `src/components/TileGrid.tsx`：新增并导出 **`useMinWidth(px)`**（`matchMedia` 的 JS 版，含 resize 监听，首帧同步取值避免闪断），并在文档注释里写清「**列元素个数不能超过当前列数**」这条不变量。
- `src/pages/Dashboard.tsx`：按断点决定列的构成——
  - **≥1800px（3 列）**：`[系统概览, 处理器, 内存] / [容器, 堆栈, 镜像] / [网络, 磁盘]`（与改动前完全一致）；
  - **1024–1799px（2 列）**：`[系统概览, 处理器, 内存, 磁盘] / [容器, 堆栈, 镜像, 网络]`——**不再换行**，磁盘 / 网络落进列内参与重排（磁盘属系统、网络属容器流量，两列高度也更接近）；
  - **<1024px（单列）**：仍传 3 个列元素，各占一行、行内只有一格 → 堆叠后**保持原有顺序**。

### 验证（页面级预览 + agent-browser，三档断点实测）

| 视口 | 列元素 | 各列标题 | 磁盘列 | 网络列 | 磁盘/网络重复数 |
|---|---|---|---|---|---|
| 1920 | 3 | `[系统概览,处理器,内存] [容器,堆栈,镜像] [网络,磁盘]` | 2 | 2 | 1 / 1 |
| 1320 | 2 | `[系统概览,处理器,内存,磁盘] [容器,堆栈,镜像,网络]` | 0 | 1 | 1 / 1 |
| 900 | 3（单列堆叠） | 同 1920，顺序不变 | 2 | 2 | 1 / 1 |

- **折叠重排实测（1320px）**：折叠「处理器」后 `磁盘` 的 `getBoundingClientRect().top` 由 **1169 → 1062**（**上移 107px**），内容高度 1376 → 1269；按钮 `aria-expanded` 变 `false`，`dm.tile.cpu.collapsed` 持久化为 `"1"`。
- 前后端 `tsc --noEmit` 均 0；`agent-browser errors` 为空。

### 📦 打包与冒烟（21:36）

- 产物：`build-upload/docker-manager-yanzi-linux-x64-v1.27.1.zip` **42,959,903 B**，SHA-256 `c9cfefc461c95b62b11102f300d1651dfcaf336b29767c3c670888c76d72b291`（5 成员：二进制 129,895,616 B + `install.sh` / `uninstall.sh` / `.service` / `README.md`，权限位 0o755 / 0o644 已核对）；`latest` 别名 `docker-manager-yanzi-linux-x64.zip` 同字节。
- 内嵌前端 `index-NezwHrp_.js` + `index-MBxwDWR1.css`；二进制 ELF magic `7f 45 4c 46` 已校验。
- 冒烟 @5025（直接跑 `deploy/linux/bundle.js`）：启动打印 `📦 二进制模式：从嵌入式数据托管前端 (4 文件)`；`GET /` 引用的 asset 名与本地 `dist/assets/` **完全一致**；`/` 下发 `Cache-Control: no-cache, must-revalidate`、hash asset 下发 `public, max-age=3600`；**从服务端拉取的 asset 内含 `min-width: `（2 处）与 `matchMedia`（7 处）** —— 证明修复真进了交付包，而不只是进了本地 `dist`。
- `bundle.js` 内嵌 dist 文件名与本地一致；前后端 `tsc --noEmit` 均 0。

### 未完成 / 已知限制

- 列与列之间**不共享内容高度**：某列明显较矮时其下方仍有空白（栅格固有行为，Unraid 同）。本次靠「磁盘归系统列、网络归应用列」让两列更接近。
- **发布**：已并入 [v1.31.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.31.1)（2026-09-27）发布；当时未单独推源码 / 建 Release。`build-upload/` 里 v1.25.0 ~ v1.27.0 五个旧包仍保留（内容均为旧版本），发布时应只发 v1.27.1。

### 下一步

- ✅ 已随 [v1.31.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.31.1) 发布（2026-09-27）；v1.27.1 本身因白屏事故**未单独发布**。

---

## v1.27.0 — 2026-09-25（已随 v1.31.1 发布）

> 仪表盘五项改动：① **镜像磁贴移到第 2 列**（堆栈下方）；② 容器磁贴标题「Docker 容器」→「**容器**」；③ **网络曲线可按网口 / Docker 虚拟网卡选择**（新功能，含后端按网口采样）；④ 系统概览新增「**正常运行时间**」；⑤ 处理器磁贴**折叠后仍显示整体负载**，整体负载曲线可折叠后单独显示。

### ✅ 已完成

- **布局：镜像移到第 2 列（堆栈正下方）**（`src/pages/Dashboard.tsx`）
  - `TileGrid` 的第 2 列由「容器 / 堆栈」变为「**容器 / 堆栈 / 镜像**」，第 3 列由「镜像 / 网络 / 磁盘」变为「**网络 / 磁盘**」。
- **文案：磁贴标题「Docker 容器」→「容器」**（`src/pages/Dashboard.tsx`）
  - 仅改磁贴标题；侧栏「容器管理」、`pageTitles` 等其余位置未动。
- **新功能：网络曲线可按网口 / Docker 虚拟网卡选择**（后端 + 前端）
  - 后端 `server/docker.ts`：新增 `readNetDevBytes()`（解析 `/proc/net/dev` → 网口名 → 自开机累计字节）与 `sampleHostNetIfaces()`（与上次采样**差分**算 KB/s），过滤 `lo` 与 `veth*`（每容器一对的管道端口，数量多且无法稳定命名）；
  - 覆盖范围：**物理网口**（`eth0` / `enp1s0` / `bond0`…）**+ Docker 在本机建的网桥虚拟网卡**（`docker0` / `br-<网络 ID 前 12 位>`）；新增 `listNetInterfaces()` 用 `listNetworks()` 把网桥映射回「网络管理」页里的**网络名**（如 `iotdb-net (bridge)`）；只有 **bridge 驱动**会留下本机网桥接口，overlay / macvlan / host 网络不产生独立网口 → 不在列表中。
  - `ResourceSample` 增加 `netIfaces`（`{网口名: {rx, tx}}`，远程引擎缺省）；`EngineResourceStats` 增加 `netIfaces`（当前值）与 `hostUptimeSec`。
  - 新接口 **`GET /api/engines/:id/net-interfaces`** → `[{ name, label, kind: "host" | "docker" }]`；前端 `fetchNetInterfacesApi()`。
  - 前端 `NetTile`：磁贴头新增**网口下拉**（`全部（容器合计）` / `网口` 分组 / `Docker 虚拟网卡` 分组），与时间范围下拉并列；选择**按磁贴持久化**（`dm.chart.network.iface`）；进页面拉一次列表、之后每 60s 刷新；**选中的网口若已不存在则自动回落到「全部」**。
  - **零回归**：默认项「全部（容器合计）」就是改动前的合计口径（`netRxKBps` / `netTxKBps`），不选网口时曲线与副标题与 v1.26.2 完全一致。
  - ⚠️ **`listNetInterfaces` 刻意不复用 `sampleHostNetIfaces`**：后者会写差分快照，若被列表接口顺手调用，会把时间基准挪到 SSE 采样间隔中间，导致下一帧速率虚高。
- **系统概览新增「正常运行时间」**（`server/docker.ts` + `src/pages/Dashboard.tsx`）
  - 后端 `readHostUptimeSec()` 读 `/proc/uptime` 首列；`EngineResourceStats.hostUptimeSec`（远程引擎 / 非 Linux → 0）。
  - 前端 `fmtUptime()` 输出「3 天 7 小时 50 分」，在信息栅格中**单独占满一行**（`col-span-2`，避免 6 项变 7 项时最后一行只剩半格）；取不到值显示「—」。
- **处理器磁贴：折叠后仍显示整体负载，曲线可单独显示**（`src/components/Tile.tsx` + `src/pages/Dashboard.tsx`）
  - `Tile` 新增 `persistent?: { top?, bottom? }` 插槽：`top` 渲染在可折叠区**之前**、`bottom` 在其**之后**，两者都**不受磁贴折叠状态影响**。
  - `CpuTile` 改造为：`persistent.top` = **整体负载横条**；`persistent.bottom` = **整体负载曲线小节**（保留自己的折叠开关 `dm.tile.cpu.chart`）；可折叠区只剩**各物理核明细**。
  - 效果：折叠处理器磁贴 → 仍能看到「整体负载 26%」横条，且曲线可单独展开/收起；展开时顺序不变（整体负载 → 各核 → 曲线）。
- **验证**（前后端 `tsc --noEmit` 均 0 + 页面级预览入口 / agent-browser 单条命令链）
  - mock：4 核、`cpuPercent 26`、`hostUptimeSec 287400`、三个网口（`eth0` / `docker0` / `br-1a2b3c4d5e6f`），打桩 `/resource-history` 与 `/net-interfaces`。
  - 断言实测：三列 h3 分别为 `[系统概览,处理器,内存] / [容器,堆栈,镜像] / [网络,磁盘]`；系统概览出现 `正常运行时间 3 天 7 小时 50 分`；网口下拉 `optgroup` = `[网口, Docker 虚拟网卡]`、选项 = `[全部（容器合计）, eth0, bridge (bridge), iotdb-net (bridge)]`；
  - **折叠处理器磁贴**后：按钮变「展开」，`整体负载` 横条仍在、`整体负载曲线` 仍在、`cpu0` 各行消失；
  - **网口切到 `eth0`** 后：副标题由合计 `下行 712 KB/s · 上行 208 KB/s` 变为 `下行 387 KB/s · 上行 105 KB/s`（eth0 值）；
  - `agent-browser errors` 为空。

### 📦 打包与冒烟（17:12）

- 产物：`build-upload/docker-manager-yanzi-linux-x64-v1.27.0.zip` **42,959,803 B**，SHA-256 `f2a7834e5bdf29c3dc39b6f0961a98947d02904d57ef78507934b4cedce55ba2`（5 成员，权限位 0o755/0o644 已核对；`latest` 别名同字节）。
- 内嵌前端 `index-CM9gDGp0.js` + `index-MBxwDWR1.css`；二进制 129,895,616 B，ELF magic `7f 45 4c 46`；`bundle.js` 内含 `1.27.0` 与 `index-CM9gDGp0.js`。
- 产物文案自检：`正常运行时间` / `整体负载曲线` / `Docker 虚拟网卡` / `全部（容器合计）` 均命中，旧文案 `Docker 容器` **0 命中**。
- 冒烟（跑 `bundle.js` @5025，临时 DATA_DIR/CONFIG_DIR/LOG_DIR）：`GET /` 引用的 asset 名与本地 `dist/assets/` **完全一致**；`/` 响应头 `Cache-Control: no-cache, must-revalidate`；服务端 asset 命中 `正常运行时间`（1）/ `Docker 虚拟网卡`（2）/ `Docker 容器`（0）；`bundle.js` 内 `net-interfaces` / `listNetInterfaces` / `readHostUptimeSec` / `netIfaces` / `hostUptimeSec` / `sampleHostNetIfaces` 全部存在；测完临时文件与 `/tmp/smoke` 已删，5025 / 5199 均无监听。
- 清理：顺手删掉了早前误建的仓库根文件 `--full-page`（`agent-browser screenshot <path> --full-page` 把参数当路径吃掉的产物，正确参数是 `--full`/`-f`）。

### ⚠️ 未完成 / 已知限制

- **网口数据仅本机 socket 引擎有**：远程引擎（tcp / ssh）读不到对端 `/proc/net/dev`，接口列表为空 → 下拉里只剩「全部（容器合计）」，行为退回改动前。
- 选择器只列 **bridge 驱动**对应的本机网桥（`docker0` / `br-xxxx`）；overlay / macvlan / host 网络没有独立本机网口，无法按网络维度出曲线。
- `veth*` 与 `lo` 被刻意过滤（前者每容器一对、无稳定可读标签）。
- 处理器折叠后目前只收起「各核明细」——若后续还想折叠得更多，需要再拆 `persistent` 的粒度。
- 其余同 v1.26.x：卡片列表未限高、不支持拖拽/移除、子表「强制更新」为未接线占位。

### 下一步

- 发布时把 v1.26.0 / v1.26.1 / v1.26.2 视为**已被本版取代**（不单独发 Release），只发 v1.27.0 并在 notes 里合并说明。

---

## v1.26.2 — 2026-09-25（已随 v1.31.1 发布 · 已被 v1.27.0 取代）

> 对「处理器 / 内存」两个磁贴的**指标口径**做统一：处理器副标题由「合计 26% / 400%」改为「**整体负载 26% / 100%**」并让整体负载曲线量程固定 0–100%；内存曲线量程钉在「共多少」（已安装总量），副标题补「剩余 x.x GB」，删掉「最大支持大小 / 已安装大小 / 空闲」一行。

### ✅ 已完成

- **处理器磁贴：口径由「总容量」改为「整体负载 0–100%」**（`src/pages/Dashboard.tsx`）
  - 副标题 `合计 N% / {ncpu×100}%` → **`整体负载 N% / 100%`**；横条变量改名 `overallPct = clamp(stats.cpuPercent, 0, 100)`，不再引用 `cpuMaxPercent` / `ncpu × 100` 的总容量分母（`cpuPercent` 本身就是「运行容器 CPU 合计占整机容量」的 0–100 百分比，无需再除以核数）。
  - 「整体负载曲线」`<LineChart>` 增加 **`yMax={100}`**，纵轴恒为 `100% / 0`，与副标题「/ 100%」同一口径，也对齐用户提供的 Unraid 参考图（纵轴固定 100% / 0%）。
  - 横条标签「总体负载」统一为「**整体负载**」。
- **内存磁贴：量程钉在已安装总量 + 补「剩余」，删冗余行**（`src/pages/Dashboard.tsx`）
  - 副标题 `已用 2.0 GB / 共 3.8 GB` → **`已用 2.0 GB / 共 3.8 GB · 剩余 1.8 GB`**（`memFreeMB > 0` 时才追加，取不到空闲值时不显示，避免出现「剩余 0 B」的误导）。
  - `<LineChart>` 增加 **`yMax={installed}`**（`memInstalledMB || memTotalMB`）：两条曲线的纵轴上限即「共多少」，系统占用 / Docker 占用可直接与总内存对比读数。
  - **删除**「最大支持大小：— / 已安装大小：3.8 GB / 空闲：2.3 GB」整块（原来 3 行摘要 + 分隔线）；`memMaxSupportedMB`（SMBIOS Type16，非 root 多为 0）**前端不再使用**，接口字段保留未动（保 API 契约）。
  - 曲线图例（系统占用 / Docker 占用）与横条对比关系不变，只是上限由「自动量程」变为「已安装总量」。
- **验证**（`tsc --noEmit` + 页面级预览入口 / agent-browser 单条命令链，mock `ncpu:4 / cpuPercent:26 / memInstalledMB:3891 / memFreeMB:1843`）
  - `document.body.innerText` 实测：`整体负载 26% / 100%`、`已用 2.0 GB / 共 3.8 GB · 剩余 1.8 GB`；处理器曲线右上角刻度 **`100%`**、内存曲线右上角 **`3.8 GB`**（下限均为 `0`）。
  - 反例断言：`innerText.includes('最大支持大小') === false`、`includes('已安装大小') === false`、`includes('空闲') === false`。
  - 前端 `tsc --noEmit` 退出码 0；`memMaxSupportedMB` 全仓库仅剩 `src/types.ts`（类型定义）引用。

### ⚠️ 未完成 / 已知限制

- 低负载时曲线（0–100% 量程）会贴底——这是与副标题口径一致、且对齐 Unraid 参考图的**有意取舍**，不是缺陷。
- 其余同 v1.26.0 / v1.26.1：卡片列表未限高、不支持拖拽/移除、子表「强制更新」为未接线占位。
- 本机无 Docker（`connect ENOENT //./pipe/docker_engine`），以上均为 mock 数据下的页面级验证；真实引擎数据下的观感待生产确认。

### 下一步

- 发布时把 v1.26.0 / v1.26.1 视为**已被本版取代**（不单独发 Release），只发 v1.26.2 并在 notes 里合并说明。

---

## v1.26.1 — 2026-09-25（已随 v1.31.1 发布 · 已被 v1.26.2 取代）

> 对 v1.26.0 卡片化改动的两处调整：① 卡片**只有图标可点** —— 名称 / 状态行 / 右侧计数 / 空白一律无动作（去掉整卡跳转与 hover 暗示）；② **Docker 容器磁贴移除 4 条状态进度条**（数量信息本就在磁贴摘要与筛选条上）。

### ✅ 已完成

- **卡片非图标区不再响应点击**（`src/components/NodeCard.tsx`、`src/pages/Dashboard.tsx`）
  - 移除 `NodeCard` 的 `onCardClick` prop 及 `cursor-pointer` / `hover:border-slate-300` / `hover:bg-slate-50` 样式，卡片外壳回归纯展示 `div`；两处调用点（容器卡跳「容器管理」、堆栈卡跳「堆栈管理」）随之删除 —— **唯一可点区只剩左侧图标**。
  - 跳转能力未丢失：两个磁贴右上角保留「查看全部 →」。
  - **验证**（页面级预览入口 + 把 `onNavigate` 打桩记到 `window.__nav`）：点容器卡片名称 → `__nav = []`；点堆栈卡片名称 → `__nav = []`；**对照组**点「查看全部」→ `__nav = ["containers"]`（证明打桩有效、空数组是真结论）；点图标 → `window.open` 仍捕获到 `http://192.168.1.10:8090/`。
- **Docker 容器磁贴移除 4 条状态进度条**（`src/pages/Dashboard.tsx`）
  - 删掉「运行中 / 已停止 / 已暂停 / 有可用更新」四条 `StatusRow` 及其分隔块（`mt-4 pt-3 border-t` 一并去掉，内容区直接以筛选条开头）；`StatusRow` 组件成为死代码，**一并删除**。
  - **信息未丢失**：计数同时存在于磁贴摘要（`运行中 N · 已停止 N · 已暂停 N[ · 可更新 N]`）与筛选条计数（预览实测 `全部5 / 运行中2 / 已停止2 / 已暂停1`）。
  - **验证**：预览页 `document.querySelectorAll("div.h-2").length === 0`（本地无引擎数据，其余磁贴无横条）。

### ⚠️ 未完成 / 已知限制

- **v1.26.0 的包已被本版取代**：`build-upload/docker-manager-yanzi-linux-x64-v1.26.0.zip` 内容仍是旧交互（整卡跳转 + 4 条进度条），**保留未删**，待确认后清理（避免误部署，见踩坑 11）。
- 其余同 v1.26.0：卡片列表未限高、卡片不支持拖拽/移除、子表「强制更新」为未接线占位。

### 下一步

- 发布时把 v1.26.0 视为**已被取代**（不单独发 Release），只发 v1.26.1 并在 notes 里说明即可。

---

## v1.26.0 — 2026-09-25（已随 v1.31.1 发布）

> 仪表盘「Docker 容器」「堆栈」两个磁贴改为 **Unraid 式卡片列表**：卡片 = 图标 + 名称 + 「▶ 运行中 / ■ 已停止」状态（堆栈卡片右侧多为 `N/M` 容器数）；**点容器图标开 WebUI**（未运行 / 未配置则弹提示），**点堆栈图标弹容器子表**；两个磁贴各加一排状态筛选；容器磁贴的 4 条状态进度条保留、移除「未使用镜像可清理」提示。

### ✅ 已完成

- **Feature F — 仪表盘两个应用磁贴改为 Unraid 式卡片**（新增 `src/components/NodeCard.tsx`、`src/components/NodeCardGrid.tsx`、`src/components/StackContainersModal.tsx`；改 `src/pages/Dashboard.tsx`、`src/pages/Stacks.tsx`、`src/App.tsx`）
  - **布局对齐实测快照**：形态取自用户提供的 Unraid 7.2.3 WebGUI 完整网页快照（`yanzi_Dashboard/`）中「Docker 容器」磁贴（`.outer.solid.apps`）与「Compose Stacks」磁贴（`.compose-dash-stack`）的真实 DOM —— 卡片 = `[图标] + [名称 / ▶ 已启动] + [右侧计数]`；状态是「▶ / ■ 图标 + 彩色文字」，不用胶囊徽章；**点击处理挂在图标容器上**（快照里 `onclick` 就在包 `<img>` 的 span 上），与「点击图标弹出/跳转」的交互要求一致。
  - **`NodeCard`** 两个独立点击区：**图标 = 主操作**（可点时有 hover 蓝色描边，容器卡另在右上角画一个外链小箭头），**卡片其余部分 = 跳转到对应管理页**；图标点击 `stopPropagation`，避免与整卡跳转冲突。图标缺省时回退为**名称首字母**（容器）/ `Layers` 图标（堆栈）。
  - **`NodeCardGrid` / `FilterChips`**：卡片栅格 `1 列 → sm(640) 2 列 → 3xl(1800) 3 列`；筛选用胶囊分段控件（带计数，选中蓝底），形态与堆栈子表的「列显隐」按钮一致。
  - **堆栈磁贴**：卡片 = 图标 + 名称 + 状态 + 右侧 `运行中数/总数`；**点图标弹出容器子表**；筛选 **全部 / 运行中 / 已停止 / 部分运行**（默认「全部」）；**取消原先的 `slice(0, 5)` 截断**（此前最多只显示 5 个堆栈）。
  - **Docker 容器磁贴**：**保留 4 条状态进度条**（运行中 / 已停止 / 已暂停 / 有可用更新，仍为纯展示、不可点），**移除「未使用镜像可清理 N 个」**；筛选 **全部 / 运行中 / 已停止 / 已暂停**；卡片 = 图标 + 名称 + 状态；**点图标**：运行中且有 WebUI 地址 → 新标签打开该地址；未运行 → Toast「该容器未运行：<名>」；运行中但未配 WebUI 地址 → Toast「该容器未配置 WebUI 地址：<名>」（3 秒自动消失，复用 `components/UI.tsx` 的 `Toast`）。
  - **容器子表抽成共享组件**：原先内联在 `Stacks.tsx` 的容器子表弹窗（Profiles 行 / 列显隐 / 容器表格 / 行右键，约 100 行 JSX）抽为 `src/components/StackContainersModal.tsx`，**堆栈页与仪表盘共用同一张子表**；堆栈页行为与改动前完全一致（列显隐改由组件自持，仍由「系统设置 → 列显隐 → 容器子表」初始化；右键容器行仍打开原右键菜单）。`Stacks.tsx` 的内联版本与连带死代码（`allSubColumns` / `visibleColumns` / `toggleColumn` / `SubColumnKey` / `TagIcon` / `shortImageRef`）一并移除。
  - **刻意未动**：侧边栏「堆栈管理 / 容器管理」两个表格页（批量操作 / 列显隐 / 列排序）完全未改；**后端零改动**（`container.icon` / `container.webuiUrl` / `stack.icon` / `stack.runningContainers` / `stack.totalContainers` 字段本就存在）。
  - **验证**：前端 `tsc --noEmit` 0 错误；`vite build` 通过，产物含新文案（「查看容器子表」「该容器未运行」「该容器未配置 WebUI 地址」「没有符合筛选条件的容器」）且旧文案「未使用镜像可清理」**0 命中**。用**临时预览入口**（mock 容器 / 堆栈直接渲染真实 `Dashboard`，不连后端、不需登录、不需 Docker，因本机无 Docker 可用）在 1920×1200 实测：4 条进度条保留 ✔；两处筛选条渲染且点击生效（筛选项计数 `全部5/运行中2/已停止2/已暂停1` 与 `全部3/运行中1/已停止1/部分运行1`，点「运行中」后已停止卡片数 = 0）✔；点未运行容器图标 → Toast「该容器未运行：filebrowser」✔；点运行中且有 WebUI 的容器图标 → `window.open` 捕获到 `http://192.168.1.10:8090/` ✔；点运行中无 WebUI 的容器图标 → Toast「该容器未配置 WebUI 地址：database_MySQL」✔；点堆栈图标 → 「容器子表 · database」弹窗并正确列出 mysql / postgresql / redis ✔。页面无 console 报错；校验完临时文件（`preview-tiles.html` / `src/__preview_tiles.tsx` / `.tmp-shot/`）已全部删除。

### ✅ 打包与冒烟（2026-09-25 15:52）

- **交付包已出**：`build-upload/docker-manager-yanzi-linux-x64-v1.26.0.zip` **42,958,150 B**，
  SHA-256 `d0325cc11ca3ce74dba505bd5ce7abcda4d7ebccb9391398da144affbc026384`（**5 成员**，权限位已核对：
  二进制 / `install.sh` / `uninstall.sh` = `0o755`，`.service` / `README.md` = `0o644`）；
  无版本别名 `docker-manager-yanzi-linux-x64.zip` 同字节。二进制 129,895,616 B（ELF magic `7f 45 4c 46`）。
- **构建链**：前后端 `tsc --noEmit` 均 0 → `vite build`（`dist` 为升版后新构建，含 `1.26.0`、**不含** `1.25.0`）
  → `build-binary.mjs`（bundle 4.68 MB，内嵌 4 个前端文件 + 单元模板）→ `--experimental-sea-config`
  → 复制 Linux node v22.22.2 → postject 注入（`warning: Can't find string offset for section name '.note.100'` 无害）。
- **冒烟（跑 bundle.js 于 5025，临时 DATA_DIR/CONFIG_DIR/LOG_DIR）**：
  - `/` 返回的 asset 名 **`index-Ceki5Lww.js` + `index-DSmOHoC4.css`** 与本地 `dist/assets/` **完全一致**
    → 证明包内嵌的就是本次构建（坑 14 的证据链）；
  - 服务端 asset 搜「查看容器子表」**命中 2 次**、搜已删除的「未使用镜像可清理」**0 次**；
  - 缓存头：`/` = `no-cache, must-revalidate` ✓，`/assets/*` = `public, max-age=3600` ✓；
  - 日志首行 `📦 二进制模式：从嵌入式数据托管前端 (4 文件)`。
  - 测完 `smoke.cjs` / `smoke.log` / `/tmp/smoke` 已删，5025 端口已释放（无监听）。

### ⚠️ 未完成 / 已知限制

- **发布**：已并入 [v1.31.1](https://github.com/yanziruxue/docker-manager/releases/tag/v1.31.1)（2026-09-27）发布（当时仅出包，未单独建 Release）。
- `deploy/linux/` 留有本次构建中间产物（`bundle.js` 4.9 MB + `docker-manager-yanzi` 129.9 MB +
  `sea-prep.blob` 5.1 MB + zip 42.9 MB ≈ 178 MB）——**均在 `.gitignore` 内，不会误推**；
  如需回收空间可删（下次构建会重新生成）。
- 卡片列表**未限高**：容器 / 堆栈很多时磁贴会很长（与 Unraid 行为一致）。若需要，可加 `max-h` + 内部滚动，或恢复「只显示前 N 个 + 查看全部」。
- 卡片**不支持拖拽排序 / 移除**（与磁贴一致，避免误操作）。
- 子表内的「强制更新」按钮仍是**未接线的占位**（原内联版本即如此，本次未改其行为）。

### 下一步

- 需要发布时：`scripts/push-via-api.mjs` 推源码（Git Database API）→ `scripts/publish-release.mjs` 建 Release
  （脚本只提当前 TAG 一段；若 v1.25.0 / v1.26.0 都要发，notes 需手工合并），最后回填本文件的 Release 链接与 commit SHA。

---

## v1.25.0 — 2026-09-25（已随 v1.31.1 发布）

> ① **镜像锁定**（新功能）：可锁定镜像，使其在「清理未使用」时被跳过，锁定状态由服务端持久化；② 镜像分类简化为「**使用中 / 未使用**」，悬空归入未使用，并显示已锁定数量；③ 资源监控仪表盘精简，移除「Docker 镜像占用」「Docker 数据卷占用」两个环形仪表；④ **仪表盘重构为 Unraid 式三列磁贴布局**（磁贴可折叠、**只折叠不移除**；处理器改横向条形、内存改双曲线磁贴；移除统计卡片与「最近活动」）；⑤ **处理器磁贴新增「整体负载曲线」**（可独立折叠；后端 `ResourceSample` 补采 `cpuPercent`），并把**处理器 / 内存 / 网络三处曲线的时间范围统一**为磁贴头下拉（10 秒~5 分钟，按磁贴持久化为 `dm.chart.<id>.range`，切换仅本地切片、不发请求）。

### ✅ 已完成

- **Feature A — 镜像锁定：清理未使用时跳过**（新增 `server/image-locks.ts`；改 `server/docker.ts`、`server/index.ts`、`src/api.ts`、`src/types.ts`、`src/pages/Images.tsx`）
  - **为什么锁定状态必须存服务端**：清理由后端执行（socket / tcp 走 dockerode、ssh 走 docker CLI）。若锁定只存在浏览器里，换个浏览器或清掉缓存后锁定即失效、镜像照样被清掉。故持久化到 `config/image-locks.json`，结构 `{ "<engineId>": [{ id, ref, at }] }`。
  - **匹配规则（`id` 或 `ref` 命中任一即视为锁定）**：`id`＝镜像完整 sha256。Docker 删除镜像时按 **ID 整体删除**（该 ID 上的所有 tag 一起消失），所以只锁一个 tag 是不够的 —— 兄弟 tag 未锁则整个 ID 仍会被清、被锁的 tag 也跟着没；用 ID 匹配才能覆盖「多 tag 镜像」。`ref`＝`repo:tag`，用于覆盖「同 tag 重新拉取」（此时 ID 已变但 ref 不变，锁定应继续生效）。两者并存才同时覆盖这两种场景。
  - **清理实现的关键约束与取舍**：`docker image prune -a` 由 Docker 决定删谁，**无法排除指定镜像**（`--filter` 无 label 反选）。故：
    - **无锁定时**走原生 `prune -a`（**零回归**，`SpaceReclaimed` 仍是 Docker 的精确统计）；
    - **有锁定时**自行枚举「未被任何容器引用」的镜像 → 排除锁定项 → 逐个 `docker rmi`，分**两轮**删除（`rmi` 删父镜像时子镜像仍在会失败，把失败的留到下一轮重试）；空间用 `/system/df` 的 `LayersSize` 前后差（精确），取不到时退化为按镜像大小求和。
  - **SSH 路径同步支持**：`docker ps -aq | xargs -r docker inspect --format '{{.Image}}'` 取已用镜像 ID，`docker images --no-trunc --format` 取全量，排除锁定后批量 `docker rmi`（一个都没成功时再逐个兜底）；空间用 `docker system df` 前后差。
  - **惰性清理过期锁定**：`pruneStaleLocks()` 在 prune 时顺手清掉「已不存在的镜像」的锁定——此时本就要枚举镜像，零额外开销。
  - **API**：`GET /api/engines/:id/images/locks`、`POST /api/engines/:id/images/locks`（body `{ id, ref?, locked }`；`id` 过 `^[0-9a-fA-F]{12,64}$` 校验，缺 id／非法 id → 400）。存储读写对文件缺失、JSON 损坏、脏数据均容错，不会拖垮镜像列表。
  - **前端**：操作菜单新增「锁定（清理未使用时跳过）」/「解除锁定（允许被清理）」；仓库列新增「已锁定」标签；新增「已锁定」统计卡；清理确认弹窗与结果输出都会说明「跳过了几个锁定镜像」。
  - **验证**：锁定匹配逻辑 **25/25** 断言通过（切真源码块编译后执行，覆盖「多 tag 镜像只锁一个 tag 也保护整个 ID」「同 tag 重新拉取后仍受保护」「加解锁去重」「引擎间隔离」「过期锁定清理」「文件缺失 / 损坏 / 脏数据容错」）；接口端到端冒烟 **24/24** 通过（含落盘校验、参数校验 400、引擎不存在 404、未鉴权 401）。

- **Feature B — 镜像分类简化为「使用中 / 未使用」**（`src/pages/Images.tsx`、`src/pages/Dashboard.tsx`）
  - 移除「悬空」筛选标签：`filter` 类型去掉 `"dangling"`，「未使用」判定简化为 `associatedContainers.length === 0`（**悬空自然归入其中**），不再单列。
  - 统计卡：「悬空镜像」→「**未使用**」（含占用 MB），并新增「**已锁定**」卡（`grid-cols-4` → `grid-cols-5`）。
  - **未使用数量包含锁定项**（按要求）；已锁定数量按**镜像 ID 去重**展示（多 tag 镜像只算一个，与「实际被保护的镜像数」一致）。
  - 顺带修正 Dashboard 的「悬空镜像可清理」→「**未使用镜像可清理**」，计数同步为无容器引用的镜像数。
  - **保留**：表格行内的 `悬空` 标签——它只是标注「该镜像无可用 tag」的**信息展示**，不再作为分类；如需一并去掉可再提。
  - 清理按钮与确认弹窗使用「**实际会删除的镜像数**」（未使用且未锁定、按 ID 去重），避免按钮数字与真实行为不符；弹窗会补充「未使用共 N 个，其中 M 个已锁定，本次将跳过」。

- **Feature C — 资源监控仪表盘精简**（`src/pages/Dashboard.tsx`、`src/App.tsx`）
  - 移除「Docker 存储占用」整块：删除「Docker 镜像占用」（`imageDiskMB` + 「N 镜像 · 堆栈 X / 容器 Y」副标题）与「Docker 数据卷占用」（卷数 + `volumeDiskMB`）两个 `Gauge`，连同其承载的 `grid grid-cols-2` 容器与块注释一并移除；「磁盘利用率」区不受影响。
  - 原因：这两项与顶部统计卡片（本地镜像 / 活跃堆栈 / 运行容器）信息重复，且两个环形仪表摊在整宽卡片里过于稀疏。
  - 连带清理（避免死代码）：`Gauge` 从 import 移除（**保留 `CpuCoresGauge`**，CPU 各核环簇不动）；`volumes` prop 从 `DashboardProps` 接口、组件解构、`App.tsx` 的 `<Dashboard>` 调用点一并移除，`DockerVolume` 类型 import 同步删除；`Volumes` 页的 `volumes={volumes}` 传参保持不变。
  - **后端与类型契约未动**：`EngineResourceStats.imageDiskMB` / `volumeDiskMB` 仍照常返回，仅前端不再展示（保留字段以备后续以表格形式回归）。

- **Feature D — 仪表盘重构为 Unraid 式三列磁贴布局**（新增 `src/components/Tile.tsx`、`src/components/TileGrid.tsx`；改 `src/pages/Dashboard.tsx`、`src/App.tsx`、`tailwind.config.js`）
  - **为什么改**：原先「4 个统计卡片 + 1 个整宽资源监控卡片 + 2 个并排卡片 + 1 个整宽活动时间线」是纵向堆叠，1920 宽下横向空间大量浪费，资源图表被压成一条；且与目标场景（Unraid / 自托管 NAS）用户熟悉的仪表盘形态不一致。
  - **参考来源**：用户提供其自有 Unraid 服务器（OS 7.2.3）WebGUI 的「另存完整网页」快照（`yanzi_Dashboard/`）。布局规格由快照 CSS + 计算样式实测提取，**不复制其代码**（上游 `unraid/webgui` 为 GPL v2）。
  - **布局规格（实测自上一步快照）**：三列等宽 `1fr` + `gap:20px`；断点 <768 单列 / 768–1600 双列 / ≥1600 三列。本项目左侧有固定侧边栏，故把三列断点反推到 **1800px**（`tailwind.config.js` 新增 `screens["3xl"]="1800px"`），保证每列实际可用宽度与 Unraid 相当（1920 视口下实测 `610.7px ×3`，Unraid 为 `617.3px ×3`）。
  - **磁贴壳 `Tile.tsx`**：头部 `flex items-start justify-between gap-2.5`；左侧「图标（32px）+ 竖排标题/摘要」，标题 `16px / 700 / uppercase`、摘要 `13px`；右侧「额外控件 + 折叠按钮」`gap-1.5`。这些数值直接对齐快照的 `.tile-header-main` / `.tile-header-right-controls` 计算样式。
  - **只折叠、不移除**（按要求）：磁贴不提供「关闭/删除」入口，避免用户误删后找不回；折叠态按 `dm.tile.<id>.collapsed` 存 localStorage，读取/写入均 try-catch（隐私模式下静默降级为会话内状态）。
  - **磁贴编排**（三列，8 个磁贴；虚拟机 / 共享 / 阵列 / 奇偶校验等 Unraid 专有卡片**未纳入**，本项目无对应能力）：
    | 列 | 磁贴 |
    |---|---|
    | 1 · 系统 | 系统概览（40px 时钟 + 日期 + 引擎信息）· 处理器 · 内存 |
    | 2 · 应用 | Docker 容器 · 堆栈 |
    | 3 · 存储与网络 | 镜像 · 网络 · 磁盘 |
  - **处理器改为横向条形**（按要求，替掉原 `CpuCoresGauge` 环簇）：总体负载一条（按 `cpuPercent / cpuMaxPercent` 绝对量程，与 Unraid 一致）+ 各物理核一行「核名 / 条形 / 百分比」；条形颜色沿用原有的负载语义（<60 绿 / 60–85 琥珀 / ≥85 红）。
  - **内存改为双曲线磁贴**（按要求）：保留原「系统占用 / Docker 占用」双线 + 面积，标题摘要显示「已用 X / 共 Y」，图下仍列「最大支持大小 / 已安装大小 / 空闲」。
  - **网络**：磁贴头右侧放时间范围下拉（10 秒~5 分钟）、摘要显示当前上下行速率、主体为下行/上行双曲线。
  - **移除**：4 个统计卡片（其数字已并入各磁贴摘要，与 Unraid「磁贴摘要即概览」的做法一致）与「最近活动」卡片（按要求去掉，Unraid 参考页无此块）——连带从 `DashboardProps` 与 `App.tsx` 调用点移除 `activities` prop，`ActivityLog` 类型 import 同步删除（通知中心仍独立使用 `activities`，未受影响）。
  - **新增色板（附加，不改动既有配色）**：`tailwind.config.js` 增加 Unraid 官方 token —— `ink:#1d1b1b`、`surface:#f2f2f2`、`accent:#0099ff`、`brand.500:#ff8c2f`、`brand.800:#f15a2c`；当前仅 `ink` 用于磁贴标题、`accent`/`brand` 备用。图表与状态色沿用项目既有 slate/blue/green/amber/red，避免整站视觉跳变。
  - **验证**：前端 `tsc --noEmit` **0 错**；`vite build` 通过（产物 `index-CZpPxnyS.js` + `index-U5q3gkL-.css`）；**实测渲染**（临时 `preview/` + mock 数据，走 agent-browser）：1920 → `610.656px ×3`（三列）、1280 → `606px ×2`（两列）、375 → `327px`（单列），8 个磁贴全部渲染、**0 控制台报错**；曲线、条形、状态分布条、磁盘表均正常出图。
  - **未纳入本期**（已确认）：磁贴**拖拽排序**（Unraid 用 jQuery sortable，本期不做）；磁贴「移除」（只做折叠）。

- **Feature E — 处理器整体负载曲线（可折叠）+ 仪表盘曲线时间范围统一**（改 `server/docker.ts`、`src/types.ts`、`src/pages/Dashboard.tsx`）
  - **为什么需要后端改动**：`ResourceSample` 原先只有内存 / 网络四路数据，**不含 CPU**，所以处理器磁贴只能有条形、出不了曲线（Feature D 遗留项）。本次在后端补采一路 `cpuPercent` 即可，**不新增 docker 调用**——该值就是 `getEngineResourceStats` 里 `getContainerStats` 已算出的「运行容器 CPU 合计」，直接复用。
  - **后端**（`server/docker.ts`）：`ResourceSample` 接口新增 `cpuPercent: number`（注释标明与 `EngineResourceStats.cpuPercent` 同源，供仪表盘「整体负载曲线」）；在 `recordResourceSample(engine.id, {...})` 的采样点补写 `cpuPercent: Math.round(cpuPercent * 100) / 100`。**返回给前端的 `EngineResourceStats.cpuPercent` 语义不变**（同一变量，单位一致），前端类型 `src/types.ts` 的 `ResourceSample` 同步加字段。
  - **处理器磁贴新增「整体负载曲线」小节**：蓝色面积图（`#3b82f6`，与「总体负载」条同色，表明同源），数据取 `history.slice(-points).map(s => s.cpuPercent)`。
  - **曲线小节独立可折叠**：与磁贴整体折叠是**两套状态**——小节折叠存 `dm.tile.cpu.chart`（复用 `Tile` 导出的 `useStoredFlag`），默认展开；chevron 展开/收起时旋转 180°。这样用户既能折叠整个磁贴，也能只收起曲线看图省空间。
  - **曲线刻意不设 `yMax`**：绝对量程是 `ncpu×100`，固定量程会把曲线压成贴底直线看不出趋势；改用自动量程，靠右上/右下刻度标签（`formatMax` 输出 `N%` / `formatMin` 输出 `0`）表明量纲。
  - **时间范围统一（原网络磁贴的内联下拉升级为通用控件）**：
    - 抽出 `useChartRange(id, initial = "30s")` —— 返回 `{ range, setRange, points }`，选择按磁贴持久化到 `dm.chart.<id>.range`（读时校验是否属于已知范围项，写时 try-catch 静默降级）；`points` 由 `RANGES` 查表得到。
    - 抽出 `RangeSelect` 组件（`<select>`，`aria-label="曲线时间范围"`），统一渲染在磁贴头 `actions` 槽位。
    - 三处曲线（**处理器 / 内存 / 网络**）全部接入：范围项 **10 秒 / 30 秒 / 1 分钟 / 2 分钟 / 5 分钟** → 本地切片 `10 / 30 / 60 / 120 / 300` 点。后端固定保留最近 5 分钟，故**切换范围只在本地切片、不产生任何额外请求**（拉取节奏仍是每 3s 一次 `range=5m`）。
    - 原网络磁贴放在主题区的内联 `<select>` 与 `useState("30s")` 一并移除，改为磁贴头统一下拉。
  - **验证**：前后端 `tsc --noEmit` 均 **0 错**；`vite build` 通过（产物 `index-Dw10VIDD.js` + `index-U5q3gkL-.css`）；产物内文案校验通过（「整体负载曲线」「曲线时间范围」「10 秒」「5 分钟」各命中 1 次；`dm.tile.cpu.chart` 字面量命中）。**实测渲染**（临时 mock history 含 `cpuPercent`，走 agent-browser）：
    - 1920 → **三列**、1280 → **两列**、375 → **单列**（三列断点 1800px 生效），**0 控制台报错**；
    - 三个曲线磁贴头的下拉**均为 30 秒**，CPU 曲线正常出图；
    - 点「整体负载曲线」折叠 → 页面图表 SVG 计数 **3 → 2**、`dm.tile.cpu.chart` 写为 `"0"`；再点展开 → **2 → 3**、写回 `"1"`（折叠态确实持久化到 localStorage）；
    - 把网络下拉切到 **2 分钟** → `dm.chart.network.range` = `"2m"`，且**刷新页面后仍保持** `["30s","30s","2m"]`（按磁贴独立持久化，互不干扰）。

### ❌ 未完成 / 已知限制

- **锁定粒度是「镜像」而非「tag」**：锁一个 tag 会连带保护同一镜像 ID 上的其它 tag。这是刻意为之——Docker 按 ID 整体删除，只锁单个 tag 无法真正保护它。
- 有锁定时的清理走**逐个 `rmi`**，候选集判定与 `docker image prune -a` 理论上可能有极少差异（如中间层镜像的依赖顺序）；已用两轮重试缓解，SSH 路径另加逐个兜底。
- SSH 路径下若远端 `docker system df --format` 不受支持，`SpaceReclaimed` 会显示 0（不影响实际删除）。
- 镜像 / 数据卷的**磁盘占用数值在前端不再有任何展示位**（后端字段仍在，如需可视化需另行设计，例如并入「磁盘」表格作为汇总行）。
- **磁贴不支持拖拽排序**（按要求本期不做）；磁贴顺序为代码内固定编排。
- **磁贴折叠态存在浏览器 localStorage**，不跨浏览器/设备同步（与镜像锁定不同——磁贴折叠是纯 UI 偏好，无需服务端落盘）。
- 处理器曲线 / 条形度量的是「**运行容器 CPU 合计**」（与 `EngineResourceStats.cpuPercent` 同源），非宿主机整体 CPU 占用；各核条形仍需读宿主机 `/proc/stat`，故**仅本机 socket 引擎有各核数据**（远程引擎下核区显示提示，曲线与「总体负载」条仍可用）。
- 曲线时间范围**上限 5 分钟**（后端 `RESOURCE_HISTORY_MAX=300` 决定）；若要更长窗口需扩后端环形缓冲容量并同步前端 `RANGES`。
- 三列布局在 1920 视口下第 3 列内容较少、底部留白明显（Unraid 自身第 3 列同样偏空，属该布局的固有特征）。
- `src/components/Gauge.tsx` 现已**完全无引用**（`Gauge` 圆环在 v1.24.1 移除后即成死代码，本次 `CpuCoresGauge` 被横向条形替掉后彻底闲置）。**未删除**，避免本地无 git 历史造成不可逆丢失；如需清理请明确指示。

### 🔜 下一步

- 视反馈决定是否给镜像页加「只看已锁定」筛选，或把「镜像 / 数据卷占用」以表格汇总行形式回归仪表盘。
- 视反馈决定是否把曲线时间窗口上限从 5 分钟放宽（需同步扩后端环形缓冲 `RESOURCE_HISTORY_MAX` 与前端 `RANGES`）。
- 视反馈决定是否清理 `src/components/Gauge.tsx`（当前已无引用）。

---

## v1.24.0 — 2026-09-19（已发布 2026-09-24）

> 用户可见改动：① 堆栈「格式化」支持平铺 YAML 自动补缩进（并修正触发时机）；② 新增「网络管理」独立导航（原在数据卷管理 tab 内，本次提至与数据卷管理同级侧边栏）；③ 网络管理 host 驱动网络全局仅允许创建 1 个；④ 仪表盘-资源监控改为**环形仪表盘**（CPU 各核小环 + 镜像/数据卷占用环）；⑤ 资源监控新增**内存双曲线图**（系统占用 + Docker 占用，下方显示最大支持 / 已安装大小）、**网络上下行双曲线图**（含 10 秒~5 分钟时间范围）与**磁盘利用率表格**；⑥ 堆栈「格式化」改为**数组写法**（`environment` / `labels` 映射 → `- K=V`；纯标量序列 → 行内 `[a, b]`）；⑦ 镜像**拉取任务**两端保留期统一 **30 分钟**，并在「详情」右侧新增 **×** 手动清理（前后端同时移除）——即「30 分钟自动清理」+「手动 × 清理」两种并存。
>
> **缺陷修复**：创建堆栈「上传文件」方法的上传区此前只是一个**装饰性 div**（没有 `onClick` / `onDrop` / 隐藏 file input），点击与拖拽都无反应；已补齐真实导入逻辑。

### ✅ 已完成

- **Feature A — 堆栈编辑「格式化」支持平铺 YAML 自动补缩进**（修复 `src/components/YamlEditor.tsx`）
  - 根因：平铺 YAML（`services:\niotdb:\nnetwork_mode: bridge…`）经 `js-yaml` 的 `load` 会抛错（0 列缩进不合法）→ 原 `format()` 直接走 catch 静默 no-op。
  - 新增 `isFlatYaml(text)`（判定所有非空/非注释行都在第 0 列）与 `autoIndentYaml(text)`（基于栈的启发式：识别 `services/volumes/networks/…` 块级键、列表键 `ports/environment/volumes/…`、序列项 `- `，对多服务 / 嵌套 `deploy` 均正确补 2 空格缩进）。
  - `format()` 先正常 `load→dump`；仅当 `yaml.load` 抛错且 `isFlatYaml` 为真时，先用 `autoIndentYaml` 补缩进再 `load→dump`，得到规范嵌套 YAML（如 `services:\n  iotdb:\n    ports:\n      - 6667:6667`）。已用独立 Node 脚本对单服务 / 多服务+deploy / 多服务+列表三种样例验证。
  - 涉及文件：`src/components/YamlEditor.tsx`。

- **Feature B — 数据卷管理新增「网络管理」页**（`src/pages/NetworkManager.tsx` 新 + `src/pages/Volumes.tsx` 接 tab）
  - 后端：新增 `server/docker.ts` 的 `getNetworks / createNetwork / removeNetwork / editNetwork`（edit = remove+recreate，Docker 不支持原地改），及 `server/index.ts` 四个路由 `GET|POST /api/engines/:id/networks`、`PUT|DELETE /api/engines/:id/networks/:netId`。
  - 网络↔容器映射取自 network inspect 的 `Containers` 项（自带每个容器 `RxBytes/TxBytes`），**累加即为该网络的下行/上行累计流量**，无需额外采样。
  - 前端 `DockerNetwork` / `NetworkCreateOptions` 类型（`src/types.ts`）+ 4 个 API（`src/api.ts`）。页面展示：网络总数 / 已关联容器 / 本地网络（local）统计卡；表格含网络名（内部/ingress 徽标）、驱动、子网/网关、使用容器 chips（带 IP 标题）、流量（↓ 绿 / ↑ 蓝）、编辑/删除操作。支持新建 / 编辑（名称+驱动+子网+网关+选项+标签）/ 删除（带确认）。
  - `Volumes.tsx` 顶部加「数据卷 / 网络管理」tab 切换，网络管理走 `NetworkManager` 组件。
  - 涉及文件：`src/types.ts`、`src/api.ts`、`server/docker.ts`、`server/index.ts`、`src/pages/NetworkManager.tsx`、`src/pages/Volumes.tsx`。

- **Feature B-2 —「网络管理」提至与「数据卷管理」同级的顶级导航**（`src/types.ts` + `src/components/Sidebar.tsx` + `src/App.tsx` + `src/pages/Volumes.tsx`）
  - 根因：用户要求把网络管理从「数据卷管理」内部 tab 提升为独立的一级菜单项。
  - `PageKey` 新增 `"networks"`；`Sidebar` 的 `navItems` 在「数据卷管理」下方加「网络管理」项（`Network` 图标，与数据卷管理同级）；`App.tsx` 加 `pageTitles.networks` 与 `{page === "networks" && <NetworkManager .../>}` 渲染分支。
  - `Volumes.tsx` 移除「数据卷 / 网络管理」tab 切换与 `NetworkManager` 引用，恢复为纯数据卷页。
  - 涉及文件：`src/types.ts`、`src/components/Sidebar.tsx`、`src/App.tsx`、`src/pages/Volumes.tsx`。

- **Feature D — 网络管理 host 驱动网络仅允许创建 1 个**（`server/index.ts` + `src/pages/NetworkManager.tsx`）
  - 后端 `POST /api/engines/:id/networks` 在进入 `createNetwork` 前，若 `driver === "host"` 先 `getNetworks` 查已存在的 host 驱动网络；若存在则返回 `409` 并提示「已存在 host 驱动网络「X」，host 驱动网络仅允许创建 1 个」（Docker 语义：host 共享主机网络栈，重复创建无意义）。
  - 前端 `NetworkForm`：当已存在 host 网络且非正在编辑该网络时，从驱动下拉中移除 `host` 选项并给出琥珀提示；编辑该 host 网络本身时保留该选项。
  - 涉及文件：`server/index.ts`、`src/pages/NetworkManager.tsx`。

- **Feature C — 仪表盘-资源监控改为环形仪表盘（原半圆速度表重设计）**（`src/components/Gauge.tsx` 改写 + `src/pages/Dashboard.tsx` 改写）
  - `Gauge` 改为**圆形进度环 + 居中大数字**：有 `max` 时按占比画彩环（内存），无 `max` 时满圈彩环（镜像 / 数据卷 / 网络 I/O）；参考截图风格美化（蓝/绿/琥珀/红/紫主题、圆角端点、居中数字）。
  - 新增 `CpuCoresGauge`：CPU 使用率改为**各物理核小环簇**（每核一个 ring + 居中百分比，按利用率绿<60 / 琥珀 60–85 / 红≥85 着色），并展示合计百分比；仅本机 `connectionType === "socket"` 引擎可读 `/proc/stat` 得到各核数据，远程引擎显示提示。
  - `EngineResourceStats` 新增 `cpuCores: { name: string; percent: number }[]`（后端 `getEngineResourceStats` 已通过 `sampleHostCpuCores` 采样填充）。
  - 仪表盘资源监控区布局（整段）：CPU 各核环簇 + 内存 / 网络双曲线图 + 磁盘利用率表格 + 镜像 / 数据卷两个环形仪表。

- **Feature E — 资源监控新增时间序列（内存 / 网络折线图）与磁盘利用率**（`server/docker.ts` + `server/index.ts` + `src/components/LineChart.tsx` 新 + `src/pages/Dashboard.tsx` + `src/api.ts` + `src/types.ts`）
  - 后端 `getEngineResourceStats` 增字段：`memInstalledMB`（/proc/meminfo MemTotal）、`memFreeMB`（MemAvailable）、`memSystemMB`（宿主机已用 − Docker 已用）、`memMaxSupportedMB`（SMBIOS Type 16 Maximum Capacity；非 root 多为 0400 → 0，前端显示「—」）、`disks`（/proc/diskstats 差分算各整盘利用率 / 读写速率 / 活动状态）；均仅 `socket` 引擎有真实值。
  - 新增每引擎**资源时间序列环形缓冲**（1s 采样、容量 300＝5 分钟）：`recordResourceSample()` / `getResourceHistory()`；新增路由 `GET /api/engines/:id/resource-history?range=10s|30s|1m|2m|5m`。
  - 新增 `src/components/LineChart.tsx`：零依赖 SVG 多序列折线图（面积填充 + 自动量程 + `vectorEffect="non-scaling-stroke"` 保证任意宽度线宽不变）。
  - 仪表盘：内存＝系统占用 / Docker 占用双曲线 + 下方「最大支持大小 / 已安装大小 / 空闲」；网络＝上下行双曲线 + 时间范围下拉 + 当前速率；磁盘＝设备 / 状态 / 读写速率 / 利用率表格。前端每 3s 拉一次历史，当前值仍由 SSE 1s 推送。
  - 已知限制：时间序列仅在仪表盘 SSE 订阅期间采样（离开仪表盘不记录）；远程引擎（tcp/ssh）取不到宿主机内存 / 磁盘，`memSystemMB`＝0、`disks`＝[]；磁盘温度 / S.M.A.R.T. 需 root（smartctl），未提供。

- **Feature F — 堆栈「格式化」改为数组写法**（`src/components/YamlEditor.tsx`）
  - 需求：格式化后落到 compose 的「数组写法」——`environment` / `labels` 用 `- K=V`、序列用行内 `[a, b]`。
  - 规则一「映射 → 数组」：`toKvArrayForm()` 把 `services.<名>.environment|labels`（含 `deploy.labels`）的键值映射折叠成 `K=V` 字符串数组；值为 null（compose 语义＝从宿主机透传）输出不带等号的裸 `K`。用 path 精确限定位置，避免把「名字恰好叫 environment 的服务」误判成映射。
  - 规则二「序列 → 行内」：`foldSequencesToFlow()` 在 dump 之后把块状**纯标量序列**折叠成 `key: [a, b]`；只要序列中出现「项本身是映射」「块标量 `|` / `>`」「项有更深缩进的续行」之一，该键整体保持块状写法（强行行内化会产出非法 YAML）。流式项含 `,` `[` `]` `{` `}` 时补单引号（`quoteFlowItem`）。
  - **顺带修复 Feature A 的触发时机**：纯顶格的 compose 其实是**合法** YAML，`yaml.load` 会把它解析成「一堆同级键」的扁平映射 → 原先挂在 `catch` 上的补缩进分支**永不触发**，格式化后依旧扁平。现改为**先判 `isFlatYaml` 再补缩进**，补缩进失败才落回常规解析。
  - 举例：`ports:` + 两条 `- 6667:6667` / `- 1883:1883`，`environment:` 下 `TZ: Asia/Shanghai` / `PUID: 1000` → 输出 `ports: ['6667:6667', '1883:1883']`、`environment: [TZ=Asia/Shanghai, PUID=1000]`。
  - 验证：把 `YamlEditor.tsx` 里真实的辅助函数块**自动切出**、esbuild 编译后跑测试——6 项「输出可解析 + 与变换后对象逐字段等价 + 二次格式化幂等」全通过（覆盖 `ulimits` 嵌套序列保留块状、多行块标量保留块状、`MSG=a, b` 补引号、服务名恰为 `environment` 不误判等）；2 项平铺 YAML 回归（单服务 / 多服务 + `deploy`）关键路径符合预期。共 8/8。
  - 涉及文件：`src/components/YamlEditor.tsx`。

- **Feature G — 镜像拉取任务：前后端保留期统一 30 分钟 + 手动「×」清理**（`server/docker.ts` + `server/index.ts` + `src/api.ts` + `src/pages/Images.tsx`）
  - 背景：后端本就保留 30 分钟（`PULL_TASK_TTL`），但前端 `visiblePullTasks` 只展示「进行中 + 结束后 **5 分钟**」，还叠了 `.slice(0, 6)` 截断 —— 表现为「刚拉完就从任务条消失」，且被截断的任务既看不见、也无从清理。
  - 前端保留期 **5 分钟 → 30 分钟**，与后端 TTL 严格对齐（后端还留着，前端就看得见）；**移除 `.slice(0, 6)` 截断**，避免静默隐藏。
  - 新增行内「×」按钮（位于「详情」右侧）：点击后**前后端同时移除** —— 前端先本地摘除以获得即时反馈，再调 `DELETE /api/engines/:id/images/pull-tasks/:taskId`；调用失败则重拉列表校正回真实状态。若清掉的正是详情弹窗关注的任务，一并清空 `activePullTaskId`。
  - 后端新增 `removePullTask(taskId)` 与对应路由：直接从内存任务表删除；若任务仍在进行中，先 `destroy()` 进度流 / `kill("SIGTERM")` CLI 子进程，避免孤儿进程与后续输出。至此清理逻辑为**两种并存**：30 分钟 TTL 惰性清理 + 手动清理。
  - 「×」只出现在**已结束**的任务行（进行中的行已有「取消」按钮，避免两个语义相近的按钮并排）；后端仍兼容对进行中任务直接清理。
  - 涉及文件：`server/docker.ts`、`server/index.ts`、`src/api.ts`、`src/pages/Images.tsx`。

- **缺陷修复 — 创建堆栈「上传文件」的上传区从未接线**（`src/pages/Stacks.tsx`）
  - 根因：`method === "upload"` 分支里的虚线区域是一个**纯装饰 div** —— 没有 `onClick`、没有 `onDrop` / `onDragOver`，页面里也不存在隐藏的 `<input type="file">`。因此点击与拖拽**必然**无反应（不是环境/浏览器问题，是该功能从未实现）。
  - 实现：新增 `uploadFile` / `uploadDragging` / `uploadInputRef` 状态与 `handleComposeFile()`；虚线区接上 `onClick`（触发 file input）、`onDragOver` / `onDragLeave` / `onDrop`（拖拽高亮 + 取 `dataTransfer.files[0]`），并补 `role="button"` + `tabIndex` + Enter/Space 键盘可达；隐藏 input 选完文件后立即清空 `value`，保证同一文件能再次选择。
  - 载入后回填 `composeContent`（「创建」按钮读的就是它），并展示**内容预览**与「切到 Web 编辑器修改」按钮；堆栈名称留空时用文件名兜底，按后端 `createStack` 的校验规则（`^[a-zA-Z0-9_-]+$`）清洗 —— 去扩展名、非白名单字符换横线、去首尾横线（`my.stack.yaml` → `my-stack`，`IOTDB v2.yaml` → `IOTDB-v2`）。纯中文文件名清洗后为空 → 不自动填充，由用户手填（后端本就不接受非 ASCII 名）。
  - 同时修正方法描述：`createStackApi` **没有 env 参数**，故「上传本地 compose + env 文件」改为「上传本地 compose 文件」，不再承诺不支持的能力。
  - 涉及文件：`src/pages/Stacks.tsx`。

### ❌ 未完成 / 已知限制

- 网络「编辑」为删除后重建，若编辑期间有容器依赖该网络、或网络正被使用，会删除失败（前端已带确认提示）；Docker 原生不支持改名/改子网。
- 仪表盘网络 I/O 为运行容器实时速率（`EngineResourceStats`），非单网络粒度。
- 资源时间序列仅在仪表盘 SSE 订阅期间采样（1s / 容量 300＝5 分钟），离开仪表盘即停止记录，不落盘。
- 内存 / 磁盘 / 各核 CPU 均依赖宿主机 `/proc`，仅 `connectionType === "socket"` 引擎有真实值；远程引擎（tcp / ssh）`memSystemMB`＝0、`disks`＝[]、`cpuCores`＝[]。
- 磁盘温度与 S.M.A.R.T. 需 root（`smartctl`），未提供；「最大支持大小」取自 SMBIOS Type 16，非 root 常为 0400 → 前端显示「—」。
- 格式化会把 `environment` / `labels` 从映射改写成数组（compose 语义等价，但文本形态变了）；含多行标量、或序列项本身是映射的序列**不会**行内化，仍保持块状。
- 纯顶格 YAML 一律按「补缩进后的嵌套结构」解释（如 `b:` 后跟同级 `c:` 会被理解为 `b.c`），与「全部同级键」的另一种合法解释不同——这是 Feature A / F 的既定取舍。
- 创建堆栈的「上传文件」只接受 compose 文件（`.yml` / `.yaml` / `.txt`，上限 1 MB），**不支持 .env 文件**（`createStackApi` 无 env 参数）；纯中文文件名不会自动填充堆栈名，需手填。
- 拉取任务的后端清理是**惰性**的（只在前端轮询 `pull-tasks` 时触发），因此镜像页长期不打开时，过期任务会停留在内存里直到下次访问；服务重启则内存任务表整体清空。

### 🔜 下一步

- 视反馈决定是否给网络管理页加「按容器筛选网络」或「网络流量趋势图」。
- 视反馈决定是否把仪表盘其余卡片也统一为仪表风格。

### 🚀 发布记录（2026-09-24）

- **Release**：[v1.24.0](https://github.com/yanziruxue/docker-manager/releases/tag/v1.24.0)（已转正 · 当前 **Latest**）
- **源码 commit**：`9697b7678644ff44d22969595005d3b5c94240ad`（`main`）
- **assets**：
  - `docker-manager-yanzi-linux-x64-v1.24.0.zip` — 42,949,964 B，SHA-256 `6ee5871302bd88b8efb248121b143494b571c57edd4cfb77481b2a2ddbbd0b84`
  - `docker-manager-yanzi-linux-x64.zip` — 同内容（latest 稳定别名，供 `quick-install.sh` 与手动下载）
  - `quick-install.sh` — 9,371 B
- **Release notes**：因上一发布版为 v1.23.6，本次 notes **合并 v1.23.7 → v1.24.0 六个累积未发布版本**的完整变更（22,451 字符，含首部汇总导语）。
- **备注（踩坑）**：`gh release create` 带资产时的行为是**先建 Draft、传完资产再转为正式**。本次 42 MB 上传超出命令超时导致进程中断，Release 停在 **Draft** 且只到位 `quick-install.sh`；已用 `gh release upload --clobber` 补传两个 zip、`gh release edit --notes-file` 覆盖为合并稿、再 `--draft=false --latest` 转正。
- **升级路径**：应用内「系统更新 → 检查更新」应能发现 v1.24.0（GitHub Releases 单一源，已为非 draft / 非 prerelease / Latest）。

---

## v1.23.11 — 2026-09-19（未发布）

> 镜像加速源改显示方式：不再用「加速源列表 + 拖拽排序」逐条填，而是**直接以 daemon.json 代码展示并编辑**宿主机配置全文；保存后弹窗询问是否重启 Docker 生效（左「重启」/ 右「暂不重启」）。

### ✅ 已完成

- **新增 `src/components/JsonEditor.tsx`**：JSON 代码编辑器（与既有 `YamlEditor` 同源实现）
  - 语法高亮：键 / 字符串 / 数字 / 布尔与 null / 结构标点分色；行号列 + 状态栏。
  - 实时校验：直接用原生 `JSON.parse`（无第三方依赖）；错误定位**优先取新式消息的 `(line X column Y)`**，老式消息只有 `at position N` 时按字符偏移自行换算行列，状态栏显示「第 X 行 第 Y 列：原因」。
  - 工具栏「格式化」（2 空格缩进、键顺序不变）、Tab 插 2 空格、`readOnly` 只读模式（无写权限时使用）。
  - 叠层与滚动沿用 YamlEditor 的既有结论：两层 font/leading/padding/tabSize 必须全等，滚动同步用 CSS `transform` 平移而非 `scrollTop`（否则被较小滚动范围钳位导致文字错位）。
- **设置页「镜像加速源」改为 daemon.json 编辑器**（`src/pages/Settings.tsx`）
  - 打开页面把宿主文件内容读进编辑器（原样、含用户手写的其它配置项）；文件不存在时用应用设置里的加速源生成初始内容，没有则给空模板。
  - 「保存到 daemon.json」按钮：整份写回宿主文件（写前自动备份到数据目录的 `daemon-json-backups/`，保留最近 10 份）；「重置」可丢弃未保存修改回到磁盘内容，「● 有未保存的修改」标记提示状态。
  - 移除原「添加加速源 / 拖拽排序 / 逐条输入框」列表 UI；「推荐加速源」改为**填入编辑器**（合并进 `registry-mirrors` 且保留其它配置键，仍需点保存才写盘）。
  - 「刷新」在有未保存修改时先弹确认框（避免静默丢弃编辑内容）。
  - 保存成功后回读磁盘：编辑器文本对齐文件、并把 `registry-mirrors` 同步进应用设置（「拉取时改写镜像名」仍以设置里的列表为准）。
- **保存后询问是否重启 Docker**
  - 弹窗「重启 Docker 使配置生效」，两个按钮：**左「重启」右「暂不重启」**（为 `ConfirmDialog` 新增 `primaryFirst` 属性控制主操作位置，默认顺序不变，不影响既有调用）。
  - 内容与磁盘语义一致时不落盘、不弹窗（仅提示「内容与当前一致，无需重启 Docker」），避免只重排缩进也要重启。
  - APPLY 保存设置时若编辑器仍有未保存改动，会顺带一起写入宿主文件（同一入口，同样带重启询问），避免用户误以为 APPLY 已写盘。
- **后端新增「整份文件写入」**（`server/daemon-config.ts` + `server/index.ts`）
  - `writeDaemonConfigText(text)`：校验必须是可解析、顶层为对象的 JSON；空文本直接拒绝（防误清空）；写前备份 + 写后回读做语义校验；`changed` 以「规范化后语义是否变化」判定。现有文件本身解析失败时不参与比较（允许借编辑器修复坏文件）。
  - `PUT /api/system/daemon-config` 支持 `{ content: string }`（新，整份文件）与 `{ registryMirrors: string[] }`（旧，仅替换该键、保留其它键），后者保留向后兼容。
- **版本**：`package.json` → `1.23.11`。

### ⚠️ 未完成 / 已知限制

- daemon.json 顶层必须是 JSON 对象（Docker 本身也如此要求）；文件里若有注释（Docker 不支持）会在编辑器里报 JSON 错误。
- 编辑器内容以「打开页面时的文件内容」为基准，若同时在终端改了该文件且未点刷新，保存会以页面内容覆盖（写前有备份可回滚）。
- 无写权限时编辑器为只读，保存按钮禁用，仍按原逻辑展示 sudoers / systemd 授权指引。

### 📌 下一步

- 在真机设置页改一次加速源 → 保存 → 选「重启」，确认 daemon.json 落盘、Docker 重启后 `docker info` 的 Registry Mirrors 生效。

### 📦 交付包（本地已出 · 未发布）

- `build-upload/docker-manager-yanzi-linux-x64-v1.23.11.zip` — 42,933,917 B，SHA-256 `1f83e4b5625829a984065469f2db0eb84aa6904b1e4298f0a077e29ff97ad810`
- 包内 5 个成员（`install.sh` 等脚本未改动，本版仅前端 / 后端代码）；二进制 ELF `7f 45 4c 46` 129,830,080 B，内嵌 `1.23.11`；bundle 内含 `writeDaemonConfigText` 与「写入 daemon.json（整份）」；内嵌前端（base64 解码后）含「保存到 daemon.json」「暂不重启」「有未保存的修改」。
- 组件级浏览器验证（Playwright + 桩 fetch，真实 `Settings` 组件）：24 项断言全过 —— 编辑器载入文件内容含其它键、键/串双色高亮、`JSON 格式正确`、行号列 8 行、两层字体度量完全一致（13px/20px/12px/16px/tabSize 2）、未保存标记、保存后弹窗标题与「重启」「暂不重启」两个按钮且**重启在左**（x 760 < 832）、点「暂不重启」关闭、非法 JSON 时状态栏报错并禁用保存、重置恢复磁盘内容、填入推荐源保留其它键；`pageerror` / console error 均为空。

---

## v1.23.10 — 2026-09-19（未发布）

> 安装流程收敛：撤掉 Docker / Docker Compose 自动安装，改为**只检测、缺失即提示并停止**；并修掉 `install.sh` 在 `systemctl start` 失败时因 `set -e` 直接退出、用户看不到任何提示的问题。

### ✅ 已完成

- **移除 Docker / Compose 自动安装**
  - 删除 `deploy/linux/install-docker.sh`（连同其整条降级链：apt 官方源 → `get.docker.com` → 发行版仓库 → GitHub 代理等），`make-package.py` 同步去掉该成员。
  - `install.sh` 不再调用任何包管理器安装 Docker：不写 apt/dnf 源、不装包、不改动系统。
- **`deploy/linux/install.sh`：缺失即提示并停止**
  - 检测口径不变（docker CLI / `docker info` / compose 需真正执行 `version`）；任一缺失即打印含 Debian·Ubuntu、RHEL 系安装命令的指引，并以 `[ERROR]` + 退出码 1 结束。
  - 新增 `--ignore-docker`：跳过检查、继续安装应用本体（容器管理不可用）；移除失去意义的 `--no-docker` / `--apt-mirror` / `--script-mirror` / `-v`。
  - 检查仍放在「创建服务用户」之前 —— 先有 `docker` 组，`usermod -aG docker` 与单元里的 `SupplementaryGroups=docker` 才能一次到位。
- **修复：`systemctl start` 失败时脚本静默退出**
  - 脚本开头是 `set -euo pipefail`，`systemctl start` 一旦返回非 0，脚本在打印任何提示前就退出（现场只看到 systemd 的两行报错 + shell 提示符）。现改为显式判返回值：失败时自动打印 `systemctl status --no-pager -l` 前 20 行与 `journalctl -u <服务> -n 30`，最后仍给出 `journalctl -u <服务> -f` 的后续指引。
- **`deploy/linux/README.md`**：包内容去掉 `install-docker.sh`；新增「先装 Docker（本包不代装）」段（含停止安装的完整输出示例）；可选参数与常见问题改写为「只检测、不改动系统」。
- **验证**（Windows 离线自测，桩 `docker` / `docker-compose`）
  - `bash -n` 通过、纯 LF；`INSTALL_DOCKER` / `DOCKER_VERBOSE` / `APT_MIRROR` 等旧引用已无残留。
  - 四条路径实测：① docker + compose 全缺 → 打印指引并 exit 1；② 有 docker 无 compose → 只报「未检测到 Docker Compose」并 exit 1；③ docker + 独立 `docker-compose` → 检查通过、继续到「创建服务用户」；④ `--ignore-docker` → 打印跳过提示后继续。
- **版本**：`package.json` → `1.23.10`。

### ⚠️ 未完成 / 已知限制

- 本包不再为用户机器安装 Docker，装机前须自行准备（README 已列命令）；若目标机器是**非特权容器**，容器内无法运行 dockerd，需 privileged 模式或改用宿主 Docker socket。
- v1.23.9 的安装进度框架随 `install-docker.sh` 一并移除（不再有 Docker 安装阶段）。
- `install-docker.sh` 仅存在于 v1.23.9 及更早的本地 zip 中，发布产物里不再包含。

### 📌 下一步

- 在目标 Debian 上实跑：`sudo bash install.sh`（应先停在前置检查）→ 装好 Docker 后重跑（应直到服务启动），确认服务起不来时能看到自动打印的 status / journal。

### 📦 交付包（本地已出 · 未发布）

- `build-upload/docker-manager-yanzi-linux-x64-v1.23.10.zip` — 42,930,169 B，SHA-256 `caf5c9e1048dd9b59ae9b61e5c834547d139237b5d0119b067fb7576da8701c8`
- 包内已核验：**5 个成员**（`install-docker.sh` 已移除）：二进制 ELF `7f 45 4c 46` 129,764,544 B + `install.sh` 14119 B + `uninstall.sh` 4239 B + `.service` 2619 B + `README.md` 7011 B，前四项 0755；`install.sh` 内 `--ignore-docker` / `docker_prereq_hint` / 「请先安装 Docker 与 Docker Compose」/ `systemctl start` 失败分支 / `journalctl -u` 全部命中，`install-docker` / `--apt-mirror` / `DOCKER_VERBOSE` 已无残留；二进制内嵌 `1.23.10`，bundle 内已无 `install-docker` 标识；文本文件无 CR。

---

## v1.23.9 — 2026-09-19（未发布）

> 安装进度可视化：`install-docker.sh` 此前把 apt/curl 的输出全部静默（`-qq`、`>/dev/null 2>&1`、`curl -s`），于是装 Docker 的那几分钟里终端没有任何输出，看起来像卡死。本版给每一步加实时进度。

### ✅ 已完成

- **`deploy/linux/install-docker.sh`：新增进度显示框架**
  - `run_step "<描述>" <命令…>`：命令在后台执行，同时起一个秒级心跳，在同一行（`\r\033[K` 原地覆盖）刷新 `[已耗时] 日志最后一行`；结束后打印 `↳ 完成（1m12s）` / `↳ 失败（退出码 N，…）`。
  - 完整输出落盘 `/tmp/docker-manager-install-docker.<时间戳>.log`（每步带时间与退出码分节）；**失败时额外打印末尾 12 行 + 日志路径**，一眼分清是「源不可达 / dpkg 被锁 / 证书问题」。
  - 覆盖全部耗时步骤：`apt-get update`、`apt-get install`（docker-ce、docker.io）、dnf 加源与安装、GPG 公钥与 `get.docker.com` / compose 二进制下载、`systemctl enable --now docker`；等待 daemon 就绪也改为 `[等待 Ns]` 原地刷新。
  - **取消静默**：apt 去掉 `-qq`、不再 `>/dev/null 2>&1`；curl 改 `-fL --progress-bar`，并加 `--speed-limit 1024 --speed-time 30`（**30 秒低于 1KB/s 即断开**，避免连接假活时无限等待）。
  - 新增「网络探测」段：安装前用 6s 超时探 `download.docker.com` / `get.docker.com` / `github.com`，不可达时直接给出 `--apt-mirror mirrors.aliyun.com/docker-ce`、`--script-mirror Aliyun` 建议。
  - 新增 `-v/--verbose`（等价 `DOCKER_VERBOSE=1`）：不捕获输出、原样实时打印；`export DEBIAN_FRONTEND=noninteractive` 避免 dpkg 在无 tty 会话里等交互（另一种「像卡住」）；末尾打印本阶段总耗时。
- **`deploy/linux/install.sh`**：调用子脚本前提示「需下载约 100–200 MB，可能耗时数分钟；下方会实时刷新进度」，调用后打印「Docker 安装阶段结束（耗时 Ns）」；新增 `-v/--verbose` 并透传 `DOCKER_VERBOSE`。
- **`deploy/linux/README.md`**：补进度显示示例、日志路径与 `-v` 用法。
- **验证**（Windows 离线自测）
  - `bash -n` 两个脚本通过；`grep -c $'\r'` 均为 0（纯 LF）。
  - 进度机制：模拟 2s / 62s 任务 → 心跳逐秒刷新、耗时分别报 `3s`（含 Windows 进程启动开销）/ `1m3s`；失败任务正确打印末尾输出与日志路径；`-v` 模式原样打印子命令输出。
  - 依赖组合 4 例复测（桩 `docker` / `docker-compose`）：全齐 exit 0、仅 CLI exit 1、CLI + 独立 compose exit 0、全缺 exit 1 —— 重构未破坏检测逻辑。
- **版本**：`package.json` → `1.23.9`。

### ⚠️ 未完成 / 已知限制

- 进度行依赖终端原地刷新：若把输出重定向到文件，`\r` 会落成一行行文本（属预期）。
- 心跳只显示「日志最后一行」——完全不输出内容的步骤（如 `systemctl` 静默成功）只显示耗时计数，这是正常的。
- 仍未在真实无 Docker 的 Linux 机器上实跑（与 v1.23.8 同一限制）；v1.23.8 / v1.23.7 的内容并入本包，均未单独发布。

### 📌 下一步

- 在最小 Debian 上实跑 `sudo bash install.sh`，确认进度输出 + 自动安装一次到位，再推送发布。

### 📦 交付包（本地已出 · 未发布）

- `build-upload/docker-manager-yanzi-linux-x64-v1.23.9.zip` — 42,937,097 B，SHA-256 `7e7862c69ef0c54f8d2dcd693968ecc70a6f3ea5542337ba006f0a52250ac161`
- 包内已核验：6 个成员（二进制 ELF + `install.sh` 13869 B + `install-docker.sh` 19552 B + `uninstall.sh` + `.service` + `README.md`，前四项 0755）；`install-docker.sh` 内 `run_step` / `_ticker` / 网络探测 / `--speed-time 30` / `-v|--verbose` / `DEBIAN_FRONTEND` 全部命中；`install.sh` 内 `DOCKER_VERBOSE` / 「Docker 安装阶段结束」/「实时刷新进度」命中；二进制内嵌 `1.23.9`；全部文本文件无 CR。

---

## v1.23.8 — 2026-09-19（未发布）

> Docker 依赖自动化：`install.sh` 检测到未安装 Docker / Docker Compose 时，自动调用新增的 `install-docker.sh` 安装（含国内镜像与多级降级），装不上的情况给出可复制的指引且不阻塞应用安装。

### ✅ 已完成

- **新增 `deploy/linux/install-docker.sh`（独立可执行）**
  - 检测三项：`docker` CLI、`docker info` 守护进程、Compose（`docker compose version` 插件 / `docker-compose version` 独立），**口径与后端 `docker.ts` 的 `detectComposeModes()` 一致**（只判 `command -v` 会把装坏的残留二进制误判为可用）。
  - 只补缺失的部分：已有 docker 只缺 compose 时，不会重装 docker。
  - 安装策略（多级降级，前一步成功即止）：
    - Debian/Ubuntu：官方 apt 源 → `get.docker.com` 脚本 → 发行版自带仓库（`docker.io`）
    - RHEL 系 / Fedora：官方 dnf 源 → `get.docker.com` 脚本
    - 其他：`get.docker.com` 脚本
    - Compose 单独缺失：官方源 `docker-compose-plugin` → 发行版仓库 → 下载独立二进制（`github.com/docker/compose` releases，失败再走 `gh-proxy.com` 代理）
  - 国内网络：`--apt-mirror mirrors.aliyun.com/docker-ce`（apt 源换镜像主机）、`--script-mirror Aliyun`（便捷脚本镜像参数）。
  - 安装后 `systemctl enable --now docker`（无 systemd 时降级 `service docker start`），并轮询 `docker info` 确认守护进程可用。
  - `--check` 只检测不改动；退出码 0 = docker 与 compose 均可用，1 = 仍有缺失（打印手工安装指引）。
  - 实现取舍：**刻意不开 `set -e`**（每步安装失败都要降级到下一策略，需自行判断返回值），仅在 `install.sh` 侧用 `set -e`。
- **`deploy/linux/install.sh`**
  - 「检查 Docker」段重写为「检测 3 项 → 缺失则调用同目录 `install-docker.sh` → **复检** → 汇总」。位置刻意保持在「创建服务用户」之前：先装好 Docker 才有 `docker` 组，`usermod -aG docker` 与单元里的 `SupplementaryGroups=docker` 才能一次到位。
  - 自动安装失败**不阻塞应用安装**（warn 后继续），因为无 Docker 时应用仍能启动（单元裁剪逻辑会摘掉 `SupplementaryGroups=docker`）。
  - 安装成功摘要里，若依赖仍不完整，追加提示「装好 Docker 后请重跑 `sudo bash install.sh`」——用于补回组成员与单元配置。
  - 新增参数：`--no-docker`（跳过自动安装）、`--apt-mirror <host>`、`--script-mirror <name>`、`-h/--help`。
- **`deploy/linux/make-package.py`**：`install-docker.sh` 以 0755 打进交付包（与 `install.sh` 同目录，`install.sh` 通过 `${SCRIPT_DIR}` 定位）。
- **`deploy/linux/README.md`**：补包内容、系统要求（Docker 改为可选自动安装）、安装参数说明、常见问题「没装 Docker / 没装 docker-compose」。
- **验证**（Windows 离线自测，用假 `docker` / `docker-compose` 桩命令覆盖组合）
  - `bash -n` 三个脚本全部通过。
  - 依赖组合 4 例：全齐 → exit 0；只有 docker CLI（插件不存在）→ compose 报缺失 exit 1；docker（daemon 未运行）+ 独立 `docker-compose` → exit 0 且能识别「独立 ✓」；全缺 → 三项 ✗ exit 1。
  - `install.sh` 链路：`-h` 正常（root 校验之前）；`--no-docker` 打印跳过提示；带 `--apt-mirror/--script-mirror` 时确认镜像参数被**透传**给 `install-docker.sh`；参数缺值报错清晰。
- **版本**：`package.json` → `1.23.8`；本版**仅出包，未发布**（未推源码、未建 GitHub Release）。

### ⚠️ 未完成 / 已知限制

- 未在真实无 Docker 的 Linux 机器上实跑一次自动安装（本机 Windows 仅做语法检查 + 桩命令逻辑自测）；`get.docker.com` / `download.docker.com` 的实际可达性与国内镜像速度未验证。
- 无 systemd 的环境（普通容器）只能装包、无法自动拉起 `dockerd`，脚本会明确提示需手工启动。
- 与 v1.23.7 相同：单元裁剪后若**之后才安装 Docker**，现在重跑 `install.sh` 即可自动补回（不必再记手工命令）。
- v1.23.7 未单独发布，其内容已并入本包。

### 📌 下一步

- 在最小 Debian 上实跑 `sudo bash install.sh`（无 Docker 场景），确认自动安装与后续组成员/单元配置一次到位，再推送发布。

### 📦 交付包（本地已出 · 未发布）

- `build-upload/docker-manager-yanzi-linux-x64-v1.23.8.zip` — 42,934,007 B，SHA-256 `19450029b77cf377efd4bbb812cdc1597fab65d0a51a57f040b85ec3a17e459f`
- 包内已核验：6 个成员（二进制 + `install.sh` 13404 B + **新增 `install-docker.sh` 12484 B（0755）** + `uninstall.sh` 4239 B + `.service` 2619 B + `README.md` 6495 B）；`install.sh` 内 `detect_docker_deps` / `compose_ok()` / `--no-docker` / `--apt-mirror` / `--script-mirror` / 镜像参数透传 / 「装好 Docker 后请重跑」全部命中；`install-docker.sh` 内 `apt_official` / `dnf_official` / `install_via_script` / `install_compose_binary` / `gh-proxy.com` / `systemctl enable --now docker` 命中；二进制内嵌 `1.23.8` + `index-C-hL86Nh.js`；全部文本文件无 CR。

---

## v1.23.7 — 2026-09-19（未发布 · 已被 v1.23.8 取代）

> 安装/卸载脚本健壮性修复：解决最小 Debian / 容器环境下 `install.sh` 失败的两个根因（PATH 缺 `/usr/sbin`、单元依赖的组不存在）。

### ✅ 已完成

- **`deploy/linux/install.sh` — PATH 与命令解析**
  - 脚本开头固定 `PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"`（与 `.service` 内一致）。根因：精简 Debian 容器 / 最小镜像的 `PATH` 不含 `/usr/sbin`，`useradd` / `usermod` / `groupadd` / `visudo` / `runuser` 全报「未找到命令」——文件实际存在于 `/usr/sbin`，**不是包缺失**。
  - 新增 `cmd_path()`（PATH → `/usr/sbin` 等绝对路径兜底）与 `require_cmd()`（缺失时给出可操作报错：`apt-get install -y passwd`），覆盖 `groupadd` / `useradd` / `usermod` / `visudo` / `runuser` 五处调用。
  - 实现约束：`require_cmd` 的 `exit` 必须在主 shell 生效，故调用写成 `VAR="$(require_cmd x)"`，**不能**写成 `$(err ...)`（subshell 内 exit 不会终止主脚本，会带着空变量继续跑）。
- **`deploy/linux/install.sh` — 服务组健壮化（修复 systemd `216/GROUP` 启动失败）**
  - 日志现象：`Failed to determine supplementary groups: No such process` / `Failed at step GROUP spawning /bin/sh` / `status=216/GROUP`。
  - 根因一：`useradd -r` 是否自动创建同名组取决于 `/etc/login.defs` 的 `USERGROUPS_ENAB`，精简镜像/容器常不创建，而单元写了 `Group=docker-manager-yanzi` → 缺组即 216/GROUP。改为**先 `groupadd -r`，再 `useradd -r -g "$SERVICE_USER"`**，不再依赖隐式行为。
  - 根因二：单元 `SupplementaryGroups=docker` 要求 `docker` 组真实存在（systemd 不支持「可选补充组」），而该机器未装 Docker → 无 `docker` 组。改为安装时按 `getent group docker` 结果裁剪：存在则保留；不存在则 `sed` 删该行并 warn 说明影响（无法访问 `/var/run/docker.sock`）与补救命令。
- **`deploy/linux/install.sh` — `visudo` 缺失不再误删授权**
  - 原 `if ! visudo -c -f …`：命令不存在同样返回非 0，被误判为「校验失败」→ 删掉刚写好的 sudoers 片段并报「校验失败已回滚」。改为先判存在性，缺失时仅 warn 并保留文件。
- **`deploy/linux/uninstall.sh`**
  - 同样固定 `PATH` + `cmd_path()`；`userdel` 由「静默失败却照样打印已删除用户」改为**如实报告**（成功 / 失败 / 命令缺失）。
  - 补充删除同名用户组（`groupdel`），与安装端显式建组配对，避免重装时残留旧 GID 归属。
- **验证**
  - `bash -n install.sh && bash -n uninstall.sh` 语法通过。
  - 离线自测单元裁剪：对 `.service` 副本执行 `sed -i '/^SupplementaryGroups=docker$/d'` → 49 → 48 行；`SupplementaryGroups=docker` 命中 0，`RuntimeDirectory` / `ExecStartPre` / `NoNewPrivileges` 全部保留。
  - 行尾符核查：`install.sh` / `uninstall.sh` / `.service` 均为纯 LF，确保 `sed` 的 `$` 锚点与 shebang 在 Linux 上可靠。
  - grep 确认五处外部命令调用均已改为引用变量，无裸调用残留。

### ⚠️ 未完成 / 已知限制

- 未在真实最小 Debian 容器内实跑 `install.sh` 全流程（本机为 Windows，仅做语法检查与逻辑离线自测）。
- 单元裁剪后若**之后才安装 Docker**，需手工执行提示中的 `groupadd docker && usermod -aG docker … && daemon-reexec && restart`，未做自动重扫。
- 本次**仅出包，未发布**（未推源码、未建 GitHub Release）。

### 📌 下一步

- 在容器 / 最小镜像实跑一次 `install.sh` 验证后，再将 v1.23.7 一并推送发布。

### 📦 交付包（本地已出 · 未发布）

- `build-upload/docker-manager-yanzi-linux-x64-v1.23.7.zip` — 42,927,817 B，SHA-256 `41616e8128ef36028257ade553436520506491f3d61afb0f064c670fe464f923`
- 包内已核验：`install.sh` 9495 B（`export PATH` / `cmd_path` / `require_cmd` / `sed` 裁剪 / `-g` 均命中）、`uninstall.sh` 4239 B（`cmd_path` / `$USERDEL` / `$GROUPDEL` 命中）、`.service` 2619 B（`RuntimeDirectory` / `SupplementaryGroups=docker` 保留）、二进制内嵌 `1.23.7` 与 `index-Dppf-B2p.js`；三个文本文件均无 CR。

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
