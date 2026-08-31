#!/usr/bin/env bash
# ============================================
# Docker Stack Manager — 卸载脚本
#
# 用法:
#   sudo bash uninstall.sh            # 完整卸载（会询问是否保留数据）
#   sudo bash uninstall.sh --keep     # 保留数据目录
#   sudo bash uninstall.sh --purge    # 删除一切（含数据）
# ============================================
set -euo pipefail

APP_NAME="docker-manager-yanzi"
INSTALL_DIR="/opt/${APP_NAME}"
# 数据/日志/配置都在安装目录下，--keep 时保留 data/ 子目录
DATA_DIR="${INSTALL_DIR}/data"
SERVICE_USER="${APP_NAME}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()   { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  err "请使用 root 权限: sudo bash uninstall.sh [--keep|--purge]"
fi

# 参数
KEEP_DATA=true
case "${1:-}" in
  --keep)  KEEP_DATA=true ;;
  --purge) KEEP_DATA=false ;;
  "")
    echo ""
    warn "⚠️  即将卸载 Docker Stack Manager"
    echo ""
    echo "  以下将被删除:"
    echo "    - 系统服务: ${APP_NAME}"
    echo "    - 程序文件: ${INSTALL_DIR}/"
    echo ""
    read -r -p "  是否保留数据目录 ${DATA_DIR}？[Y/n] " REPLY
    KEEP_DATA=true
    [[ "$REPLY" =~ ^[Nn] ]] && KEEP_DATA=false
    echo ""
    ;;
  *) err "未知参数: $1，支持: --keep / --purge" ;;
esac

# 停止服务
if systemctl is-active --quiet "${APP_NAME}" 2>/dev/null; then
  log "停止服务..."
  systemctl stop "${APP_NAME}"
fi

# 禁用服务
if systemctl is-enabled --quiet "${APP_NAME}" 2>/dev/null; then
  log "禁用服务..."
  systemctl disable "${APP_NAME}"
fi

# 删除 systemd 文件
if [ -f "/etc/systemd/system/${APP_NAME}.service" ]; then
  rm -f "/etc/systemd/system/${APP_NAME}.service"
  systemctl daemon-reload
  log "已删除 systemd 服务文件"
fi

# 删除程序（--keep 时保留 data/ 子目录）
if [ -d "$INSTALL_DIR" ]; then
  if [ "$KEEP_DATA" = true ] && [ -d "$DATA_DIR" ]; then
    TMP_KEEP="${INSTALL_DIR}.data.$$"
    mv "$DATA_DIR" "$TMP_KEEP"
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    mv "$TMP_KEEP" "$DATA_DIR"
    log "已删除 ${INSTALL_DIR}（保留数据目录）"
  else
    rm -rf "$INSTALL_DIR"
    log "已删除 ${INSTALL_DIR}"
  fi
fi

# 处理数据（--purge 时已随安装目录删除，此处兜底）
if [ "$KEEP_DATA" = false ] && [ -d "$DATA_DIR" ]; then
  rm -rf "$DATA_DIR"
  log "已删除 ${DATA_DIR}"
fi

# 删除 sudoers 授权片段（daemon.json 读写 / 重启 docker）
if [ -f "/etc/sudoers.d/${APP_NAME}" ]; then
  rm -f "/etc/sudoers.d/${APP_NAME}"
  log "已删除 /etc/sudoers.d/${APP_NAME}"
fi

# 删除用户
if id -u "$SERVICE_USER" &>/dev/null; then
  userdel "$SERVICE_USER" 2>/dev/null || true
  log "已删除用户 ${SERVICE_USER}"
fi

echo ""
log "卸载完成"
