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

# 固定 PATH：精简 Debian 容器 / 最小镜像常缺 /usr/sbin，会导致 userdel / groupdel 找不到
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

APP_NAME="dockermanagementyanzi"
DEFAULT_INSTALL_DIR="/opt/${APP_NAME}"
# 安装目录可能被 install.sh 指定为自定义路径（v1.41.1）⇒ 实际目录从 systemd 单元读：
#   WorkingDirectory= 是安装时写入的事实值，最可靠（比另建一份记录文件不易失同步）。
# 可用 APP_INSTALL_DIR=<绝对路径> 覆盖（单元已删 / 手工部署场景）。
UNIT_FILE="/etc/systemd/system/${APP_NAME}.service"
INSTALL_DIR="${APP_INSTALL_DIR:-}"
if [ -z "$INSTALL_DIR" ] && [ -f "$UNIT_FILE" ]; then
  INSTALL_DIR="$(grep -E '^WorkingDirectory=' "$UNIT_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi
# 兜底：读不到（无单元 / 残留占位符 / 路径已不存在）就用默认值
case "$INSTALL_DIR" in
  ""|*__INSTALL_DIR__*) INSTALL_DIR="$DEFAULT_INSTALL_DIR" ;;
esac
# 数据/日志/配置都在安装目录下，--keep 时保留 data/ 子目录
DATA_DIR="${INSTALL_DIR}/data"
# SERVICE_USER 不再由本包定义（v1.40.1 起服务跟随系统用户，卸载时不删除该系统用户）

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()   { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# 命令解析：先查 PATH，再退回常见绝对路径（/usr/sbin 等）。找不到返回非 0。
cmd_path() {
  local name="$1" p
  command -v "$name" 2>/dev/null && return 0
  for p in /usr/sbin /sbin /usr/bin /bin /usr/local/sbin /usr/local/bin; do
    if [ -x "${p}/${name}" ]; then echo "${p}/${name}"; return 0; fi
  done
  return 1
}

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
if [ -f "$UNIT_FILE" ]; then
  rm -f "$UNIT_FILE"
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

# 删除安装脚本写入的 drivetemp 模块配置
# 只删「带我们标记」的那一份 —— 用户自己写的 /etc/modules-load.d/drivetemp.conf 不能顺手删掉。
# 已加载的模块**不主动卸载**：可能仍被其它工具/进程依赖，重启后不再自动加载即可。
DRIVETEMP_CONF="/etc/modules-load.d/drivetemp.conf"
if [ -f "$DRIVETEMP_CONF" ] && grep -q "^# ${APP_NAME}:" "$DRIVETEMP_CONF" 2>/dev/null; then
  rm -f "$DRIVETEMP_CONF"
  log "已删除 ${DRIVETEMP_CONF}（重启后不再自动加载 drivetemp）"
fi

# 删除 sudoers 授权片段（daemon.json 读写 / 重启 docker）
if [ -f "/etc/sudoers.d/${APP_NAME}" ]; then
  rm -f "/etc/sudoers.d/${APP_NAME}"
  log "已删除 /etc/sudoers.d/${APP_NAME}"
fi

# v1.40.1 起服务跟随系统用户运行，不再由本包创建专属账户，
# 故卸载时**不删除**该系统用户 / 组（避免误删用户原有的登录账户）。

echo ""
log "卸载完成"
