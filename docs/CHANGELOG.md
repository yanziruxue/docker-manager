# 版本记录

## 版本号规则

格式：`Major.Minor.Patch`（如 `1.1.0`）

| 位置 | 名称 | 递增条件 |
|------|------|----------|
| 第一位 | 主版本 Major | **人工定义** — 重大架构变化、不兼容更新 |
| 第二位 | 次版本 Minor | 功能增加 — 新功能模块、新字段、新页面 |
| 第三位 | 补丁 Patch | 修复、优化、UI 改动 |

递增约定：
- 一次发布中同时含 Minor 与 Patch 时，按**最高级别**递增，低级别归零（例：`1.0.3` + 新功能 → `1.1.0`）
- Major 由人工决定，不自动递增
- 同一天内的多次改动合并为一个版本，逐条记录在版本下

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
