#!/usr/bin/env bash
# ============================================
# Docker Stack Manager — 一键安装脚本
#
# 在服务器上执行下面任一命令即可自动下载并安装（无需手动下载 zip）：
#   curl -fsSL https://github.com/yanziruxue/docker-manager/releases/latest/download/quick-install.sh | sudo bash
#   sudo bash quick-install.sh                 # 本地已下载本脚本时
#   VERSION=1.5.1 sudo bash quick-install.sh   # 安装指定版本
#
# 环境变量：
#   VERSION        目标版本，默认 latest（最新 Release）
#   UPDATE_MIRROR  自定义下载镜像前缀，例如 https://my-mirror.com
#                 （用于直连 GitHub 被墙时的回退，脚本已内置 gh-proxy.com 回退）
# ============================================
set -euo pipefail

REPO="yanziruxue/docker-manager"
APP_NAME="docker-manager-yanzi"
ASSET="docker-manager-yanzi-linux-x64.zip"
VERSION="${VERSION:-latest}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# 需要 root
[ "$(id -u)" -ne 0 ] && err "本脚本需要 root 权限，请使用：curl ... | sudo bash"

# 仅支持 Linux x86_64
[ "$(uname -s)" = "Linux" ] || err "仅支持 Linux（当前：$(uname -s)）"
[ "$(uname -m)" = "x86_64" ] || err "仅支持 x86_64 架构（当前：$(uname -m)）"

command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || err "需要 curl 或 wget"

# 临时目录（退出时清理）
TMPD="$(mktemp -d)"
cleanup() { rm -rf "$TMPD"; }
trap cleanup EXIT

# 解析下载地址
if [ "$VERSION" = "latest" ]; then
  BASE_URL="https://github.com/${REPO}/releases/latest/download"
else
  BASE_URL="https://github.com/${REPO}/releases/download/v${VERSION}"
fi
ZIP_URL="${BASE_URL}/${ASSET}"

# 单次下载
do_download() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --connect-timeout 15 --max-time 300 --retry 2 --retry-delay 2 "$url" -o "$out"
  else
    wget -qO "$out" "$url"
  fi
}

# 下载（直连 → 自定义镜像 → gh-proxy 回退）
download_with_fallback() {
  local url="$1" out="$2"
  local -a tries=("$url")
  [ -n "${UPDATE_MIRROR:-}" ] && tries+=("${UPDATE_MIRROR%/}/${url}")
  tries+=("https://gh-proxy.com/${url}")
  for u in "${tries[@]}"; do
    log "尝试下载: $u"
    if do_download "$u" "$out" 2>/dev/null && [ -s "$out" ]; then
      return 0
    fi
    warn "下载失败，尝试下一个镜像..."
  done
  return 1
}

log "目标版本: ${VERSION}"
ZIP="$TMPD/${ASSET}"
download_with_fallback "$ZIP_URL" "$ZIP" || err "下载失败，请检查网络，或手动下载后运行 install.sh：
  ${ZIP_URL}"

# 校验与解压
command -v unzip >/dev/null 2>&1 || err "需要 unzip（Debian/Ubuntu: apt install unzip；飞牛/OpenWrt: opkg install unzip）"
unzip -tq "$ZIP" >/dev/null 2>&1 || err "压缩包校验失败，可能下载不完整"
EXTRACT="$TMPD/extract"
mkdir -p "$EXTRACT"
unzip -oq "$ZIP" -d "$EXTRACT"
[ -f "$EXTRACT/install.sh" ] || err "压缩包内未找到 install.sh"

log "下载完成，开始安装..."
( cd "$EXTRACT" && bash install.sh )

log "✅ 一键安装完成。访问 http://<本机IP>:5024 查看面板。"
log "   后续更新可在面板内「系统设置 → 系统更新」一键 OTA 升级。"
