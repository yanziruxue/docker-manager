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
# 取值与 docker-manager-yanzi.service 内的 Environment="PATH=..." 保持一致。
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

APP_NAME="docker-manager-yanzi"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/opt/${APP_NAME}"
# 数据 / 日志 / 配置统一放在安装目录下的子目录（与 systemd service 的 ReadWritePaths 对应）
DATA_DIR="${INSTALL_DIR}/data"
LOG_DIR="${INSTALL_DIR}/logs"
CONFIG_DIR="${INSTALL_DIR}/config"
SERVICE_USER="${APP_NAME}"

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
  -h, --help                  显示本帮助

前提: 本脚本不再自动安装 Docker。请先装好 Docker 与 Docker Compose 再执行；
      检测到缺失时会提示并停止安装（不修改系统）。
EOF
}

# 是否跳过 Docker 依赖检查（默认不跳过：缺失即停止安装）
IGNORE_DOCKER=0
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --ignore-docker|--no-docker|--skip-docker) IGNORE_DOCKER=1 ;;
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

# 检测系统
title "检测系统环境"
if [ -f /etc/os-release ]; then
  . /etc/os-release
  case "$ID" in rhel|rocky|almalinux|ol) ID="centos" ;; esac
  log "操作系统: ${ID} ${VERSION_ID:-}"
else
  warn "无法识别操作系统，继续安装"
fi
log "安装目录: ${INSTALL_DIR}"
log "数据目录: ${DATA_DIR}"
log "日志目录: ${LOG_DIR}"
log "配置目录: ${CONFIG_DIR}"

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
    warn "docker 守护进程未运行，容器管理会显示「未连接」：systemctl start docker"
  fi
else
  warn "未安装 Docker（按 --ignore-docker 跳过检查），应用可启动但容器管理功能不可用"
fi
if [ "$COMPOSE_OK" -eq 0 ]; then
  warn "未检测到 Compose（docker compose / docker-compose），Compose 相关功能不可用"
fi

# 停止旧服务
if systemctl is-active --quiet "${APP_NAME}" 2>/dev/null; then
  log "停止旧服务..."
  systemctl stop "${APP_NAME}"
fi

# 创建用户
title "创建服务用户"
if ! id -u "$SERVICE_USER" &>/dev/null; then
  # 显式创建同名组：useradd 是否自动建组取决于 /etc/login.defs 的 USERGROUPS_ENAB，
  # 精简镜像 / 容器里常常不会建 —— 而 .service 写了 Group=docker-manager-yanzi，
  # 缺组会让 systemd 直接 216/GROUP（Failed to determine supplementary groups）启动失败。
  if ! getent group "$SERVICE_USER" &>/dev/null; then
    GROUPADD="$(require_cmd groupadd)"
    "$GROUPADD" -r "$SERVICE_USER"
    log "创建用户组 ${SERVICE_USER}"
  fi
  USERADD="$(require_cmd useradd)"
  "$USERADD" -r -g "$SERVICE_USER" -s /sbin/nologin -d "$INSTALL_DIR" "$SERVICE_USER"
  log "创建用户 ${SERVICE_USER}"
else
  log "用户 ${SERVICE_USER} 已存在"
fi
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
title "配置 daemon.json 写入授权"
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
  # 已在安装目录内运行（如把包直接解压到 /opt/docker-manager-yanzi），跳过自拷贝
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

chown -R "${SERVICE_USER}:${SERVICE_USER}" "$INSTALL_DIR"

# 安装 systemd 服务
title "安装 systemd 服务"
cp "${SCRIPT_DIR}/${APP_NAME}.service" /etc/systemd/system/
UNIT_FILE="/etc/systemd/system/${APP_NAME}.service"

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
if RUNUSER="$(cmd_path runuser)" && [ -S /var/run/docker.sock ]; then
  if ! "$RUNUSER" -u "$SERVICE_USER" -- test -r /var/run/docker.sock 2>/dev/null; then
    warn "用户 ${SERVICE_USER} 暂时无法访问 /var/run/docker.sock"
    warn "如启动后仍报 EACCES，请执行: systemctl daemon-reexec && systemctl restart ${APP_NAME}"
  fi
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
fi
sleep 2

if systemctl is-active --quiet "${APP_NAME}"; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo ""
  log "============================================"
  log "  安装成功！"
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
