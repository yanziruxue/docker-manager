# 版本记录

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
