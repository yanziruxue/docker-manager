# 发布与 OTA 升级指南

> 适用版本：v1.2.1+（含 OTA 应用内升级）
> 应用名：`docker-manager-yanzi`｜服务端口：`5024`｜安装目录：`/opt/docker-manager-yanzi`

本文覆盖三条主线：**构建交付包 → 发布到 GitHub Releases → 应用内 OTA 升级**，并附手动部署、回滚与安全注意事项。

---

## 0. 版本号规则（每次发布前先看）

格式 `Major.Minor.Patch`，由 `package.json` 的 `version` 字段定义，构建期注入到二进制：

| 位 | 名称 | 递增条件 |
|----|------|----------|
| 第一位 | Major | **人工定义**——重大架构变化、不兼容更新 |
| 第二位 | Minor | 功能增加（新功能模块、新字段、新页面） |
| 第三位 | Patch | 修复、优化、UI 改动 |

- 一次发布同时含 Minor 与 Patch 时，按**最高级别**递增，低级别归零（`1.0.3` + 新功能 → `1.1.0`）
- Major 由你决定，**不自动递增**
- 每次改动完成后必须：① 更新 `package.json` 的 `version`；② 在 `docs/CHANGELOG.md` 追加条目（按条目标注 Minor / Patch）

> 版本号来源：常量 `__APP_VERSION__` 由数据源 `package.json` 在**构建期**注入，必须在 `vite.config.ts` 和 `scripts/build-binary.mjs` 两处 `define` 都配置。**二进制内不读 `package.json`**（SEA 包里没有该文件）。

---

## 1. 构建交付包（开发机 Windows）

完整链路：前端产物 → `bundle.js` → SEA 注入 → 打 zip。

### 1.1 前端 + 后端 bundle

```bash
# 在项目根目录（Git Bash / PowerShell）
rm -rf dist
npm run build:frontend        # 构建前端 React 产物到 dist/
node scripts/build-binary.mjs  # esbuild 打包为 deploy/linux/bundle.js
```

> ⚠️ 必须分两步（`build:binary` 里 `vite` 清 `dist` 会被 safe-delete 拦截），先 `rm -rf dist` 再分别执行。

### 1.2 SEA 单文件二进制注入（交叉构建）

在预置的 Linux SEA 工作目录（含 `node-v22.22.2-linux-x64/` 解压目录、`sea-config.json`、已安装的 `postject`）执行：

```bash
cd /tmp/sea-build
cp /d/AI/WorkBuddy/docker-unraid/deploy/linux/bundle.js .

# 1) 由 bundle.js 生成 SEA blob
node --experimental-sea-config sea-config.json        # 产出 sea-prep.blob

# 2) 复制对应版本的 Linux node 运行时作为二进制基底
cp node-v22.22.2-linux-x64/bin/node docker-manager-yanzi

# 3) 将 blob 注入 node 二进制
node node_modules/postject/dist/cli.js docker-manager-yanzi NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

> 注入时的 `.note` section 警告**无害**，可忽略。

### 1.3 打包 zip 并交付

```bash
cp /tmp/sea-build/docker-manager-yanzi /d/AI/WorkBuddy/docker-unraid/deploy/linux/

cd /d/AI/WorkBuddy/docker-unraid/deploy/linux
python make-package.py     # 产出 docker-manager-yanzi-linux-x64.zip（保留 Unix 权限位）

# 交付到项目 build-upload 目录
cp docker-manager-yanzi-linux-x64.zip /d/AI/WorkBuddy/docker-unraid/build-upload/
```

**交付包校验要点**（OTA 能否找到包取决于此）：

| 项目 | 要求 | 当前产物 |
|------|------|----------|
| 文件名 | 以 `linux-x64.zip` 结尾 | ✅ `docker-manager-yanzi-linux-x64.zip` |
| zip 内二进制路径 | `docker-manager-yanzi/docker-manager-yanzi` | ✅（`make-package.py` 输出结构） |
| 二进制权限 | `0o755`（解压后可执行） | ✅ |
| 包内文件 | 二进制 + install.sh + uninstall.sh + .service + README.md | ✅ 5 个 |

```bash
# 快速校验
python -c "import zipfile; z=zipfile.ZipFile('build-upload/docker-manager-yanzi-linux-x64.zip'); print(z.testzip() or 'zip OK'); [print((z.getinfo(n).external_attr>>16)&0o7777, n) for n in z.namelist()]"
```

---

## 2. 发布到 GitHub Releases

OTA 的「检查更新」依赖 GitHub Releases，取包规则见 §4.5。发布步骤：

1. 进入仓库 → **Releases → Draft a new release**
2. **Choose a tag**：填 `vX.Y.Z`（必须带 `v` 前缀，代码会正则去掉 `v` 再比对；必须与 `package.json` 版本号一致）
3. 标题随意（如 `v1.2.1`）
4. 正文写 Release notes（原样显示在前端「系统更新」卡片，截断 2000 字）
5. 附件上传：`build-upload/docker-manager-yanzi-linux-x64.zip`
6. 点 **Publish release**——**不要**勾选 Draft / Pre-release，否则 `releases/latest` 取不到

> 私有仓库（Private）：Release 仍能被带 Token 的 API 读取（见 §4.1）；公开仓库则无需 Token。

### 2.1 一键发布（推荐，免手动填表）

构建完 zip 后，用脚本自动创建/更新 Release 并上传 asset，省去网页填 Tag / notes / 拖拽：

```bash
# 前置：安装 GitHub CLI（https://cli.github.com），并用以下任一方式提供凭据：
#   a. 环境变量（推荐，无需登录，读私有仓库只需 repo scope）：
GITHUB_TOKEN=xxx npm run release
#   b. 项目根 .env 写一行：GITHUB_TOKEN=xxx（脚本自动加载，不进代码/交付包）
#      → 之后直接 npm run release 即可
#   c. 或先登录：gh auth login（注意 PAT 需含 read:org scope，否则登录校验失败；
#      而发布 Release 本身只需 repo scope，故优先用 a/b 绕开）
# 注：gh 不在 PATH 时脚本会自动探测 Windows 常见安装路径，无需手动加 PATH

# 在已生成 build-upload/docker-manager-yanzi-linux-x64.zip 的前提下：
npm run release
# 等价于：node scripts/publish-release.mjs
```

脚本行为：
- 读 `package.json` 的 `version` → TAG = `vX.Y.Z`
- 从 `docs/CHANGELOG.md` 提取对应版本段作为 Release notes（自动，无需手填）
- Release 已存在 → `gh release upload --clobber` 覆盖 asset；不存在 → `gh release create` 发布
- 默认仓库：`yanziruxue/docker-manager`（已固定写死在 `server/updater.ts` 的 `UPDATE_REPO` 常量，发布脚本与 App 内升级均无需配置）
- 凭据优先级：环境变量 `GITHUB_TOKEN`/`GH_TOKEN` → 项目根 `.env` → `gh auth login` 登录态

可选参数：

```bash
node scripts/publish-release.mjs --repo owner/repo --zip 自定义路径 --prerelease --draft
```

> ⚠️ `npm run release` 复用当前已构建的 zip，**不负责构建**。完整链路：
> `npm run build:frontend && node scripts/build-binary.mjs` → SEA 注入 → `make-package.py` → `npm run release`。

### 2.2 一键构建并发布（最省事）

`scripts/publish.sh` 把上面整套串起来，手动跑一次即完成「构建 → SEA 注入 → 打包 → 推 GitHub」：

```bash
# 在 Git Bash 中（项目根）：
GITHUB_TOKEN=xxx bash scripts/publish.sh
# 或项目根建 .env 写 GITHUB_TOKEN=xxx 后直接：
bash scripts/publish.sh
# 也可：npm run publish
```

脚本内含：
- 凭据自动识别（环境变量 `GITHUB_TOKEN` → 项目根 `.env`）
- SEA 交叉构建环境自检（`/tmp/sea-build` + postject），缺失即报错指引
- 四步进度：[1/4] 前端+bundle → [2/4] SEA 注入 → [3/4] 打包 zip → [4/4] 发布

> SEA 环境是一次性常驻 `/tmp/sea-build`（`sea-config.json` + Linux node 二进制 + postject）。若 `/tmp` 被清理，按报错提示重新准备即可，无需改脚本。

---

## 3. 服务器手动部署（无 OTA 也行）

### 方式 A：上传 zip（推荐，与 OTA 同一交付物）

```bash
# 本地
scp build-upload/docker-manager-yanzi-linux-x64.zip user@服务器:/tmp/

# 服务器
sudo mkdir -p /opt/docker-manager-yanzi
sudo unzip /tmp/docker-manager-yanzi-linux-x64.zip -d /opt/   # 解压出 docker-manager-yanzi/ 顶层目录
cd /opt/docker-manager-yanzi
sudo bash install.sh
```

访问 `http://服务器IP:5024`。

### 方式 B：服务器端从源码构建（备选）

仅当已在 Linux 服务器上部署了源码时可用（`build.sh` 的 `APP_NAME` 已统一为 `docker-manager-yanzi`，与 `install.sh` 一致）：

```bash
bash build.sh && sudo bash install.sh
```

---

## 4. OTA 应用内升级

### 4.1 配置（系统设置 → 系统更新）

仓库地址已固定写死为 `yanziruxue/docker-manager`（公开仓库），App 内升级**无需填写仓库、无需 Token**。

| 字段 | 说明 |
|------|------|
| 更新源 | 只读展示：`yanziruxue/docker-manager`（公开仓库，已固定写死） |
| 自动检查更新 | 可选开关，启动后自动检查 GitHub Releases |

> 注：自 v1.2.3 起，仓库地址与 Token 已从「系统更新」卡片移除——仓库固定为公开仓库 `yanziruxue/docker-manager`，检查更新与下载均无需鉴权。

### 4.2 使用步骤

1. 点「**检查更新**」→ 调 `GET /api/system/version`（当前版本）+ `GET /api/system/update/check`（查 GitHub 最新 Release）
2. 若当前版本 < 最新 Release，卡片显示新版本号与 Release 说明，出现「**一键升级**」按钮
3. 点升级 → 调 `POST /api/system/update/apply`，后端开始下载；前端轮询 `GET /api/system/update/status` 显示进度（下载 → 解压 → 替换 → 重启）
4. 进程退出 → systemd `Restart=always` 自动拉起新二进制 → 刷新页面即新版本

### 4.3 后端执行流程（`server/updater.ts`）

```
检查(update/check)
  → 下载 zip(update/apply 触发)
  → 解压校验(校验包内 docker-manager-yanzi/docker-manager-yanzi 存在)
  → 写 detached 升级脚本(stop → mv 新二进制覆盖 → start)
  → 进程退出
  → systemd Restart=always 自动重启
```

### 4.4 端点清单

| 端点 | 方法 | 作用 |
|------|------|------|
| `/api/system/version` | GET | 当前运行版本（来自 `__APP_VERSION__`） |
| `/api/system/update/check` | GET | 查 GitHub 最新 Release（网络依赖） |
| `/api/system/update/apply` | POST | 触发下载 + 升级 |
| `/api/system/update/status` | GET | 升级进度轮询 |

### 4.5 约束与已知坑

- **自替换用 `mv` 而非 `cp`**：`mv` 是 rename 语义，进程运行时替换不会触发 `ETXTBSY`；服务以 `docker-manager-yanzi` 用户运行、**无 root、不能 `systemctl`**，靠 `Restart=always` 完成重启
- **`.service` 权限**：必须含 `ReadWritePaths=/opt/docker-manager-yanzi`，否则二进制无法被替换
- **出网要求**：检查更新依赖服务器能访问 `api.github.com`；内网环境需放行
- **取包规则**：`releases/latest`；Tag 去 `v` 前缀比对；Asset 文件名正则 `/linux-x64\.zip$/i`；包内二进制路径 `docker-manager-yanzi/docker-manager-yanzi`
- **错误码**：私有仓库未填 Token → 404（提示确认已填 Token）；Token 无效/权限不足 → 401

---

## 5. 安全注意事项

1. **GitHub Token 不写进代码/默认值**：仅通过「系统更新」卡片 UI 填写并保存，存于服务器本地 `settings.json`
2. **泄露即撤销**：若 Token 曾在聊天/日志中明文出现，到 GitHub **Revoke** 当前 Token 并**重新生成**（同样勾 `repo` 权限），在 UI 里更新为新值即可，无需重打包
3. **交付包不含配置**：`settings.json` / `engines.json` 等运行时文件不进 zip，升级不会覆盖你的本地配置（`install.sh` 也会备份旧版本到 `.bak.<时间戳>`）

---

## 6. 回滚与卸载

- **OTA 回滚**：升级前 `install.sh` 已备份旧二进制到 `/opt/docker-manager-yanzi.bak.<时间戳>`；异常时可停服务、用备份二进制覆盖、重启
- **完全卸载**：`sudo bash /opt/docker-manager-yanzi/uninstall.sh`（支持 `--keep` 保留数据 / `--purge` 清数据）

---

## 附：一键构建速查（开发机）

```bash
# 1) bundle
rm -rf dist && npm run build:frontend && node scripts/build-binary.mjs

# 2) SEA 注入（/tmp/sea-build 工作目录）
cd /tmp/sea-build && cp /d/AI/WorkBuddy/docker-unraid/deploy/linux/bundle.js .
node --experimental-sea-config sea-config.json
cp node-v22.22.2-linux-x64/bin/node docker-manager-yanzi
node node_modules/postject/dist/cli.js docker-manager-yanzi NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# 3) 打包交付
cp docker-manager-yanzi /d/AI/WorkBuddy/docker-unraid/deploy/linux/
cd /d/AI/WorkBuddy/docker-unraid/deploy/linux && python make-package.py
cp docker-manager-yanzi-linux-x64.zip /d/AI/WorkBuddy/docker-unraid/build-upload/
```
