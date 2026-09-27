# YAML 编码规范（Docker Compose 专用）

> **适用范围**：本项目「堆栈」模块中创建 / 编辑的所有 `docker-compose.yml`、`*.yaml`、`*.yml`。
> **落地实现**：`src/components/YamlEditor.tsx` 的 `formatComposeYaml()` —— 编辑器工具栏的「格式化」按钮。
> **同源产出**：`src/lib/compose-convert.ts`（`docker run` → compose 转换器）、`src/pages/Stacks.tsx`（新建堆栈默认模板）均按本规范 §3.2 装配。
> 文档版本 **v1.1**（2026-09-27），对应应用 **v1.30.2+**。

---

## 0. 一句话总则

> **2 空格缩进、`key: value` 冒号后 1 个空格、数组一律块状 `- `、端口等可安全去引号的标量不带引号、服务内参数固定排序（`image` 置末）、注释必须保留。**

---

## 1. 基础通用规范

### 1.1 缩进（强制）

- **强制 2 个空格缩进，禁止 Tab 制表符**。YAML 严格区分缩进，Tab 会直接解析失败。
- 所有子节点相对父节点统一缩进 **2 空格**，全文件层级统一，**不混用 2/4 空格**。

| 层级 | 内容 | 绝对缩进 |
|---|---|---|
| 一级 | `services` / `volumes` / `networks` | 0 空格 |
| 二级 | 自定义服务名（如 `iotdb`、`mysql`） | 2 空格 |
| 三级 | 服务参数（`image`、`ports`、`environment`…） | **4 空格** |

✅ 正确：

```yaml
services:
  iotdb:
    restart: unless-stopped
    image: apache/iotdb:1.3.0-standalone
```

### 1.2 键值对格式

- 固定格式 `key: value`，**冒号后必须跟随 1 个空格**，禁止无空格、多空格。
- 纯键空值场景写 `key:`，末尾无内容、无需空格。

```yaml
# 正确
container_name: iotdb-service

# 错误（冒号后无空格）
container_name:iotdb-service
```

### 1.3 注释

- 用 `#` 编写注释，**`#` 前方必须保留 1 个空格**（行首注释与行尾注释同）。
- 行尾注释：代码内容与 `#` 之间**至少 1 个空格**；标准化后统一为 **1 个空格**。
- 禁止无意义冗余注释，仅对特殊配置、自定义参数作说明。

```yaml
ports:
  - 6667:6667 # IoTDB 核心 RPC 端口
```

> ⚠️ **本项目强制保留注释**：格式化**绝不丢注释**。整行注释随其属主节点一起移动，行尾注释随本行移动。

### 1.4 引号

| 场景 | 要求 |
|---|---|
| 端口、普通字符串、布尔（`true` / `false`） | **不加引号**（YAML 自动识别类型） |
| 需**保持字符串类型**的纯数字（如 `"123"`、`"1.0"`） | **必须加引号**，否则会被解析成数字 |
| 需**保持字符串类型**的布尔字面量（如 `"true"`、`"no"`） | **必须加引号** |
| 以 `[ { * & ! \| > % @ ` 等特殊字符**开头**、含 ` #`、含 `: ` | **必须加引号** |
| 单引号 `' '` | 原样输出，不转义内部特殊字符 |
| 双引号 `" "` | 支持换行、转义字符 |

```yaml
rest_service_port: 18080
custom_url: "http://127.0.0.1:8080"
```

> 📌 **实测结论**：`- 8080:80`（无引号）与 `- '8080:80'`（单引号）在 YAML 中**语义完全一致**，均解析为字符串 `"8080:80"`；`- 127.0.0.1:8080:80`、`- 8080:80/udp` 同理。
> 因此**端口映射一律不加引号**，而 IPv6 形式 `"[::1]:8080:80"` 因以 `[` 开头**必须保留引号**。
> 「格式化」会自动完成这一步（详见 §5 第 ④ 步），且**只去掉不会改变语义的引号**。

---

## 2. 数组（列表）规范

YAML 数组有两种写法，**单个文件内禁止混用**，统一风格。

### 2.1 多行连字符写法（唯一推荐）

- 每行以 `-` 开头，**连字符后必须跟 1 个空格**。
- 所有端口、环境变量、挂载配置**优先（本项目＝强制）使用此写法**。

```yaml
ports:
  - 6667:6667
  - 18080:18080

environment:
  - enable_rest_service=true
  - enable_swagger=true
```

### 2.2 单行方括号写法

格式 `[value1, value2]`，逗号后必须加空格。仅适用于参数极少的简单场景。

```yaml
ports: [6667:6667, 18080:18080]
```

> ⚠️ **本项目「格式化」会把这类行内数组一律展开为 §2.1 的块状写法**，以彻底消除「同一文件混用两种数组写法」（§4.5）。
> 手工编辑时若不点「格式化」，两种写法都能通过语法校验，但**不符合规范**。
> 例外：**空集合** `{}` / `[]` 保持紧凑（展开成两行只是排版噪音，零收益）。

---

## 3. Docker Compose 专属规范

### 3.1 节点层级

- **一级节点**：仅保留 `services`、`volumes`、`networks` 标准配置（`version`、`x-*` 扩展字段允许存在，但排在末尾）。
- **二级节点**：自定义服务名（如 `iotdb`、`mysql`）。
- **三级节点**：服务参数（`image`、`ports`、`environment`、`restart`…），统一**绝对缩进 4 空格**。

### 3.2 服务内参数排序（统一顺序）

**网络 > 重启策略 > 容器信息 > 端口 > 环境变量 > 数据挂载 > 其余参数 > 镜像（`image` 置末）**

「格式化」按下列权重稳定排序（数字小者靠前；同权重保持原相对顺序）：

| 分组 | 键 | 权重 |
|---|---|---|
| 网络 | `network_mode` / `networks` | 10 / 11 |
| 重启策略 | `restart` | 20 |
| 容器信息 | `container_name` / `hostname` | 30 / 31 |
| 端口 | `ports` / `expose` | 40 / 41 |
| 环境变量 | `environment` / `env_file` | 50 / 51 |
| 数据挂载 | `volumes` | 60 |
| **其余参数** | 未列出的任意键 | 80 |
| 镜像 | `image` | **90（置末）** |

```yaml
services:
  iotdb:
    network_mode: bridge
    restart: unless-stopped
    container_name: iotdb-service
    hostname: iotdb-service
    ports:
      - 6667:6667
      - 18080:18080
    environment:
      - enable_rest_service=true
      - enable_swagger=true
    volumes:
      - iotdb-data:/iotdb/data
    image: apache/iotdb:1.3.0-standalone
```

### 3.3 顶层节点排序

`services` → `volumes` → `networks` → 其余（`version` / `x-*` 等，权重 50，保留原相对顺序，**不删除**）。

| 顶层键 | 权重 |
|---|---|
| `services` | 10 |
| `volumes` | 20 |
| `networks` | 30 |
| 其余 | 50 |

---

## 4. 高频错误禁止清单

1. ❌ 禁止使用 **Tab** 缩进，必须全文件空格缩进。
2. ❌ 禁止键值对**冒号后无空格 / 多空格**。
3. ❌ 禁止数组连字符 `-` 后**无空格**。
4. ❌ 禁止同一配置项**重复定义**（重复 `ports`、`environment` 等）。
5. ❌ 禁止单个文件**混用两种数组写法**。
6. ❌ 禁止**层级混乱、缩进不统一**。

---

## 5. 规范化管线（本项目如何落地）

点击编辑器工具栏「格式化」→ 调用纯函数 `formatComposeYaml(value)`，管线为：

```
输入文本
  │
  ├─ ① 是否「扁平无缩进」（所有非空非注释行都从列 0 起始）？
  │     是 → autoIndentYaml() 启发式补 2 空格缩进   ← 兼容粘贴来的顶格 YAML
  │     否 → 原样进入下一步
  │
  ├─ ② parseDocument() 解析为文档模型（保留注释）
  │     解析失败 / 内容为空 → **原样返回**（不破坏用户内容）
  │
  ├─ ③ forceBlockStyle()     → 非空 map / seq 一律 flow=false（§2.1、§4.5）；空集合保持紧凑
  ├─ ④ unquoteListScalars()  → 列表项去引号（§1.4）：'8080:80' → 8080:80
  ├─ ⑤ normalizeKeyOrder()   → 顶层排序（§3.3）+ 每个服务内排序（§3.2）
  └─ ⑥ doc.toString({ indent: 2, lineWidth: 0 })
```

**第 ④ 步的作用范围与安全边界**

| 项 | 说明 |
|---|---|
| 作用键 | `ports` / `expose` / `environment` / `env_file` / `volumes` / `devices` / `tmpfs` / `labels` 的**列表项** |
| 判定方式 | **逐值回验**：把引号内容当纯量重新解析一次，**必须仍是同一个字符串**才去引号 |
| 会被挡下（保留引号） | `"123"`（会变数字）、`'true'`（会变布尔）、`"1.0"`、`"[::1]:8080:80"`（`[` 开头）、含 `: ` 或 ` #` 的值 |
| 会被去掉引号 | `'8080:80'`、`"9090:90"`、`"8080:80/udp"`、`"./data:/var/lib/mysql"`、`"FOO=bar"` |

**关键性质**

| 性质 | 说明 |
|---|---|
| **幂等** | 已规范的内容再次格式化**输出不变** |
| **语义不变** | 只改写法，不改值：去引号经逐值回验、排序不影响语义 |
| **不丢注释** | 整行注释随属主节点移动；行尾注释随本行 |
| **不删字段** | 只排序、只展开数组、只去引号，**不新增也不删除任何键** |
| **不转写法** | `environment` 的 map 写法与 `- K=V` 写法**互不转换**（避免注释错位） |
| **失败安全** | 语法非法 / 解析异常 → **原样返回**，绝不产生半成品 |

> 📌 用 `yaml`(eemeli) 文档模型而非 `js-yaml` 的 `load → dump`：后者**必然丢弃全部注释**，且会把纯标量序列折叠成行内 `[a, b]`。

---

## 6. 与实现的差异（已知限制）

| # | 规范条目 | 实际行为 | 影响 |
|---|---|---|---|
| 1 | §1.3 注释位置 | 块**首键**之前的整行注释，会被视为「块级注释」固定在**块顶** | 注释不丢失，位置可能与你书写时不同 |
| 2 | — | `environment` 的 map ↔ `- K=V` 写法**不互转** | 尊重用户原写法，避免注释错位 |

**已在 v1.30.2 修正的历史差异**（保留记录，便于回看）

| 原差异 | 现状 |
|---|---|
| 「端口无需引号」未落地：格式化原样保留 `- '8080:80'` | ✅ 已实现去引号（§5 第 ④ 步），且经逐值回验保证语义不变 |
| 空集合被展开：`data: {}` → `data:` + `    {}` | ✅ 空集合保持紧凑，不再展开 |

---

## 7. 提交前自检清单

- [ ] 全文**无 Tab**（`grep -P "\t"` 无输出）
- [ ] 缩进层级为 0 / 2 / 4，无 3、6 等非 2 的倍数
- [ ] 冒号后均有 1 个空格
- [ ] `ports` / `environment` / `volumes` 均为**块状 `- `**，无行内 `[a, b]`
- [ ] 同一文件**未混用**两种数组写法
- [ ] 端口映射**不带引号**（IPv6 形式 `"[::1]:80"` 除外）
- [ ] 服务内参数顺序：网络 → 重启 → 容器信息 → 端口 → 环境变量 → 数据挂载 → 其余 → `image`
- [ ] 顶层顺序：`services` → `volumes` → `networks` → 其余
- [ ] 无重复定义的配置项
- [ ] 注释全部保留

> 💡 最快方式：直接点编辑器工具栏的「**格式化**」，再按本清单扫一眼差异。

---

## 附录 A · 格式化前后对照（实测输出）

**输入**

```yaml
# 顶层说明
services:
  # 服务说明
  web:
    image: nginx
    ports:
      - '8080:80'  # HTTP
    restart: always
  db:
    image: mysql
    environment:
      - "MYSQL_ROOT_PASSWORD=123"
volumes:
  data: {}
```

**输出**

```yaml
# 顶层说明
services:
  # 服务说明
  web:
    restart: always
    ports:
      - 8080:80 # HTTP
    image: nginx
  db:
    environment:
      - MYSQL_ROOT_PASSWORD=123
    image: mysql
volumes:
  data: {}
```

可以看到：

1. 顶层注释与服务内注释**均在原位保留**；
2. 服务内参数重排为 `restart` → `ports` → `image`（§3.2，`image` 置末）；
3. 行尾注释 `# HTTP` 前导空格由 2 个统一为 **1 个**（§1.3）；
4. `'8080:80'` 与 `"MYSQL_ROOT_PASSWORD=123"` **去掉了引号**（§1.4）；
5. 空集合 `data: {}` **保持紧凑**，未被展开成两行；
6. 解析结果与输入**完全等价**（键序变化不影响语义）。

---

## 附录 B · 本地自测方法

规范行为已提炼为**无 React 依赖的纯函数**，可直接在 Node 中验证（无需起浏览器）：

```bash
cd /d/AI/WorkBuddy/docker-unraid
# 打包纯函数为 CJS —— yaml 是 CJS 依赖，用 --format=esm 会报
#   Dynamic require of "process" is not supported
./node_modules/.bin/esbuild probe.ts --bundle --platform=node --format=cjs --outfile=probe.cjs
node probe.cjs
```

`probe.ts` 示例：

```ts
import { formatComposeYaml } from "./src/components/YamlEditor.js";
import { load } from "js-yaml";

const NL = String.fromCharCode(10);  // 不要写 "\n"，见下方坑 ①
const input = ["services:", "  web:", "    image: nginx", "    ports:", "      - '8080:80'"].join(NL) + NL;

console.log(formatComposeYaml(input));  // → `      - 8080:80`（去引号）

// 语义比对必须「键序无关」，否则参数重排后必然判不等
const canon = (v: unknown): string =>
  Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object"
    ? "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + canon((v as never)[k])).join(",") + "}"
    : JSON.stringify(v);
console.log(canon(load(input)) === canon(load(formatComposeYaml(input))));
```

> ⚠️ 三个坑：
> ① **别用 shell heredoc 写这个探针**：`\n`、`\s`、`\{` 等反斜杠转义会被工具链改写成 `/n`、`/s`、`{`，导致**假失败**（症状像「格式化器坏了」，其实是脚本坏了）。改用**文件写入工具**直接落盘，或至少用 `String.fromCharCode(10)` + 行数组拼装、避开一切反斜杠。
> ② `--format=esm` 打包 CJS 依赖（`yaml`）会报 `Dynamic require of "process" is not supported` → 用 `--format=cjs`。
> ③ `JSON.stringify` 整体比对对**键序敏感**，参数重排后必然「不等」，**不能据此判语义被破坏** —— 必须用上面的键序无关写法。
