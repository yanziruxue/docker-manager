/**
 * docker run 命令 → Docker Compose (YAML) 单向转换
 *
 * 设计说明：
 * - 不引入第三方 YAML 库；compose 文件结构固定（顶层 services，缩进 2 空格），
 *   自研一个**够用的 YAML 子集序列化器**比引通用库更轻、行为更可控。
 * - 解析失败 / 遇到无法映射的选项不会静默吞掉，而是通过 `warnings` 回传给 UI 提示用户。
 */

export interface ConvertResult {
  ok: boolean;
  /** 转换结果文本（失败时为空串） */
  output: string;
  /** 失败原因（人类可读） */
  error?: string;
  /** 可转换但语义有损 / 无法映射的选项提示 */
  warnings: string[];
}

const failed = (error: string, warnings: string[] = []): ConvertResult => ({ ok: false, output: "", error, warnings });
const done = (output: string, warnings: string[] = []): ConvertResult => ({ ok: true, output, warnings });

/* ==========================================================================
 * 一、Shell 分词（解析 docker run 命令行）
 * ========================================================================== */

/**
 * 按行剥离行内注释：`#` 前是行首或空白、且不在引号内时，从 `#` 起截断该行。
 * 注意要在合并 `\` 续行**之前**做——真实场景里注释常写在行尾续行符之后：
 *   -e FOO=bar  \  # 这是注释
 * 若先合并续行，`\` 和注释文本会混进 token 流污染解析。
 */
function stripInlineComments(input: string): string {
  return input
    .split(/\r?\n/)
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
        if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
        if (inSingle || inDouble) continue;
        if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/**
 * 按 shell 规则把命令行切成 token：
 * - 支持单引号 / 双引号（引号内的空格不分词，引号本身被剥离）
 * - 支持行尾 `\` 续行（多行 docker run 命令很常见）
 * - 支持引号紧邻拼接（如 `--name="my app"`）
 */
export function tokenizeShell(input: string): string[] {
  // 先剥离行内注释，再把 `\` + 换行 续行合并掉
  const normalized = stripInlineComments(input).replace(/\\\s*\r?\n\s*/g, " ");
  const tokens: string[] = [];
  let cur = "";
  /** 当前是否处于引号中（记录引号字符，遇到同字符才闭合） */
  let quote: string | null = null;
  /** 当前 token 是否已有内容（用于保留空字符串参数，如 -e "FOO="） */
  let started = false;

  const push = () => {
    if (started) { tokens.push(cur); cur = ""; started = false; }
  };

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; started = true; continue; }
    if (/\s/.test(c)) { push(); continue; }
    cur += c;
    started = true;
  }
  push();
  return tokens;
}

/* ==========================================================================
 * 二、YAML 序列化
 * ========================================================================== */

/** YAML 值：标量（string/number）、序列、映射。number 只用于 ulimits 的 soft/hard 这类必须是数字的字段 */
type YamlValue = string | number | YamlValue[] | { [key: string]: YamlValue };

/**
 * 标量是否需要加引号。
 *
 * 关键是**不能过度加引号**：YAML 的 plain scalar 允许出现 `:`，只有当冒号后跟空格
 * （会被当成 key）或以冒号结尾时才需要引号。否则 `image: nginx:alpine`、
 * `ports: - 8080:80` 会被写成 `'nginx:alpine'`、`'8080:80'`，可读性很差。
 */
function needsQuote(v: string): boolean {
  if (v === "") return true;
  if (/^-?\d+(\.\d+)?$/.test(v)) return true;                    // 纯数字 → 会被当数字
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(v)) return true; // 会被当 bool/null
  if (/^\s|\s$/.test(v)) return true;                            // 首尾空白会被剥离
  if (/^[-?:,[\]{}&*!|>'"%@`]/.test(v)) return true;              // 以 YAML 指示符开头
  if (/^-\s/.test(v)) return true;                                // 形如 "- x" 会被当序列
  if (/\s#/.test(v)) return true;                                 // 含 " #" 会被当行尾注释
  if (/:\s/.test(v)) return true;                                 // 含 ": " 会被当 key
  if (/:$/.test(v)) return true;                                  // 以 ":" 结尾
  if (/[\n\r\t]/.test(v)) return true;                            // 控制字符
  return false;
}

function yamlScalar(v: string): string {
  if (!needsQuote(v)) return v;
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * 序列化为 YAML。约定：
 * - 空数组 / 空对象 / 空串字段会被跳过（避免出现 `ports: []` 这种噪音）
 * - 数组渲染为块序列，对象渲染为块映射，其余为标量
 */
function toYamlDoc(root: Record<string, YamlValue>): string {
  const out: string[] = [];

  const emit = (key: string | null, v: YamlValue, indent: number) => {
    const pad = " ".repeat(indent);
    const head = key === null ? "" : `${pad}${key}:`;

    if (Array.isArray(v)) {
      if (v.length === 0) return; // 空数组跳过
      if (key !== null) out.push(head);
      for (const item of v) {
        if (typeof item === "string") {
          out.push(`${pad}  - ${yamlScalar(item)}`);
        } else if (Array.isArray(item)) {
          out.push(`${pad}  -`);
          emit(null, item, indent + 4);
        } else {
          // 对象：第一对写在同一行，其余缩进对齐
          const entries = Object.entries(item);
          if (entries.length === 0) { out.push(`${pad}  - {}`); return; }
          const [k0, v0] = entries[0];
          if (typeof v0 === "string") {
            out.push(`${pad}  - ${k0}: ${yamlScalar(v0)}`);
          } else {
            out.push(`${pad}  - ${k0}:`);
            emit(null, v0, indent + 4);
          }
          for (const [k, val] of entries.slice(1)) {
            if (typeof val === "string") out.push(`${pad}    ${k}: ${yamlScalar(val)}`);
            else emit(k, val, indent + 4);
          }
        }
      }
      return;
    }

    if (typeof v === "object" && v !== null) {
      const entries = Object.entries(v as Record<string, YamlValue>);
      if (entries.length === 0) return; // 空对象跳过
      if (key !== null) out.push(head);
      const childPad = key === null ? indent : indent + 2;
      for (const [k, val] of entries) emit(k, val, childPad);
      return;
    }

    // 数字标量（如 ulimits 的 soft / hard）原样输出，不加引号
    if (typeof v === "number") {
      if (key === null) out.push(`${pad}${v}`);
      else out.push(`${head} ${v}`);
      return;
    }

    // 字符串标量
    if (v === "") return; // 空值跳过
    if (key === null) out.push(`${pad}${yamlScalar(String(v))}`);
    else out.push(`${head} ${yamlScalar(String(v))}`);
  };

  for (const [k, v] of Object.entries(root)) emit(k, v, 0);
  return out.length > 0 ? `${out.join("\n")}\n` : "";
}

/* ==========================================================================
 * 三、docker run → Docker Compose
 * ========================================================================== */

/** 解析 docker run 命令行，抽出可映射的字段 */
interface RunSpec {
  image: string;
  name?: string;
  env: string[];
  envFiles: string[];
  ports: string[];
  volumes: string[];
  networks: string[];
  labels: string[];
  restart?: string;
  hostname?: string;
  user?: string;
  workdir?: string;
  entrypoint?: string;
  platform?: string;
  privileged: boolean;
  tty: boolean;
  stdinOpen: boolean;
  capAdd: string[];
  devices: string[];
  dns: string[];
  extraHosts: string[];
  links: string[];
  cpus?: string;
  cpuShares?: string;
  memory?: string;
  memorySwap?: string;
  shmSize?: string;
  pid?: string;
  ipc?: string;
  sysctls: string[];
  ulimits: string[];
  expose: string[];
  logDriver?: string;
  logOpts: string[];
  healthCmd?: string;
  healthInterval?: string;
  healthRetries?: string;
  command: string[];
}

function emptyRunSpec(): RunSpec {
  return {
    image: "", env: [], envFiles: [], ports: [], volumes: [], networks: [], labels: [],
    privileged: false, tty: false, stdinOpen: false,
    capAdd: [], devices: [], dns: [], extraHosts: [], links: [], sysctls: [], ulimits: [],
    expose: [], logOpts: [], command: [],
  };
}

/** 把 docker run 命令行解析成结构化字段（带 warning 收集） */
export function parseDockerRun(input: string, warnings: string[]): RunSpec | null {
  const tokens = tokenizeShell(input);
  if (tokens.length === 0) return null;

  // 定位 `run`：容忍 `docker run ...` / `docker container run ...` / 用户只粘了 `run ...`
  let i = 0;
  if (tokens[0] === "docker") i = 1;
  if (tokens[i] === "container") i++;
  if (tokens[i] !== "run") {
    // 容错：没写 docker/run 前缀但内容明显是 run 命令（以 - 开头且有 image）时也拒绝，避免误判
    return null;
  }
  i++;

  const spec = emptyRunSpec();
  const positionals: string[] = [];
  /** 是否已取到镜像名（取到之后的所有 token 都归 command） */
  let gotImage = false;

  /** 取下一个 token 作为选项值；缺失则记 warning */
  const takeValue = (opt: string): string | undefined => {
    const v = tokens[i];
    if (v === undefined || v.startsWith("-")) { warnings.push(`选项 ${opt} 缺少取值`); return undefined; }
    i++;
    return v;
  };

  while (i < tokens.length) {
    const t = tokens[i];
    i++;

    // --- 支持 `--opt=value` 形式 ---
    let opt = t;
    let inlineValue: string | undefined;
    const eq = t.indexOf("=");
    if (t.startsWith("--") && eq > 0) {
      opt = t.slice(0, eq);
      inlineValue = t.slice(eq + 1);
    }
    const value = (): string | undefined => {
      if (inlineValue !== undefined) { const v = inlineValue; inlineValue = undefined; return v; }
      return takeValue(opt);
    };

    switch (opt) {
      case "-d": case "--detach": break; // compose 默认后台运行，无需映射
      case "--rm": warnings.push("--rm 在 compose 中没有对应项，已忽略（compose down 会清理容器）"); break;
      case "--pull": warnings.push(`--pull ${value() ?? ""} 在 compose 中没有对应项，已忽略`); break;
      case "-P": case "--publish-all": warnings.push("-P/--publish-all 在 compose 中没有对应项，需手动列出 ports"); break;
      case "--init": warnings.push("--init 在 compose 中需用 init: true，已忽略"); break;

      case "--name": spec.name = value(); break;
      case "-e": case "--env": { const v = value(); if (v !== undefined) spec.env.push(v); break; }
      case "--env-file": { const v = value(); if (v !== undefined) spec.envFiles.push(v); break; }
      case "-p": case "--publish": { const v = value(); if (v !== undefined) spec.ports.push(v); break; }
      case "--expose": { const v = value(); if (v !== undefined) spec.expose.push(v); break; }
      case "-v": case "--volume": {
        const v = value();
        if (v !== undefined) spec.volumes.push(v);
        break;
      }
      case "--mount": {
        // --mount type=bind,src=./conf,dst=/etc/conf,ro → ./conf:/etc/conf:ro
        const v = value();
        if (v === undefined) break;
        const parts = Object.fromEntries(
          v.split(",").map((kv) => { const idx = kv.indexOf("="); return idx > 0 ? [kv.slice(0, idx), kv.slice(idx + 1)] : [kv, ""]; })
        );
        const src = parts.src || parts.source || "";
        const dst = parts.dst || parts.destination || parts.target || "";
        if (!src || !dst) { warnings.push(`--mount ${v} 无法完整映射（缺少 source/target）`); break; }
        // `ro` 是布尔标志（写法为 `,ro` 无取值），解析后值为空串，
        // 因此必须判断 key 是否存在，不能只看值是否为真。
        const readOnly = parts.readonly === "true" || ("ro" in parts && parts.ro !== "false");
        spec.volumes.push(readOnly ? `${src}:${dst}:ro` : `${src}:${dst}`);
        break;
      }
      case "--network": case "--net": { const v = value(); if (v !== undefined) spec.networks.push(v); break; }
      case "--network-alias":
        warnings.push("--network-alias 需手动写入 networks.<name>.aliases，已忽略");
        value();
        break;
      case "--restart": spec.restart = value(); break;
      case "-h": case "--hostname": spec.hostname = value(); break;
      case "-u": case "--user": spec.user = value(); break;
      case "-w": case "--workdir": spec.workdir = value(); break;
      case "--entrypoint": spec.entrypoint = value(); break;
      case "--platform": spec.platform = value(); break;
      case "-l": case "--label": { const v = value(); if (v !== undefined) spec.labels.push(v); break; }
      case "--privileged": spec.privileged = true; break;
      case "-t": case "--tty": spec.tty = true; break;
      case "-i": case "--interactive": spec.stdinOpen = true; break;
      case "--cap-add": { const v = value(); if (v !== undefined) spec.capAdd.push(v); break; }
      case "--device": { const v = value(); if (v !== undefined) spec.devices.push(v); break; }
      case "--dns": { const v = value(); if (v !== undefined) spec.dns.push(v); break; }
      case "--add-host": { const v = value(); if (v !== undefined) spec.extraHosts.push(v); break; }
      case "--link": { const v = value(); if (v !== undefined) spec.links.push(v); break; }
      case "--cpus": spec.cpus = value(); break;
      case "-c": case "--cpu-shares": spec.cpuShares = value(); break;
      case "-m": case "--memory": spec.memory = value(); break;
      case "--memory-swap": spec.memorySwap = value(); break;
      case "--shm-size": spec.shmSize = value(); break;
      case "--pid": spec.pid = value(); break;
      case "--ipc": spec.ipc = value(); break;
      case "--sysctl": { const v = value(); if (v !== undefined) spec.sysctls.push(v); break; }
      case "--ulimit": { const v = value(); if (v !== undefined) spec.ulimits.push(v); break; }
      case "--log-driver": spec.logDriver = value(); break;
      case "--log-opt": { const v = value(); if (v !== undefined) spec.logOpts.push(v); break; }
      case "--health-cmd": spec.healthCmd = value(); break;
      case "--health-interval": spec.healthInterval = value(); break;
      case "--health-retries": spec.healthRetries = value(); break;

      default:
        // docker run 的语法是 `docker run [选项] 镜像 [命令 [参数...]]`：
        // 一旦遇到第一个非选项 token（= 镜像），其后所有内容都是容器命令，
        // **不能再当 run 选项解析**——否则 `redis-server --appendonly yes`
        // 里的 `--appendonly` 会被误判成未知选项。
        if (opt.startsWith("-") && !gotImage) {
          warnings.push(`未识别选项 ${opt}，已忽略（转换结果可能不完整）`);
        } else if (!gotImage) {
          gotImage = true;
          positionals.push(t);
          // 剩余 token 原样收进 command（含后续所有 --xxx）
          while (i < tokens.length) positionals.push(tokens[i++]);
          break;
        } else {
          positionals.push(t);
        }
    }
    if (gotImage) break;
  }

  if (positionals.length === 0) return null;
  spec.image = positionals[0];
  spec.command = positionals.slice(1);
  return spec;
}

/** docker run 命令 → compose YAML */
export function dockerRunToCompose(input: string): ConvertResult {
  const warnings: string[] = [];
  if (!input.trim()) return failed("请输入 docker run 命令");

  const spec = parseDockerRun(input, warnings);
  if (!spec) return failed("未识别为 docker run 命令（需以 docker run 开头，且包含镜像名）", warnings);
  if (!spec.image) return failed("命令中缺少镜像名", warnings);

  // 服务名：优先用 --name，否则从镜像名推导（nginx:alpine → nginx）
  const serviceName = (spec.name || spec.image.split("/").pop()!.split(":")[0])
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase() || "app";

  const service: Record<string, YamlValue> = { image: spec.image };

  const put = (key: string, v: YamlValue | undefined) => {
    if (v === undefined) return;
    if (Array.isArray(v) && v.length === 0) return;
    if (v === "") return;
    service[key] = v;
  };

  put("container_name", spec.name);
  put("hostname", spec.hostname);
  put("restart", spec.restart);
  put("user", spec.user);
  put("working_dir", spec.workdir);
  put("entrypoint", spec.entrypoint);
  put("platform", spec.platform);
  put("pid", spec.pid);
  put("ipc", spec.ipc);
  put("shm_size", spec.shmSize);
  put("mem_limit", spec.memory);
  put("memswap_limit", spec.memorySwap);
  put("cpus", spec.cpus);
  put("cpu_shares", spec.cpuShares);
  put("privileged", spec.privileged ? "true" : "");
  put("tty", spec.tty ? "true" : "");
  put("stdin_open", spec.stdinOpen ? "true" : "");

  put("ports", spec.ports);
  put("expose", spec.expose);
  put("volumes", spec.volumes);
  put("environment", spec.env);
  put("env_file", spec.envFiles);
  put("labels", spec.labels);
  put("cap_add", spec.capAdd);
  put("devices", spec.devices);
  put("dns", spec.dns);
  put("extra_hosts", spec.extraHosts);
  put("links", spec.links);
  put("sysctls", spec.sysctls);

  if (spec.ulimits.length > 0) {
    // --ulimit nofile=1024:1024 → ulimits.nofile: {soft, hard}
    const ulimits: Record<string, YamlValue> = {};
    for (const u of spec.ulimits) {
      const [name, val] = u.split("=");
      if (!name) continue;
      if (val && val.includes(":")) {
        // soft/hard 必须是数字，否则 docker compose 会报类型错误
        const [soft, hard] = val.split(":");
        const toNum = (x: string) => (/^-?\d+$/.test(x.trim()) ? Number(x.trim()) : x.trim());
        ulimits[name] = { soft: toNum(soft), hard: toNum(hard) };
      } else {
        ulimits[name] = val ?? "";
      }
    }
    if (Object.keys(ulimits).length > 0) service.ulimits = ulimits;
  }

  if (spec.logDriver || spec.logOpts.length > 0) {
    const logging: Record<string, YamlValue> = {};
    if (spec.logDriver) logging.driver = spec.logDriver;
    if (spec.logOpts.length > 0) {
      const options: Record<string, YamlValue> = {};
      for (const o of spec.logOpts) {
        const idx = o.indexOf("=");
        if (idx > 0) options[o.slice(0, idx)] = o.slice(idx + 1);
      }
      if (Object.keys(options).length > 0) logging.options = options;
    }
    service.logging = logging;
  }

  if (spec.healthCmd || spec.healthInterval || spec.healthRetries) {
    const health: Record<string, YamlValue> = {};
    if (spec.healthCmd) health.test = `CMD-SHELL, ${spec.healthCmd}`;
    if (spec.healthInterval) health.interval = spec.healthInterval;
    if (spec.healthRetries) health.retries = spec.healthRetries;
    service.healthcheck = health;
    if (spec.healthCmd) warnings.push("healthcheck.test 已按 CMD-SHELL 形式生成，可按需改为数组格式");
  }

  if (spec.networks.length > 0) service.networks = spec.networks;

  // command：单个词直接写，多个词用数组（保留原始分词，避免 shell 二次解析出错）
  if (spec.command.length === 1) service.command = spec.command[0];
  else if (spec.command.length > 1) service.command = spec.command;

  return done(toYamlDoc({ services: { [serviceName]: service } }), warnings);
}

/** 按方向分发转换（UI 统一入口） */
export function convert(input: string): ConvertResult {
  return dockerRunToCompose(input);
}
