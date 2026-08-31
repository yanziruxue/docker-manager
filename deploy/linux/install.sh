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

# 检查 Docker
title "检查 Docker"
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  log "Docker $(docker --version)"
else
  warn "Docker 未运行，请确保已安装并启动 Docker"
fi

# 停止旧服务
if systemctl is-active --quiet "${APP_NAME}" 2>/dev/null; then
  log "停止旧服务..."
  systemctl stop "${APP_NAME}"
fi

# 创建用户
title "创建服务用户"
if ! id -u "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /sbin/nologin -d "$INSTALL_DIR" "$SERVICE_USER"
  log "创建用户 ${SERVICE_USER}"
else
  log "用户 ${SERVICE_USER} 已存在"
fi
if getent group docker &>/dev/null && ! groups "$SERVICE_USER" 2>/dev/null | grep -q docker; then
  usermod -aG docker "$SERVICE_USER"
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
  # 语法错误会让整台机器的 sudo 失效，必须先校验、失败即回滚
  if ! visudo -c -f "$SUDOERS_FILE" &>/dev/null; then
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
systemctl daemon-reload
systemctl enable "${APP_NAME}"

# 再次刷新 systemd 用户缓存，确保 SupplementaryGroups=docker 生效
systemctl daemon-reexec 2>/dev/null || true

# 检查 docker socket 访问（仅作提示，不阻塞安装）
if command -v runuser &>/dev/null && [ -S /var/run/docker.sock ]; then
  if ! runuser -u "$SERVICE_USER" -- test -r /var/run/docker.sock 2>/dev/null; then
    warn "用户 ${SERVICE_USER} 暂时无法访问 /var/run/docker.sock"
    warn "如启动后仍报 EACCES，请执行: systemctl daemon-reexec && systemctl restart ${APP_NAME}"
  fi
fi

# 启动
title "启动服务"
systemctl start "${APP_NAME}"
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
else
  warn "服务未启动，查看日志: journalctl -u ${APP_NAME} -n 50"
fi
