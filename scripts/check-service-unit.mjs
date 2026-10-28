#!/usr/bin/env node
/**
 * systemd unit 门禁（npm run test:service，并入 test:gates）
 *
 * 背景：v1.39.3 修复「服务启动失败 status=226/NAMESPACE」。根因是
 *   ReadWritePaths= 里的 /run/docker.sock 在未装 Docker 的机器上不存在，
 *   systemd 在**挂载 namespace 阶段**就退出（早于 ExecStartPre），
 *   日志里没有任何程序输出，极易被误判成程序故障。
 *
 * 本门禁把「必须带 - 前缀」这条不变量钉住，防止以后有人清理时把 "-" 去掉。
 * 同时守住另外两个历史踩过的坑：SupplementaryGroups（无 docker 组 → 216/GROUP）、
 * WorkingDirectory 与 install.sh 的 INSTALL_DIR 必须一致。
 *
 * 零网络、零依赖，纯文本断言。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNIT = path.join(ROOT, "deploy", "linux", "dockermanagementyanzi.service");
const INSTALL = path.join(ROOT, "deploy", "linux", "install.sh");
const UNINSTALL = path.join(ROOT, "deploy", "linux", "uninstall.sh");
const UNIT_STATUS = path.join(ROOT, "server", "unit-status.ts");
const DAEMON_CFG = path.join(ROOT, "server", "daemon-config.ts");

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

console.log("── ① unit 文件可读且含关键字段");
if (!fs.existsSync(UNIT)) {
  console.log(`  ✗ unit 文件不存在: ${UNIT}`);
  process.exit(1);
}
const u = fs.readFileSync(UNIT, "utf-8");
const inst = fs.existsSync(INSTALL) ? fs.readFileSync(INSTALL, "utf-8") : "";
const uni = fs.existsSync(UNINSTALL) ? fs.readFileSync(UNINSTALL, "utf-8") : "";

check("含 [Service] 段", /^\[Service\]$/m.test(u));
check("声明 User 且非 root", /^User=(?!root)\S+$/m.test(u));
check("声明 Group", /^Group=\S+$/m.test(u));
check("声明 RuntimeDirectory", /^RuntimeDirectory=/m.test(u));
check("含 ExecStartPre（DMI 镜像）", /^ExecStartPre=\+/m.test(u));

console.log("── ② ReadWritePaths 每项必须带 '-' 前缀（226/NAMESPACE 防线）");
const rwpLines = u
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /^ReadWritePaths=/.test(l));
check("ReadWritePaths 至少声明 1 项", rwpLines.length > 0);

// 收集所有路径（支持单行多值与多行两种写法）
const rwpPaths = rwpLines.flatMap((l) =>
  l
    .slice("ReadWritePaths=".length)
    .split(/\s+/)
    .filter(Boolean),
);
check(
  `全部 ${rwpPaths.length} 项都带 '-' 前缀（缺失即启动失败）`,
  rwpPaths.length > 0 && rwpPaths.every((p) => p.startsWith("-")),
);
for (const p of rwpPaths) {
  check(`  · ${p} 使用可选语义`, p.startsWith("-"));
}
// 关键路径必须仍受保护（不能为了通过门禁把路径整个删掉）
// 安装目录项在 v1.41.1 起改用 __INSTALL_DIR__ 占位符（支持自定义目录），故此处断言占位符形态。
for (const need of ["__INSTALL_DIR__", "/run/docker.sock", "/var/run/docker.sock", "/etc/docker"]) {
  check(`仍声明 ${need}`, rwpPaths.some((p) => p.slice(1) === need));
}

console.log("── ③ 安装目录占位符（v1.41.1：支持自定义安装目录）");
const wd = (u.match(/^WorkingDirectory=(.*)$/m) || [])[1];
check("unit 的 WorkingDirectory 使用 __INSTALL_DIR__ 占位符", wd === "__INSTALL_DIR__");
check(
  "unit 的 ExecStart 使用 __INSTALL_DIR__ 占位符",
  /^ExecStart=__INSTALL_DIR__\/dockermanagementyanzi$/m.test(u),
);
check(
  "unit 的 DOCKER_CONFIG 使用 __INSTALL_DIR__ 占位符",
  /DOCKER_CONFIG=__INSTALL_DIR__\/config\/docker-cli/.test(u),
);
check(
  "unit 四条路径类指令不再硬编码 /opt/dockermanagementyanzi",
  !/^(WorkingDirectory|ExecStart|ReadWritePaths|Environment)=.*\/opt\/dockermanagementyanzi/m.test(u),
);
check(
  "install.sh 默认安装目录 /opt/<APP_NAME>（回车默认值）",
  /DEFAULT_INSTALL_DIR="\/opt\/\$\{APP_NAME\}"/.test(inst),
);
check(
  "install.sh 对 __INSTALL_DIR__ 做 sed 替换（四处共用同一路径）",
  /s\|__INSTALL_DIR__\|/.test(inst),
);
check(
  "★ 替换后自检占位符清零（漏替换宁可就地失败，不装出坏服务）",
  /grep -q '__INSTALL_DIR__' "\$UNIT_FILE"/.test(inst),
);
check(
  "★ 自检 WorkingDirectory 已指向实际目录",
  /WorkingDirectory=\$\{INSTALL_DIR_SED\}/.test(inst),
);

console.log("── ④ install.sh 关键防线仍在");
check(
  "socket 不存在时给出提示（「-」前缀会静默忽略，不能让用户蒙在鼓里）",
  /未检测到 \/var\/run\/docker\.sock/.test(inst),
);
check(
  "启动失败时对 226/NAMESPACE 做专项诊断",
  /ReadWritePaths 中的路径不存在/.test(inst),
);
check(
  "无 docker 组时裁剪 SupplementaryGroups（216/GROUP 防线）",
  /sed -i '\/\^SupplementaryGroups=docker\$\/d'/.test(inst),
);
check(
  "NoNewPrivileges=no 保留（sudo 提权写 daemon.json 需要）",
  /^NoNewPrivileges=no$/m.test(u),
);

console.log("── ⑤ v1.39.4：安装期 Docker 状态与账号自愈（真实用户踩过的坑）");
// ★ 铁律：安装脚本**只检测、绝不代管**用户的 docker 服务（与「绝不代装 Docker」同源）。
//   守护进程未运行时必须**醒目提示 + 给出命令**，但绝不执行 systemctl start docker。
check(
  "守护进程未运行时提示会导致 226（点明 ReadWritePaths 机制）",
  /226\/NAMESPACE/.test(inst) && /ReadWritePaths/.test(inst),
);
check(
  "给出 systemctl start docker 命令让用户自行执行",
  /systemctl start docker && systemctl enable docker/.test(inst),
);
check(
  "★ 绝不代为执行 systemctl start docker（铁律：只检测不代管）",
  !/systemctl start docker 2>\/dev\/null/.test(inst) && !/^\s*systemctl start docker\s*$/m.test(inst),
);
// 手工解压部署（未跑 install.sh）⇒ 用户不存在 ⇒ 203/USER
check(
  "服务用户不存在时给出 203/USER 提示（手工部署自愈）",
  /id -u "\$SERVICE_USER" &>\/dev\/null/.test(inst) && /203\/USER/.test(inst),
);
check(
  "用户不存在时提示重跑 install.sh",
  /sudo bash install\.sh/.test(inst),
);
// v1.40.1：服务账户跟随系统用户，不再单独建账户。
// 安装时交互输入账户名，必须与已存在的系统用户匹配才放行；拒绝 root。
check(
  "不再单独创建服务账户（跟随系统用户，无 useradd -r）",
  !/"\$USERADD" -r -g "\$SERVICE_USER"/.test(inst),
);
check(
  "交互输入 / APP_RUN_AS_USER 指定服务运行账户",
  /APP_RUN_AS_USER/.test(inst),
);
check(
  "校验账户必须是已存在的系统用户（getent passwd）",
  /getent passwd "\$(?:APP_RUN_AS_USER|SERVICE_USER)"/.test(inst),
);
check(
  "拒绝 root 作为服务账户",
  /服务账户不能是 root/.test(inst) || /APP_RUN_AS_USER 必须是已存在的非 root/.test(inst),
);
// v1.40.3：交互改为「列出候选用户供序号选择」（不再静默默认 SUDO_USER），
// 且 chown 递归归属必须用**实际主组**——写 "user:user" 会在没有同名组的系统
// （如 Debian：用户 yanzi 主组是 Users）报 `chown: invalid group` 并因 set -e
// 让安装中断在部署阶段。两条都钉死防回归。
check(
  "交互列出候选系统用户供序号选择（不静默默认）",
  /getent passwd \| awk/.test(inst) && /grep -qE '\^\[0-9\]\+\$'/.test(inst),
);
check(
  "★ v1.42.2：候选列表只含登录用户（shell 非 nologin/false），系统服务账户被隐藏",
  /nologin\|false/.test(inst) && !/CANDIDATE_SERVICE/.test(inst),
);
check(
  "★ v1.42.2：已删除「以下为系统服务账户」分段提示行",
  !/以下为系统服务账户/.test(inst),
);
check(
  "★ v1.42.2：GECOS 描述只取首个逗号前的全名（不打印 ',,,' 尾随空字段）",
  /user_desc\(\)/.test(inst) && /gecos="\$\{gecos%%,\*\}"/.test(inst),
);
check(
  "★ v1.42.2：序号映射与展示列表一致（隐藏的账户不参与编号）",
  /CANDIDATE_ALL="\$CANDIDATE_USERS"/.test(inst),
);
check(
  "★ 递归归属使用实际主组而非用户名",
  /chown -R "\$\{SERVICE_USER\}:\$\{SERVICE_GROUP\}"/.test(inst) &&
    !/chown -R "\$\{SERVICE_USER\}:\$\{SERVICE_USER\}"/.test(inst),
);
check(
  "组名解析失败时 fail-soft（不让 set -e 中断安装）",
  /id -gn "\$SERVICE_USER" 2>\/dev\/null \|\| true/.test(inst),
);

console.log("── ⑥ v1.41.1/1.41.2：安装目录可选（v1.41.2 取消双关卡）");
// 交互选择安装目录（回车默认）；非交互用 APP_INSTALL_DIR
check(
  "交互询问安装目录（提示语按有无旧版本分别措辞）",
  /PROMPT_TEXT=/.test(inst) && /read -r -p "\$\{PROMPT_TEXT\}: "/.test(inst),
);
check("非交互可用 APP_INSTALL_DIR 指定", /APP_INSTALL_DIR/.test(inst));
// 路径白名单校验：绝对路径 / 无 .. / 字符白名单 / 拒系统目录
check(
  "路径校验函数与拒绝清单（DENY_EXACT / DENY_PREFIX）",
  /validate_install_dir\(\)/.test(inst) && /DENY_EXACT=/.test(inst) && /DENY_PREFIX=/.test(inst),
);
check(
  "拒绝相对路径 / .. 回溯 / 空格与 shell 特殊字符",
  /必须是绝对路径/.test(inst) && /路径中不允许出现 \.\./.test(inst) && /禁空格/.test(inst),
);
check(
  "拒绝把系统根级目录当安装目录",
  /不允许使用系统目录/.test(inst) && /不允许安装在系统路径/.test(inst),
);
// ★ v1.41.2：取消原「双关卡」（用户真机反馈：① 与下面「检查 Docker 依赖」段自相矛盾；
//   ② 真机徒增摩擦；③ 触发该段一个 set -u 未定义变量崩溃）
check(
  "★ 不再要求改目录前先停 Docker（v1.41.2 取消硬门槛）",
  !/docker_running\(\)/.test(inst) && !/检测到 Docker 守护进程仍在运行/.test(inst),
);
check(
  "★ 不再要求输入登录密码（取消真校验，相关函数已删净）",
  !/verify_login_password\(\)/.test(inst) &&
    !/pick_verify_user/.test(inst) &&
    !/confirm_by_typing/.test(inst) &&
    !/pamtester/.test(inst) &&
    !/read -r -s -p/.test(inst),
);
check(
  "★ 仍绝不代为停止 docker（铁律：只检测不代管 systemd 服务）",
  !/^\s*systemctl stop docker\s*$/m.test(inst) &&
    !/systemctl stop docker 2>\/dev\/null/.test(inst),
);
check(
  "★ 仍绝不代为启动 docker（v1.39.4 铁律未被破坏）",
  !/^\s*systemctl start docker\s*$/m.test(inst) &&
    !/systemctl start docker 2>\/dev\/null/.test(inst),
);
// ★★ v1.41.2 崩溃回归：set -u 下「检查 Docker 依赖」段曾引用尚未赋值的 ${SERVICE_USER}，
//   而 SERVICE_USER 要到「配置服务运行账户」段才赋值 ⇒ 只要 docker 守护进程未运行，
//   该分支就被走到、install.sh 直接崩（line 401: SERVICE_USER: unbound variable）。
//   SERVICE_USER 的赋值语句位置 + 该段内不得出现该变量，双重钉死。
check(
  "★ SERVICE_USER 赋值晚于「检查 Docker 依赖」段（赋值为字面量，非引用）",
  /^SERVICE_USER="\$APP_RUN_AS_USER"$/m.test(inst) &&
    inst.indexOf("SERVICE_USER=\"$APP_RUN_AS_USER\"") >
      inst.indexOf('title "检查 Docker 依赖"'),
);
check(
  "★ 「检查 Docker 依赖」段内不得引用 SERVICE_USER（set -u 崩溃防线）",
  (() => {
    const s = inst.indexOf('title "检查 Docker 依赖"');
    const e = inst.indexOf("title \"配置磁盘温度传感器");
    return s >= 0 && e > s && !/\$\{?SERVICE_USER\}?/.test(inst.slice(s, e));
  })(),
);
// ★ v1.41.4 起：安装时**先**检测旧版本（systemd 单元 WorkingDirectory）；v1.41.5 起统一为
//   单一提示——有旧版本回车沿用旧路径升级，否则回车用默认 /opt/dockermanagementyanzi。
check(
  "★ v1.41.4：安装目录选择前先检测旧版本（WorkingDirectory 为事实来源）",
  (() => {
    const det = inst.indexOf('OLD_INSTALL_DIR=""');
    const sel = inst.indexOf('title "选择安装目录"');
    return det >= 0 && sel > det;
  })(),
);
check(
  "★ v1.42.0：安装目录提示按有无旧版本分别措辞（旧版本场景只说「回车升级 / 手动输入新路径」）",
  /PROMPT_TEXT="检测到本机已安装在 \$\{OLD_INSTALL_DIR\}（回车升级）或者手动输入新路径"/.test(inst) &&
    /PROMPT_TEXT="请输入安装目录（回车使用默认 \$\{DEFAULT_INSTALL_DIR\}）"/.test(inst),
);
check(
  "★ v1.42.0：旧版本场景的提示语不再混入无关分支（「否则回车使用 /opt…」已移除）",
  /PROMPT_TEXT="[^"]*否则回车使用/.test(inst) === false,
);
check(
  "★ v1.42.0：去掉了与提示行重复的 log 行（[INFO] 不再复述一遍）",
  !/log "检测到本机已安装在 \$\{OLD_INSTALL_DIR\}/.test(inst),
);
check(
  "★ v1.42.3：已移除「升级时请沿用本次安装目录」提示（自动探测旧目录后该提示冗余且误导）",
  !/log "  提示: 升级时请沿用本次安装目录/.test(inst),
);
check(
  "★ v1.42.3：旧安装目录自动探测仍在（升级回车即沿用，是移除该提示的前提）",
  /OLD_INSTALL_DIR="\$\{OLD_INSTALL_DIR\}"/.test(inst) ||
    /grep -E '\^WorkingDirectory='/.test(inst),
);
check(
  "★ v1.41.5+：用户输入非旧路径即作为新安装目录（仍过 validate_install_dir，并触发迁移询问）",
  /INSTALL_DIR="\$\{ans:-\$PROMPT_DEFAULT\}"/.test(inst) &&
    /是否把旧目录的数据/.test(inst),
);
// 旧安装目录：探测 / 迁移 / 保留与否
check(
  "旧安装目录从 systemd 单元探测（WorkingDirectory 为事实来源）",
  /OLD_INSTALL_DIR/.test(inst) && /grep -E '\^WorkingDirectory=' "\$LEGACY_UNIT"/.test(inst),
);
check("迁移前提示是否迁移（Y/n）", /是否把旧目录的数据/.test(inst));
check(
  "迁移不覆盖新目录已有文件（cp -a -n）",
  /cp -a -n/.test(inst),
);
check(
  "迁移后再询问是否保留旧目录",
  /是否保留旧安装目录/.test(inst),
);
check(
  "★ 删除旧目录需输入 DELETE 二次确认（绝不静默删数据）",
  /确认删除请输入 DELETE/.test(inst),
);
check(
  "删除旧目录前挡住空值 / 根目录",
  /"\$OLD_INSTALL_DIR" != "\/" *\]/.test(inst) && /-n "\$OLD_INSTALL_DIR"/.test(inst),
);
// uninstall.sh 必须能定位自定义安装目录
check(
  "uninstall.sh 从 systemd 单元读实际安装目录（自定义目录也能卸干净）",
  /grep -E '\^WorkingDirectory=' "\$UNIT_FILE"/.test(uni),
);
check(
  "uninstall.sh 保留默认值兜底（APP_INSTALL_DIR / /opt/<APP_NAME>）",
  /DEFAULT_INSTALL_DIR="\/opt\/\$\{APP_NAME\}"/.test(uni) && /APP_INSTALL_DIR/.test(uni),
);

console.log("── ⑦ v1.41.1/1.41.3：服务端必须还原占位符，否则自检/修复提示会写坏单元");
// 构建期嵌入的单元模板里有三类占位符（__INSTALL_DIR__ / __SERVICE_USER__ / __SERVICE_GROUP__），
// 后端比对前必须全部还原：
//   不还原 ⇒ ① 一直误报「服务单元落后」；② 「一键修复」会把占位符原样 tee 进
//   /etc/systemd/system ⇒ 服务直接起不来（如 User=__SERVICE_USER__ ⇒ 启动即 216/USER）。
const us = fs.existsSync(UNIT_STATUS) ? fs.readFileSync(UNIT_STATUS, "utf-8") : "";
const dc = fs.existsSync(DAEMON_CFG) ? fs.readFileSync(DAEMON_CFG, "utf-8") : "";
check(
  "unit-status.ts 存在且导出统一的占位符还原函数 resolveUnitTemplate",
  us.includes("resolveUnitTemplate"),
);
check(
  "★ resolveUnitTemplate 还原 __INSTALL_DIR__（安装目录）",
  /replace\(\/__INSTALL_DIR__\/g, installDir\)/.test(us),
);
check(
  "★ resolveUnitTemplate 还原 __SERVICE_USER__（服务运行账户）",
  /replace\(\/__SERVICE_USER__\/g, user\)/.test(us),
);
check(
  "★ resolveUnitTemplate 还原 __SERVICE_GROUP__（服务主组）",
  /replace\(\/__SERVICE_GROUP__\/g, group\)/.test(us),
);
check(
  "★ 账户/主组取值优先取自已安装单元当前生效的 User=/Group=（救回被写成占位符的单元）",
  /resolveUnitUserGroup/.test(us) && /User=\(.\*\)\$/.test(us),
);
check(
  "★ 安装目录取自 process.execPath（SEA 部署即安装目录）",
  /resolveInstallDir\(\)/.test(us) && /path\.dirname\(process\.execPath\)/.test(us),
);
check(
  "★ 拿不到安装目录（开发模式）⇒ applicable=false，不给修复命令（防写坏单元）",
  /installDir !== null/.test(us),
);
check(
  "★ daemon-config 的修复提示不再硬编码 /opt 安装目录",
  !/ReadWritePaths=\/opt\//.test(dc),
);
check(
  "★ 修复提示改 drop-in 追加且每项带 '-' 前缀（防 226/NAMESPACE）",
  /10-allow-etc-docker\.conf/.test(dc) && /ReadWritePaths=-\$\{DAEMON_DIR\}/.test(dc),
);
check(
  "★ 修复提示不再用 sed 整行改写原单元（会丢 '-' 前缀并只剩一条）",
  !/sed -i 's\|\^ReadWritePaths=/.test(dc),
);

// 模板只允许这三类已知占位符，杜绝新引入未还原的 __X__
const unitTpl = fs.existsSync(UNIT) ? fs.readFileSync(UNIT, "utf-8") : "";
const strayPlaceholders = [...unitTpl.matchAll(/__[A-Z_]+__/g)]
  .map((m) => m[0])
  .filter((p) => !["__INSTALL_DIR__", "__SERVICE_USER__", "__SERVICE_GROUP__"].includes(p));
check(
  `★ 单元模板只允许三类已知占位符（发现越界占位符: ${strayPlaceholders.join(",") || "无"}）`,
  strayPlaceholders.length === 0,
);

console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
