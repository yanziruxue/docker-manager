#!/usr/bin/env bash
# ============================================
# Docker Stack Manager — Linux 安装脚本
#
# 前提：已运行 build.sh 生成二进制
#
# 用法：
#   sudo bash install.sh
# ============================================
set -euo pipefail

# 固定 PATH：精简 Debian 容器 / 最小镜像常缺 /usr/sbin，导致 useradd / usermod / groupadd /
# visudo / runuser 报「未找到命令」（文件其实就在 /usr/sbin 下，只是 shell 找不到）。
# 取值与 dockermanagementyanzi.service 内的 Environment="PATH=..." 保持一致。
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

APP_NAME="dockermanagementyanzi"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# ★ 安装目录可自定义（v1.41.1）：回车默认 /opt/<APP_NAME>。
#   非交互环境用环境变量 APP_INSTALL_DIR=<绝对路径> 指定。
#   v1.41.2 起**不再要求**先停 Docker、也不再要求输入登录密码（原两道关卡已取消）；
#   目录合法性由 validate_install_dir() 的路径白名单把关。
DEFAULT_INSTALL_DIR="/opt/${APP_NAME}"
INSTALL_DIR=""
# DATA_DIR / LOG_DIR / CONFIG_DIR 在「选择安装目录」段落定稿后计算（见下）
# SERVICE_USER 在安装期「配置服务运行账户」段落交互设定（跟随系统用户，不再单独建账户）

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()   { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
title() { echo -e "\n${BLUE}━━━ $* ━━━${NC}"; }

# 命令解析：先查 PATH，再退回常见绝对路径（/usr/sbin 等）。找不到返回非 0。
# 注意：必须在主 shell 里用 `VAR="$(cmd_path x)" || err ...` 调用 ——
# 写成 `$(err ...)` 时 exit 只会终止子 shell，主脚本会带着空变量继续跑。
cmd_path() {
  local name="$1" p
  command -v "$name" 2>/dev/null && return 0
  for p in /usr/sbin /sbin /usr/bin /bin /usr/local/sbin /usr/local/bin; do
    if [ -x "${p}/${name}" ]; then echo "${p}/${name}"; return 0; fi
  done
  return 1
}

# 校验后取出命令路径；缺失则直接报错退出（exit 在主 shell 内生效）
require_cmd() {
  local name="$1" found
  if found="$(cmd_path "$name")"; then echo "$found"; return 0; fi
  err "未找到命令 ${name}：PATH 与 /usr/sbin、/sbin 等常见目录中均不存在。
      精简系统请先安装依赖包：apt-get update && apt-get install -y passwd   # 提供 useradd/usermod/groupadd"
}

usage() {
  cat <<'EOF'
用法: sudo bash install.sh [选项]

选项:
  --ignore-docker             跳过 Docker / Docker Compose 检查（应用可安装，但容器管理不可用）
  --no-drivetemp              跳过 drivetemp 内核模块配置（不加载、不写 /etc/modules-load.d）
  -h, --help                  显示本帮助

环境变量:
  APP_INSTALL_DIR=<绝对路径>   指定安装目录（非交互场景用；默认 /opt/dockermanagementyanzi）
  APP_RUN_AS_USER=<系统用户>   指定服务运行账户（非交互场景用）

安装目录:
  交互执行时会提示输入，回车即用默认 /opt/dockermanagementyanzi。
  目录需为绝对路径、不含 ..、至少两级，且不得落在系统关键目录下
  （/etc、/usr、/var、/home、/root、/tmp 等会被拒绝；/mnt、/media 下的数据盘目录可用）。

前提: 本脚本不再自动安装 Docker。请先装好 Docker 与 Docker Compose 再执行；
      检测到缺失时会提示并停止安装（不修改系统）。
EOF
}

# 是否跳过 Docker 依赖检查（默认不跳过：缺失即停止安装）
IGNORE_DOCKER=0
# 是否跳过 drivetemp 内核模块配置（默认不跳过：SATA/HDD 温度依赖它，见下方「配置磁盘温度传感器」）
SKIP_DRIVETEMP=0
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --ignore-docker|--no-docker|--skip-docker) IGNORE_DOCKER=1 ;;
    --no-drivetemp|--skip-drivetemp) SKIP_DRIVETEMP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) warn "未知参数：${1:-}（用 -h 查看帮助）" ;;
  esac
  shift || true
done

if [ "$(id -u)" -ne 0 ]; then
  err "安装需要 root 权限: sudo bash install.sh"
fi

BINARY="${SCRIPT_DIR}/${APP_NAME}"
if [ ! -f "$BINARY" ]; then
  err "未找到二进制 ${BINARY}，请先运行: bash build.sh"
fi

# ===========================================================================
# 旧名称安装迁移（v1.41.5 重命名）
#
# 本应用自 v1.41.5 起部署名由 docker-manager-yanzi 改为 dockermanagementyanzi
# （服务单元 / 二进制 / 安装目录默认 / zip 内结构均同步改名）。若本机已安装**旧名称**
# 服务（docker-manager-yanzi.service）且**新名称**服务尚不存在，则自动把旧单元文件
# 重命名为新名称（保留其 WorkingDirectory ⇒ 沿用原安装目录，数据不丢）。
# 随后「检测旧版本安装」段会把新单元当作「已安装版本」处理，提示原地升级。
# 单元内容稍后由 install.sh 用最新模板整体重写（含新的二进制路径），此处不改内容。
# ===========================================================================
OLD_NAME_UNIT="/etc/systemd/system/docker-manager-yanzi.service"
if [ -f "$OLD_NAME_UNIT" ] && [ ! -f "/etc/systemd/system/${APP_NAME}.service" ]; then
  log "检测到旧名称安装（docker-manager-yanzi），自动迁移服务单元到 ${APP_NAME}..."
  systemctl stop docker-manager-yanzi 2>/dev/null || true
  mv "$OLD_NAME_UNIT" "/etc/systemd/system/${APP_NAME}.service"
  systemctl daemon-reload 2>/dev/null || true
  log "已迁移服务单元；安装目录沿用旧单元的 WorkingDirectory（数据不丢）"
fi

# ===========================================================================
# 检测旧版本安装（v1.41.4；v1.41.5 叠加旧名称迁移）
#
# 旧版本事实来源 = systemd 单元的 WorkingDirectory（比自建记录文件可靠；老版本
# 单元里是写死的安装路径，新版本是替换后的实际路径）。检测到即视为「存在旧版本」，
# 下方「选择安装目录」段会据此发起「是否按旧路径升级安装」的询问；用户拒绝后再
# 输入新路径。空 / 未替换的骨架占位符 / 目录已不存在 ⇒ 视作没有旧安装。
# ===========================================================================
OLD_INSTALL_DIR=""
LEGACY_UNIT="/etc/systemd/system/${APP_NAME}.service"
if [ -f "$LEGACY_UNIT" ]; then
  OLD_INSTALL_DIR="$(grep -E '^WorkingDirectory=' "$LEGACY_UNIT" 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi
case "$OLD_INSTALL_DIR" in
  ""|*__INSTALL_DIR__*) OLD_INSTALL_DIR="" ;;
esac
if [ -n "$OLD_INSTALL_DIR" ] && [ ! -d "$OLD_INSTALL_DIR" ]; then
  OLD_INSTALL_DIR=""
fi

# ===========================================================================
# 选择安装目录（v1.41.1；v1.41.2 取消两道关卡；v1.41.4 支持按旧版本路径升级）
#
# 默认 /opt/dockermanagementyanzi，交互回车即用；也可用 APP_INSTALL_DIR 指定。
# 若检测到本机已安装旧版本，交互回车即沿用其安装目录原地升级；也可直接输入新路径
#（随后询问是否迁移数据）。统一为单一提示：有旧版本回车用旧路径，否则回车用默认 /opt/dockermanagementyanzi。
# 安装目录会被写进 systemd 单元的 WorkingDirectory / ExecStart / ReadWritePaths /
# DOCKER_CONFIG，故必须过 validate_install_dir() 的路径白名单（见下）。
#
# ★ v1.41.2：用户真机反馈后**取消**原先的两道关卡：
#     ① 「必须先手动停止 Docker」——取消（用户自行决定何时起停 docker）
#     ② 「必须校验系统登录密码」——取消（不再要求输密码）
#   原因：① 与「检查 Docker 依赖」段自相矛盾 —— 停了 docker 后那段会告警
#   「守护进程未运行」，且触发了该段里一个 set -u 未定义变量崩溃（已一并修）；
#   ② 真机上徒增摩擦。目录选择本身保留（白名单校验仍在）。
# ===========================================================================
title "选择安装目录"

# ---------------------------------------------------------------------------
# 路径合法性校验（返回 0 = 合法；不合法时把原因 echo 到 stdout）
#
# 规则故意收窄 —— 安装目录要进 systemd 单元、要过 sed 替换、要作为 ReadWritePaths
# 的 bind-mount 目标，必须绝对安全：
#   · 绝对路径、无 `..` 段、至少两级（如 /data/dockermanagementyanzi）
#   · 不许等于系统根级目录（/opt、/var、/usr…）或落在系统关键子树下
#   · 字符白名单 [A-Za-z0-9._/-] —— 空格会让 systemd 把路径切断，
#     & | " ' $ ` 等会被 sed / shell / systemd 二次解释
# ---------------------------------------------------------------------------
DENY_EXACT="/bin /boot /dev /etc /home /lib /lib32 /lib64 /media /mnt /opt /proc /root /run /sbin /srv /sys /tmp /usr /var"
# ★ /home 与 /root 一律拒绝：单元里 ProtectHome=yes 会把 /home 替换成空目录，
#   装在那里服务读不到自己的文件（即使 ReadWritePaths 声明了，语义也很脆）。
# ★ /tmp 拒绝：tmpfs 重启即清空，装在那儿等于每次重启都要重装。
# ★ /mnt 与 /media **允许**：NAS 上数据盘常挂在那里（/mnt/disk1/... 是真实诉求）。
DENY_PREFIX="/bin/ /boot/ /dev/ /etc/ /home/ /lib/ /lib32/ /lib64/ /proc/ /root/ /run/ /sbin/ /sys/ /tmp/ /usr/bin/ /usr/sbin/ /usr/lib/ /usr/local/bin/ /usr/local/sbin/ /var/lib/docker/ /var/lib/systemd/"

validate_install_dir() {
  local d="$1" norm x p
  case "$d" in
    /*) ;;
    *) echo "必须是绝对路径（以 / 开头）"; return 1 ;;
  esac
  case "$d" in
    *..*) echo "路径中不允许出现 ..（禁止相对回溯）"; return 1 ;;
  esac
  case "$d" in
    *[!A-Za-z0-9._/-]*) echo "路径只允许字母 / 数字 / . / _ / -（禁空格、& | \" ' \$ \` 等字符）"; return 1 ;;
  esac
  norm="${d%/}"
  [ -n "$norm" ] || { echo "不能把根目录 / 作为安装目录"; return 1; }
  case "$norm" in
    /*/*) ;;
    *) echo "目录层级过浅（至少形如 /data/${APP_NAME}），避免误选根级目录"; return 1 ;;
  esac
  for x in $DENY_EXACT; do
    if [ "$norm" = "$x" ]; then echo "不允许使用系统目录 ${x}（请在其下新建子目录）"; return 1; fi
  done
  for p in $DENY_PREFIX; do
    case "${norm}/" in
      ${p}*) echo "不允许安装在系统路径 ${p}* 下"; return 1 ;;
    esac
  done
  return 0
}

# 统一安装目录提示：有旧版本时回车沿用旧路径升级；无旧版本时回车用默认 /opt/dockermanagementyanzi
# ★ 提示语按「有/无旧版本」分别措辞（v1.42.0）：旧版本场景只说「回车升级 / 手动输入新路径」，
#   不再把「否则回车使用 /opt/...」这种**当前场景根本不适用**的分支塞进同一行；
#   同时去掉原先重复的 log 行（[INFO] 与提示行说同一件事，噪音大）。
if [ -n "$OLD_INSTALL_DIR" ]; then
  PROMPT_DEFAULT="$OLD_INSTALL_DIR"
  PROMPT_TEXT="检测到本机已安装在 ${OLD_INSTALL_DIR}（回车升级）或者手动输入新路径"
else
  PROMPT_DEFAULT="$DEFAULT_INSTALL_DIR"
  PROMPT_TEXT="请输入安装目录（回车使用默认 ${DEFAULT_INSTALL_DIR}）"
fi

if [ -n "${APP_INSTALL_DIR:-}" ]; then
  INSTALL_DIR="$APP_INSTALL_DIR"
  log "使用 APP_INSTALL_DIR 指定的安装目录: ${INSTALL_DIR}"
elif [ -t 0 ]; then
  while true; do
    read -r -p "${PROMPT_TEXT}: " ans || ans=""
    INSTALL_DIR="${ans:-$PROMPT_DEFAULT}"
    if reason="$(validate_install_dir "$INSTALL_DIR")"; then
      unset reason
      break
    fi
    warn "无效的安装目录：${reason}"
    warn "  示例：/data/${APP_NAME}（回车即默认 ${PROMPT_DEFAULT}）"
  done
else
  INSTALL_DIR="$PROMPT_DEFAULT"
  log "非交互环境：使用默认安装目录 ${INSTALL_DIR}（可用 APP_INSTALL_DIR 覆盖）"
fi

# 定稿后再算子目录（原先在头部写死，改为依赖最终 INSTALL_DIR）
DATA_DIR="${INSTALL_DIR}/data"
LOG_DIR="${INSTALL_DIR}/logs"
CONFIG_DIR="${INSTALL_DIR}/config"

log "安装目录: ${INSTALL_DIR}"
log "数据目录: ${DATA_DIR}"
log "日志目录: ${LOG_DIR}"
log "配置目录: ${CONFIG_DIR}"

# 检测系统
title "检测系统环境"
if [ -f /etc/os-release ]; then
  . /etc/os-release
  case "$ID" in rhel|rocky|almalinux|ol) ID="centos" ;; esac
  log "操作系统: ${ID} ${VERSION_ID:-}"
else
  warn "无法识别操作系统，继续安装"
fi

# 检查 Docker / Docker Compose（缺失即提示并停止安装）
# 提示：本段刻意放在「创建服务用户」之前 —— 先有 docker 组，
# 后续 usermod -aG docker 与单元里的 SupplementaryGroups=docker 才能一次到位。
title "检查 Docker 依赖"
# 检测口径与后端 docker.ts 保持一致：
#   compose 需真正能执行 `version`（只判 command -v 会把装坏的残留二进制误判为可用）
compose_ok() {
  if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then return 0; fi
  if command -v docker-compose &>/dev/null && docker-compose version &>/dev/null 2>&1; then return 0; fi
  return 1
}
detect_docker_deps() {
  DOCKER_BIN_OK=0; DOCKER_DAEMON_OK=0; COMPOSE_OK=0
  if command -v docker &>/dev/null; then
    DOCKER_BIN_OK=1
    if docker info &>/dev/null 2>&1; then DOCKER_DAEMON_OK=1; fi
  fi
  if compose_ok; then COMPOSE_OK=1; fi
}
detect_docker_deps

# 缺失时的提示：给出各发行版官方安装命令，不代用户执行
docker_prereq_hint() {
  cat <<'EOF'

请先安装 Docker 与 Docker Compose（本安装包不负责安装 Docker）：

  Debian / Ubuntu:
    curl -fsSL https://get.docker.com | sh
    # 国内网络可加镜像：
    curl -fsSL https://get.docker.com | sh -s -- --mirror Aliyun

  RHEL / CentOS / Rocky / AlmaLinux:
    dnf -y install dnf-plugins-core
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin

  装完后启用服务并确认可用：
    systemctl enable --now docker
    docker --version && docker compose version

  然后重新执行本脚本：
    sudo bash install.sh

  若只想先装应用本体（容器管理不可用），可加 --ignore-docker 跳过本检查。
EOF
}

# Docker 依赖缺失即停止安装：本脚本不代装 Docker，避免改动用户机器的包管理器状态
if [ "$DOCKER_BIN_OK" -eq 0 ] || [ "$COMPOSE_OK" -eq 0 ]; then
  MISSING=""
  if [ "$DOCKER_BIN_OK" -eq 0 ]; then MISSING="Docker"; fi
  if [ "$COMPOSE_OK" -eq 0 ]; then MISSING="${MISSING:+${MISSING} 与 }Docker Compose"; fi

  if [ "$IGNORE_DOCKER" -eq 1 ]; then
    warn "未检测到 ${MISSING} —— 已按 --ignore-docker 跳过检查（容器管理功能不可用）"
  else
    warn "未检测到 ${MISSING}"
    docker_prereq_hint
    err "请先安装 Docker 与 Docker Compose，安装完成后再重新执行本脚本"
  fi
fi

if [ "$DOCKER_BIN_OK" -eq 1 ]; then
  log "Docker: $(docker --version 2>/dev/null)"
  if [ "$DOCKER_DAEMON_OK" -eq 0 ]; then
    warn "docker 守护进程未运行 —— 这会导致服务启动失败（226/NAMESPACE），务必先启动它"
    warn "  原因：守护进程未运行时 /var/run/docker.sock 不存在，systemd 准备 ReadWritePaths 时直接放弃"
    warn "  ⚠️ 本脚本不代为启动 docker（不改用户的系统服务状态），请自行执行："
    warn "      systemctl start docker && systemctl enable docker"
    warn "  然后重新执行本脚本（会一并把服务运行账户加入 docker 组）"
  fi
else
  warn "未安装 Docker（按 --ignore-docker 跳过检查），应用可启动但容器管理功能不可用"
fi
if [ "$COMPOSE_OK" -eq 0 ]; then
  warn "未检测到 Compose（docker compose / docker-compose），Compose 相关功能不可用"
fi

# 配置磁盘温度传感器（drivetemp）
# ============================================
# 应用读磁盘温度走 sysfs hwmon，**不需要 root、也不需要 smartmontools**；但 SATA/HDD 的
# hwmon 节点只在 drivetemp 模块加载后才由内核暴露（NVMe 由 nvme 驱动自带，不受影响）。
# 没加载时「硬件信息 → 温度」那几块 SATA 盘只能显示「—」，用户无从判断是硬件没有传感器
# 还是模块没加载 —— 所以安装时顺手加载 + 持久化。
#
# 等价于用户手动执行：
#   echo drivetemp | sudo tee /etc/modules-load.d/drivetemp.conf && sudo modprobe drivetemp
#
# ★ 本段**尽力而为、绝不阻塞安装**：内核没编该模块 / 已内置进内核 / 无 modprobe / 无 systemd
#   一律只告警不退出（set -e 下每个可能失败的调用都显式判返回值）。
title "配置磁盘温度传感器（drivetemp）"
DRIVETEMP_CONF="/etc/modules-load.d/drivetemp.conf"
DRIVETEMP_MARK="# ${APP_NAME}: 让 SATA/HDD 暴露 hwmon 温度节点（应用读 sysfs 展示磁盘温度）"
if [ "$SKIP_DRIVETEMP" -eq 1 ]; then
  warn "已按 --no-drivetemp 跳过 drivetemp 配置；SATA/HDD 温度可能显示「—」"
else
  # 模块不可用有两种情况，都跳过（都不影响其它功能）：
  #   ① 内核没编 drivetemp（老内核 / 精简内核 / 部分 NAS 系统）
  #   ② 已编进内核（builtin）—— 此时 hwmon 本来就存在，无需加载
  # modinfo 本身可能缺失（精简系统没装 kmod），缺了就绕过检查、直接尝试 modprobe。
  DRIVETEMP_AVAILABLE=1
  if command -v modinfo &>/dev/null && ! modinfo drivetemp &>/dev/null; then
    DRIVETEMP_AVAILABLE=0
  fi
  if [ "$DRIVETEMP_AVAILABLE" -eq 0 ]; then
    warn "本机内核未提供 drivetemp 模块（或已内置），跳过；SATA/HDD 温度可能显示「—」"
  else
    if ! command -v modprobe &>/dev/null; then
      warn "未找到 modprobe，跳过加载；SATA/HDD 温度可能显示「—」"
    elif modprobe drivetemp 2>/dev/null; then
      log "已加载 drivetemp 模块（SATA/HDD 温度立即可读，无需重启）"
    else
      warn "modprobe drivetemp 失败；SATA/HDD 温度可能显示「—」，可手动执行: modprobe drivetemp"
    fi
    # 持久化：重启后自动加载。modules-load.d 是 systemd 的机制，非 systemd 系统不写多余文件。
    if [ -d /etc/modules-load.d ] || command -v systemctl &>/dev/null; then
      mkdir -p /etc/modules-load.d
      printf '%s\ndrivetemp\n' "$DRIVETEMP_MARK" > "$DRIVETEMP_CONF"
      log "已写入 ${DRIVETEMP_CONF}（重启后自动加载）"
    else
      warn "本机无 systemd（${DRIVETEMP_CONF} 不生效），未持久化；重启后需手动: modprobe drivetemp"
    fi
  fi
fi

# 停止旧服务
if systemctl is-active --quiet "${APP_NAME}" 2>/dev/null; then
  log "停止旧服务..."
  systemctl stop "${APP_NAME}"
fi

# 配置服务运行账户（v1.40.1）：跟随已有系统用户，不再单独建账户。
# 安装时**列出候选用户供编号选择**（也可直接输入用户名），必须匹配已存在的
# 系统用户才放行；明确拒绝 root。
title "配置服务运行账户"

# 列出候选系统用户：UID 1000-65533 的普通账户。
# ★ v1.42.2：**只列真实登录用户**（shell 非 nologin/false），系统服务账户
#   （libvirt-qemu / wsdd2 等 Dynamic User 账户）一律隐藏、不参与编号 ——
#   它们本就不该作为服务运行账户，列出来只会诱导误选。
#   仍需用这类账户时可直接输入用户名（下方"序号或用户名"两条路都保留）。
CANDIDATE_USERS=""
if command -v getent >/dev/null 2>&1; then
  CANDIDATE_USERS="$(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 && $7 != "" && $7 !~ /(nologin|false)$/ { print $1 }' 2>/dev/null || true)"
elif [ -r /etc/passwd ]; then
  CANDIDATE_USERS="$(awk -F: '$3 >= 1000 && $3 < 65534 && $7 != "" && $7 !~ /(nologin|false)$/ { print $1 }' /etc/passwd 2>/dev/null || true)"
fi
# 参与「序号 → 用户名」映射的就是候选列表本身（服务账户已隐藏，不进映射）
CANDIDATE_ALL="$CANDIDATE_USERS"

# 取 GECOS 描述：只取**第一个逗号前的全名**。
# ★ GECOS 格式为 fullname,room,workphone,homephone,other，空字段会留成
#   "Libvirt Qemu,,," 这种尾随逗号串，直接打印就是脏输出。
user_desc() {
  local u="$1" gecos=""
  if command -v getent >/dev/null 2>&1; then
    gecos="$(getent passwd "$u" 2>/dev/null | awk -F: '{ print $5 }')"
  else
    gecos="$(awk -F: -v u="$u" '$1 == u { print $5; exit }' /etc/passwd 2>/dev/null || true)"
  fi
  gecos="${gecos%%,*}"      # 截掉逗号后的空字段
  gecos="${gecos#"${gecos%%[![:space:]]*}"}"  # 去前导空白
  gecos="${gecos%"${gecos##*[![:space:]]}"}"  # 去尾随空白
  printf '%s' "$gecos"
}

# 非交互（自动化 / CI）环境可用 APP_RUN_AS_USER 指定；否则交互提示输入。
if [ -z "${APP_RUN_AS_USER:-}" ]; then
  if [ -t 0 ]; then
    if [ -n "$CANDIDATE_ALL" ]; then
      log "可用系统用户（输入序号或直接输入用户名）:"
      i=1
      while IFS= read -r cand; do
        [ -n "$cand" ] || continue
        cdesc="$(user_desc "$cand")"
        log "  ${i}) ${cand}$( [ -n "$cdesc" ] && printf '（%s）' "$cdesc" )"
        i=$((i + 1))
      done <<< "$CANDIDATE_USERS"
      read -r -p "请输入服务运行账户（序号或用户名，须为已存在的非 root 系统用户）: " pick
      # 纯数字 → 按序号取对应用户名；否则视为直接输入的用户名
      if printf '%s' "$pick" | grep -qE '^[0-9]+$'; then
        sel="$(printf '%s\n' "$CANDIDATE_ALL" | sed -n "${pick}p")"
        APP_RUN_AS_USER="${sel:-}"
        [ -n "$APP_RUN_AS_USER" ] || err "序号 ${pick} 超出候选范围（共 $(printf '%s\n' "$CANDIDATE_ALL" | grep -c .) 个用户）"
      else
        APP_RUN_AS_USER="$pick"
      fi
    else
      # ★ v1.43.22：无候选用户时不再要求「已存在的用户」，改为输入用户名后**自动创建**。
      #   校验规则：小写字母/下划线开头，仅含小写字母/数字/下划线/连字符，≤32 字符（与 Debian
      #   默认 NAME_REGEX 对齐，避免 useradd 因大写/特殊字符被拒）；拒绝 root 与已存在用户复用。
      log "未检测到可用的登录系统用户（UID 1000-65533 且非 nologin），将自动创建服务账户"
      USERADD_BIN="$(command -v useradd || true)"
      while true; do
        read -r -p "请输入要创建的用户名: " NEW_USER
        NEW_USER="$(printf '%s' "$NEW_USER" | tr -d '[:space:]')"
        if [ -z "$NEW_USER" ]; then
          warn "用户名不能为空"
          continue
        fi
        if [ "$NEW_USER" = "root" ]; then
          warn "服务账户不能是 root（丧失全部权限隔离，且与镜像功能拒绝 root 的设计冲突）"
          continue
        fi
        if ! printf '%s' "$NEW_USER" | grep -qE '^[a-z_][a-z0-9_-]{0,31}$'; then
          warn "用户名不合法（小写字母/下划线开头，仅含小写字母/数字/下划线/连字符，≤32 字符）"
          continue
        fi
        if getent passwd "$NEW_USER" >/dev/null 2>&1; then
          log "用户 '${NEW_USER}' 已存在，直接使用"
          APP_RUN_AS_USER="$NEW_USER"
          break
        fi
        if [ -z "$USERADD_BIN" ]; then
          warn "系统缺少 useradd，无法自动创建用户（精简系统请先安装依赖包：apt-get update && apt-get install -y passwd）"
          continue
        fi
        if "$USERADD_BIN" --create-home --shell /bin/bash "$NEW_USER" >/dev/null 2>&1; then
          log "已创建系统用户 '${NEW_USER}'（主组同名，shell /bin/bash，家目录 /home/${NEW_USER}）"
          APP_RUN_AS_USER="$NEW_USER"
          break
        fi
        warn "创建用户 '${NEW_USER}' 失败，请换一个用户名重试"
      done
    fi
  else
    err "非交互环境：请用 APP_RUN_AS_USER=<系统用户> 指定服务运行账户（须已存在且非 root）"
  fi
fi
# 校验：必须是已存在的非 root 系统用户，否则循环提示（非交互则直接报错退出）
while true; do
  if ! getent passwd "$APP_RUN_AS_USER" >/dev/null 2>&1; then
    warn "系统用户 '${APP_RUN_AS_USER}' 不存在"
  elif [ "$APP_RUN_AS_USER" = "root" ]; then
    warn "服务账户不能是 root（丧失全部权限隔离，且与镜像功能拒绝 root 的设计冲突）"
  else
    break
  fi
  if [ -t 0 ]; then
    read -r -p "请重新输入（须为已存在的非 root 系统用户）: " APP_RUN_AS_USER
  else
    err "APP_RUN_AS_USER 必须是已存在的非 root 系统用户"
  fi
done
SERVICE_USER="$APP_RUN_AS_USER"
SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || true)"
# ★ 组名兜底：某些系统用户没有与用户名同名的组（如 Debian 的 yanzi 主组是 Users），
#   若 SERVICE_GROUP 为空则回退用用户名；真正的 chown 一律走下面的解析逻辑。
if [ -z "$SERVICE_GROUP" ]; then
  SERVICE_GROUP="$SERVICE_USER"
fi
log "服务将运行为系统用户: ${SERVICE_USER}（主组 ${SERVICE_GROUP}）"
if getent group docker &>/dev/null && ! groups "$SERVICE_USER" 2>/dev/null | grep -q docker; then
  USERMOD="$(require_cmd usermod)"
  "$USERMOD" -aG docker "$SERVICE_USER"
  log "已加入 docker 组"
  # 刷新 systemd 用户缓存，确保服务启动时 SupplementaryGroups 能读取到最新组成员
  systemctl daemon-reexec 2>/dev/null || true
fi

# 授权：设置页「镜像加速源」需要读写 /etc/docker/daemon.json 并重启 docker。
# 服务以非 root 运行，最小命令集通过 sudoers 放开；service 中已关闭 NoNewPrivileges，
# 否则 sudo(setuid) 会被 no_new_privs 拦截。
title "配置 sudoers 授权"
SUDOERS_FILE="/etc/sudoers.d/${APP_NAME}"

if command -v sudo &>/dev/null; then
  cat > "$SUDOERS_FILE" <<EOF
# ${APP_NAME}: 读写 /etc/docker/daemon.json 与重启 docker 的最小命令集
${SERVICE_USER} ALL=(root) NOPASSWD: \\
  /usr/bin/cat /etc/docker/daemon.json, \\
  /usr/bin/tee /etc/docker/daemon.json, \\
  /usr/bin/mkdir -p /etc/docker, \\
  /usr/bin/systemctl restart docker, \\
  /usr/sbin/service docker restart
EOF
  chmod 440 "$SUDOERS_FILE"
  # 语法错误会让整台机器的 sudo 失效，必须先校验、失败即回滚。
  # visudo 缺失时不能当成「校验失败」—— 否则会把自己刚写好的授权片段误删。
  if ! VISUDO="$(cmd_path visudo)"; then
    warn "未找到 visudo，跳过语法校验，已写入 ${SUDOERS_FILE}（请自行核对，语法有误会导致 sudo 失效）"
  elif ! "$VISUDO" -c -f "$SUDOERS_FILE" &>/dev/null; then
    rm -f "$SUDOERS_FILE"
    warn "sudoers 片段校验失败已回滚；设置页将无法写入 daemon.json（可手动授权后点「重新检测权限」）"
  else
    log "已写入 ${SUDOERS_FILE}"
  fi
else
  warn "未检测到 sudo，跳过授权；设置页的镜像加速源将只能读取"
fi

# 历史残留清理（v1.41.0）：v1.40.x 曾随本脚本安装「异盘镜像」提权执行器与两份配置，
# 该功能已于 v1.41.0 整体移除 ⇒ 顺手清掉残留（幂等、best-effort，失败不中断安装）。
# 注：上面的 sudoers 文件是**整份重写**的 ⇒ 旧的镜像授权条目自然消失，无需单独处理。
LEGACY_MIRROR_EXEC="/usr/local/libexec/dms-mirror-exec.sh"
if [ -f "$LEGACY_MIRROR_EXEC" ]; then
  rm -f "$LEGACY_MIRROR_EXEC" && log "已清理历史残留：${LEGACY_MIRROR_EXEC}"
fi
for LEGACY_CONF in mirror-source.conf mirror-identity.conf; do
  if [ -f "${CONFIG_DIR}/${LEGACY_CONF}" ]; then
    rm -f "${CONFIG_DIR}/${LEGACY_CONF}" && log "已清理历史残留：${CONFIG_DIR}/${LEGACY_CONF}"
  fi
done

# ===========================================================================
# 旧安装目录数据迁移（v1.41.1；v1.41.4 复用顶部检测到的 OLD_INSTALL_DIR）
#
# 当用户选择**不同于旧版本**的安装目录时：提示是否迁移数据（data/logs/config）。
# 旧目录来源＝顶部「检测旧版本安装」段得到的 OLD_INSTALL_DIR（systemd 单元
# WorkingDirectory），此处不再重复探测。迁移完成后询问是否保留旧目录；选择不保留
# 需输入 DELETE 二次确认 —— 绝不静默删数据。非交互环境一律跳过迁移（不猜用户意图）。
# ===========================================================================
if [ -n "$OLD_INSTALL_DIR" ] && [ "$OLD_INSTALL_DIR" != "$INSTALL_DIR" ]; then
  echo ""
  warn "检测到本机已安装在 ${OLD_INSTALL_DIR}，与本次选择的 ${INSTALL_DIR} 不同"
  if [ -t 0 ]; then
    read -r -p "是否把旧目录的数据（data/ logs/ config/）迁移到 ${INSTALL_DIR}？[Y/n] " mv_ans || mv_ans=""
    if [ -z "$mv_ans" ] || printf '%s' "$mv_ans" | grep -qE '^[Yy]'; then
      mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$LOG_DIR" "$CONFIG_DIR"
      for sub in data logs config; do
        if [ -d "${OLD_INSTALL_DIR}/${sub}" ]; then
          # -n：不覆盖新目录里已存在的同名文件（以新目录为准，避免覆盖刚部署的内容）
          if cp -a -n "${OLD_INSTALL_DIR}/${sub}/." "${INSTALL_DIR}/${sub}/" 2>/dev/null; then
            log "已迁移 ${sub}/（未覆盖新目录已有文件）"
          elif cp -a "${OLD_INSTALL_DIR}/${sub}/." "${INSTALL_DIR}/${sub}/" 2>/dev/null; then
            log "已迁移 ${sub}/"
          else
            warn "迁移 ${sub}/ 失败，请手动执行："
            warn "  cp -a ${OLD_INSTALL_DIR}/${sub}/. ${INSTALL_DIR}/${sub}/"
          fi
        fi
      done
      # 迁移完成后再问是否保留旧目录（破坏性动作，需二次确认）
      read -r -p "是否保留旧安装目录 ${OLD_INSTALL_DIR}？[Y/n] " keep_ans || keep_ans=""
      if [ -n "$keep_ans" ] && printf '%s' "$keep_ans" | grep -qE '^[Nn]'; then
        warn "即将删除 ${OLD_INSTALL_DIR}（含其中的旧二进制与数据）"
        read -r -p "  确认删除请输入 DELETE（其它任何输入 = 保留）: " del_ans || del_ans=""
        if [ "$del_ans" = "DELETE" ] && [ -n "$OLD_INSTALL_DIR" ] && [ "$OLD_INSTALL_DIR" != "/" ]; then
          if rm -rf "$OLD_INSTALL_DIR"; then
            log "已删除旧安装目录 ${OLD_INSTALL_DIR}"
          else
            warn "删除失败，请手动执行： rm -rf ${OLD_INSTALL_DIR}"
          fi
        else
          log "未确认删除：保留旧安装目录 ${OLD_INSTALL_DIR}"
        fi
      else
        log "已保留旧安装目录 ${OLD_INSTALL_DIR}（如需清理： rm -rf ${OLD_INSTALL_DIR}）"
      fi
    else
      log "未迁移；旧目录 ${OLD_INSTALL_DIR} 原样保留"
      warn "systemd 单元将指向本次选择的 ${INSTALL_DIR}，旧目录不再被服务使用"
    fi
  else
    warn "非交互环境：跳过旧目录迁移（旧目录 ${OLD_INSTALL_DIR} 原样保留）"
  fi
fi

# 备份旧版本
if [ -f "${INSTALL_DIR}/${APP_NAME}" ]; then
  BACKUP="${INSTALL_DIR}.bak.$(date +%Y%m%d_%H%M%S)"
  log "备份旧版本到 ${BACKUP}"
  cp -a "$INSTALL_DIR" "$BACKUP" 2>/dev/null || true
fi

# 部署文件
title "部署文件"
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$LOG_DIR" "$CONFIG_DIR"

TARGET="${INSTALL_DIR}/${APP_NAME}"
if [ -f "$TARGET" ] && [ "$BINARY" -ef "$TARGET" ]; then
  # 已在安装目录内运行（如把包直接解压到 /opt/dockermanagementyanzi），跳过自拷贝
  log "二进制已在安装目录，跳过复制"
else
  cp -f "$BINARY" "$TARGET"
fi
chmod 755 "$TARGET"

# 迁移旧数据文件（若解压目录/旧目录有则复制，后端启动时也会自动迁移）
for f in engines.json active_engine.json; do
  if [ -f "${SCRIPT_DIR}/${f}" ] && [ ! -f "${DATA_DIR}/${f}" ]; then
    cp "${SCRIPT_DIR}/${f}" "${DATA_DIR}/"
    log "迁移数据: ${f}"
  fi
done
if [ -f "${SCRIPT_DIR}/settings.json" ] && [ ! -f "${CONFIG_DIR}/settings.json" ]; then
  cp "${SCRIPT_DIR}/settings.json" "${CONFIG_DIR}/"
  log "迁移配置: settings.json"
fi

# docker CLI 配置目录（与 service 中 DOCKER_CONFIG 对应）
# 隔离 ~/.docker，避免 ProtectHome 屏蔽 /home 导致 config.json 权限报错干扰 compose 检测
mkdir -p "${CONFIG_DIR}/docker-cli"

# ★ 递归归属：组用**实际主组**（${SERVICE_GROUP}），不能用用户名 ——
#   很多系统没有与用户名同名的组（如 Debian 的 yanzi 主组是 Users），
#   写 "user:user" 会报 `chown: invalid group` 并因 set -e 让整个安装中断在部署阶段。
#   归属组只影响组权限位，主组同时出现在 /etc/group 的 GECOS 里，故以「按名解析
#   实际 gid 的方式」兜底，解析不到就退回用户名（极端情况下 fail-soft，不中断安装）。
CHOWN_GID="$(id -g "$SERVICE_USER" 2>/dev/null || true)"
if [ -n "$CHOWN_GID" ] && getent group "$CHOWN_GID" >/dev/null 2>&1; then
  chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "$INSTALL_DIR"
else
  warn "无法解析 ${SERVICE_USER} 的主组，改用数字 gid 归属"
  chown -R "${SERVICE_USER}:${CHOWN_GID:-0}" "$INSTALL_DIR" || \
    warn "chown 归属设置失败，继续安装（不影响服务启动后自行读取）"
fi

# 安装 systemd 服务
# ★ 单元由本脚本写入 /etc/systemd/system/，而**在线升级（OTA）只替换二进制、从不碰它**。
#   因此「依赖新单元指令」的功能（如 DMI 序列号镜像）在旧部署上会静默失效。
#   本步骤**每次运行都无条件从模板重新生成并解析占位符** ⇒ 重跑本脚本即「自动修复」该单元：
#   既修复 OTA 后残留的落后指令，也救回被误写成占位符（如 User=__SERVICE_USER__）的单元。
title "安装 systemd 服务（自动刷新 / 修复单元）"
cp "${SCRIPT_DIR}/${APP_NAME}.service" /etc/systemd/system/
UNIT_FILE="/etc/systemd/system/${APP_NAME}.service"
# 把单元里的账户占位符替换为实际服务用户（跟随系统用户，安装期确定；sed 幂等）
sed -i "s|^User=__SERVICE_USER__$|User=${SERVICE_USER}|; s|^Group=__SERVICE_GROUP__$|Group=${SERVICE_GROUP}|" "$UNIT_FILE"

# ★ 安装目录占位符替换（v1.41.1，支持自定义目录）：WorkingDirectory / DOCKER_CONFIG /
#   ExecStart / ReadWritePaths 四处共用 __INSTALL_DIR__，必须**全部**替换成同一路径，
#   否则 systemd 会在 226/NAMESPACE 或 203/USER 上失败。
#   安装目录已过白名单校验（无 | & 空格引号等）⇒ 替换本身安全；这里仍对 & 与 | 转义，
#   属双保险（万一将来放宽校验，也不会把 sed 语义破坏）。
INSTALL_DIR_SED="$(printf '%s' "$INSTALL_DIR" | sed 's/[&|\\]/\\&/g')"
sed -i "s|__INSTALL_DIR__|${INSTALL_DIR_SED}|g" "$UNIT_FILE"
log "单元安装目录已设为 ${INSTALL_DIR}（OTA 后重跑本脚本即自动同步最新单元）"
# 兜底自检：占位符必须清零（漏替换 = 服务绝对起不来，宁可就地失败也不要静默装坏）
if grep -q '__INSTALL_DIR__' "$UNIT_FILE"; then
  err "单元文件仍有未替换的 __INSTALL_DIR__ 占位符：${UNIT_FILE}
      请把该文件发回反馈（这是打包/安装脚本的缺陷）。"
fi
if [ "$(grep -c "^WorkingDirectory=${INSTALL_DIR_SED}\$" "$UNIT_FILE")" -eq 0 ]; then
  err "单元 WorkingDirectory 未指向 ${INSTALL_DIR}，安装中止（避免装出无法启动的服务）。"
fi

# SupplementaryGroups=docker 要求 docker 组真实存在，否则 systemd 启动即 216/GROUP
# （Failed to determine supplementary groups: No such process）。
# systemd 不支持「可选补充组」，所以在安装时按实际探测结果裁剪该行。
if getent group docker &>/dev/null; then
  log "docker 组存在，保留 SupplementaryGroups=docker"
else
  sed -i '/^SupplementaryGroups=docker$/d' "$UNIT_FILE"
  warn "系统无 docker 组，已从单元移除 SupplementaryGroups=docker（服务启动会成功，但无法访问 /var/run/docker.sock）"
  warn "如需容器管理：装好 Docker 后执行 —— groupadd docker && usermod -aG docker ${SERVICE_USER} && systemctl daemon-reexec && systemctl restart ${APP_NAME}"
fi

systemctl daemon-reload
systemctl enable "${APP_NAME}"

# 再次刷新 systemd 用户缓存，确保 SupplementaryGroups=docker 生效
systemctl daemon-reexec 2>/dev/null || true

# 检查 docker socket 访问（仅作提示，不阻塞安装）
# 注意：socket **不存在**时也要提示 —— 单元里的 ReadWritePaths 已带 "-" 前缀（不存在即忽略），
# 服务能起来、但引擎会显示离线。用户最容易在这里困惑「装了 Docker 却说连不上」，须点明。
if [ -S /var/run/docker.sock ]; then
  # ★ 用户不存在是「手工解压部署」（没跑 install.sh）最典型的后续症状：
  #   systemd 会因 User= 指向不存在的用户而报 203/USER，而单元文件本身看不出问题。
  if ! id -u "$SERVICE_USER" &>/dev/null; then
    warn "服务用户 ${SERVICE_USER} 不存在 —— 手工解压部署会导致 203/USER 启动失败"
    warn "请重新执行: sudo bash install.sh   —— 会创建用户、加入 docker 组并安装单元"
  fi
  if RUNUSER="$(cmd_path runuser)" && [ -n "$RUNUSER" ]; then
    if ! "$RUNUSER" -u "$SERVICE_USER" -- test -r /var/run/docker.sock 2>/dev/null; then
      warn "用户 ${SERVICE_USER} 暂时无法访问 /var/run/docker.sock"
      warn "如启动后仍报 EACCES，请执行: systemctl daemon-reexec && systemctl restart ${APP_NAME}"
    fi
  fi
else
  warn "未检测到 /var/run/docker.sock —— Docker 未安装或未运行"
  warn "面板可正常打开，但容器/镜像/堆栈页会显示引擎离线。装好 Docker 后执行:"
  warn "  systemctl start docker && systemctl restart ${APP_NAME}"
fi

# 启动
title "启动服务"
# 注意：set -e 下 `systemctl start` 一旦失败脚本会立即退出，用户只会看到 systemd 的两行报错、
# 拿不到任何后续指引。故此处显式判返回值，并把 status / journal 一并打出来。
if ! systemctl start "${APP_NAME}" 2>&1; then
  warn "systemctl start 失败，以下为诊断信息："
  systemctl --no-pager -l status "${APP_NAME}" 2>&1 | sed -n '1,20p' | sed 's/^/      /' || true
  echo ""
  warn "最近 30 行日志（journalctl -u ${APP_NAME} -n 30）："
  journalctl -u "${APP_NAME}" --no-pager -n 30 2>&1 | sed 's/^/      /' || true

  # ★ 226/NAMESPACE 专项诊断：ReadWritePaths= 里的某个路径不存在时，systemd 在挂载
  #   namespace 阶段就退出（"Failed to set up mount namespacing"），**早于 ExecStartPre**，
  #   所以日志里没有任何程序输出，极易被误判成程序故障。这里直接点名是哪几条路径不存在。
  NS_PATHS="$(systemctl show "${APP_NAME}" -p ReadWritePaths --value 2>/dev/null || true)"
  MISSING=""
  for p in $NS_PATHS; do
    # 去掉 systemd 的 "-" 可选前缀再判断存在性
    p_clean="${p#-}"
    [ -e "$p_clean" ] || MISSING="${MISSING}\n      ${p_clean}"
  done
  if [ -n "$MISSING" ]; then
    echo ""
    warn "检测到 ReadWritePaths 中的路径不存在 —— 这会导致 226/NAMESPACE 启动失败："
    printf "      %b\n" "$MISSING"
    warn "若为 docker.sock：先 systemctl start docker（守护进程未运行时 socket 不存在）"
    warn "若手工改过单元，确保每条路径都有 '-' 前缀（不存在即忽略）："
    warn "  grep ReadWritePaths /etc/systemd/system/${APP_NAME}.service"
    warn "修复后执行: systemctl daemon-reload && systemctl restart ${APP_NAME}"
  fi
fi
sleep 2

if systemctl is-active --quiet "${APP_NAME}"; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo ""
  log "============================================"
  log "  安装成功！"
  log "  安装目录: ${INSTALL_DIR}"
  log "  访问: http://${IP:-localhost}:5024"
  log ""
  log "  管理命令:"
  log "    systemctl start|stop|restart ${APP_NAME}"
  log "    systemctl status ${APP_NAME}"
  log "    journalctl -u ${APP_NAME} -f"
  log ""
  log "  更新:"
  log "    1) 重新构建: bash build.sh"
  log "    2) 安装覆盖: sudo bash install.sh"
  log ""
  log "  卸载: sudo bash uninstall.sh"
  # v1.42.3：移除「升级时请沿用本次安装目录」提示。
  #   自 v1.41.4 起脚本会读已安装单元的 WorkingDirectory= **自动探测旧安装目录**，
  #   升级时交互提示直接回车即沿用（见上方「选择安装目录」段），无需用户记路径或设
  #   APP_INSTALL_DIR ⇒ 这行提示是冗余的，且会让人误以为升级必须手动干预。
  log "============================================"
  # Docker 依赖不完整时的后续动作：装好后**必须重跑本脚本**，
  # 否则用户不会被加入 docker 组、单元里的 SupplementaryGroups=docker 也不会补回。
  if [ "$DOCKER_BIN_OK" -eq 0 ] || [ "$COMPOSE_OK" -eq 0 ]; then
    echo ""
    warn "Docker 依赖不完整（docker=$([ "$DOCKER_BIN_OK" -eq 1 ] && echo 已装 || echo 缺失)，compose=$([ "$COMPOSE_OK" -eq 1 ] && echo 已装 || echo 缺失)）"
    warn "装好 Docker 后请重跑: sudo bash install.sh   —— 会自动补上 docker 组成员与单元配置"
  fi
else
  warn "服务未启动，查看日志: journalctl -u ${APP_NAME} -n 50"
fi
