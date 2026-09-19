#!/usr/bin/env bash
# ============================================
# Docker Stack Manager — 一键安装脚本
#
# 在服务器上执行下面任一命令即可自动下载并安装（无需手动下载 zip）：
#   curl -fsSL https://github.com/yanziruxue/docker-manager/releases/latest/download/quick-install.sh | sudo bash
#   sudo bash quick-install.sh                 # 本地已下载本脚本时
#   VERSION=1.18.2 sudo bash quick-install.sh  # 安装指定版本
#
# 环境变量：
#   VERSION        目标版本，默认 latest（最新 Release）
#   UPDATE_MIRROR  自定义下载镜像前缀，例如 https://my-mirror.com/
#                 （用于直连 GitHub 被墙时的回退，脚本已内置 gh-proxy.com 回退）
#
# 说明：Release 资产名带版本号（docker-manager-yanzi-linux-x64-vX.Y.Z.zip），
#       本脚本通过 GitHub API 解析最新资产真实下载地址，不再依赖固定的非版本化文件名。
# 说明：下载交付包时显示实时进度（已下载 MB / 总 MB · 百分比 · 均速）。
#       终端（TTY）下单行原地刷新；输出重定向到文件/日志时改为每 10% 输出一行，避免刷屏。
# ============================================
set -euo pipefail

REPO="yanziruxue/docker-manager"
APP_NAME="docker-manager-yanzi"
VERSION="${VERSION:-latest}"
UPDATE_MIRROR="${UPDATE_MIRROR:-}"

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

# 取 HTTP(S) 文本内容（直连 → 自定义镜像 → gh-proxy 回退）
# 用于拉取 GitHub API 的 JSON。
http_get() {
  local url="$1"
  local -a src=("$url")
  [ -n "$UPDATE_MIRROR" ] && src+=("${UPDATE_MIRROR%/}/${url}")
  src+=("https://gh-proxy.com/${url}")
  for u in "${src[@]}"; do
    local out
    if command -v curl >/dev/null 2>&1; then
      out="$(curl -fsSL --connect-timeout 15 --max-time 60 "$u" 2>/dev/null)"
    else
      out="$(wget -qO- --timeout=60 "$u" 2>/dev/null)"
    fi
    if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
  done
  return 1
}

# 解析资产下载地址：通过 GitHub API 查找匹配 linux-x64 的 zip 资产
resolve_asset() {
  local api
  if [ "$VERSION" = "latest" ]; then
    api="https://api.github.com/repos/${REPO}/releases/latest"
  else
    api="https://api.github.com/repos/${REPO}/releases/tags/v${VERSION}"
  fi
  local json
  json="$(http_get "$api")" || return 1
  # 提取 browser_download_url 中匹配 linux-x64 的 zip 资产（首个命中）
  printf '%s' "$json" \
    | grep -oE '"browser_download_url"\s*:\s*"https://[^"]*linux-x64[^"]*\.zip"' \
    | head -1 \
    | sed -E 's/.*"browser_download_url"\s*:\s*"//; s/"[[:space:]]*$//'
}

ASSET_URL="$(resolve_asset || true)"
if [ -z "$ASSET_URL" ]; then
  err "无法解析下载地址（GitHub API 可能被墙或速率受限）。请手动下载后解压运行 install.sh：
  https://github.com/${REPO}/releases/${VERSION}  （找 docker-manager-yanzi-linux-x64-v*.zip）
  或指定自定义镜像：UPDATE_MIRROR=https://你的镜像前缀/ sudo bash quick-install.sh"
fi
log "下载地址: ${ASSET_URL}"

# 总大小仅用于算百分比；拿不到也不影响下载，进度退化为只显示已下载量
ASSET_SIZE="$(remote_size "$ASSET_URL" || echo 0)"
if [ "${ASSET_SIZE:-0}" -gt 0 ]; then
  log "包大小: $(fmt_mb "$ASSET_SIZE") MB"
else
  ASSET_SIZE=0
  warn "未能获取包大小（HEAD 请求失败或不支持），进度将只显示已下载量"
fi

# ============================================================================
# 下载进度基础设施（区块标记供测试脚本抽取，勿改标记名）
# >>> download-helpers
# ============================================================================

# 本地文件字节数（不存在或读取失败返回 0）
size_of() {
  [ -f "$1" ] || { echo 0; return 0; }
  wc -c < "$1" 2>/dev/null | tr -d '[:space:]' || echo 0
}

# 字节 → MB（保留 1 位小数）
fmt_mb() { awk -v b="${1:-0}" 'BEGIN{printf "%.1f", b/1048576}'; }

# 远端文件总字节数（仅 HTTP 2xx 时采用 content-length；拿不到返回 0）
# 关键：必须吞掉下载器的失败码——本脚本跑在 set -euo pipefail 下，
#       命令替换里的管道一旦失败会直接终止整个脚本（连降级告警都打不出来）。
remote_size() {
  local url="$1" raw="" code="" n=""
  if command -v curl >/dev/null 2>&1; then
    raw="$(curl -fsIL --connect-timeout 15 --max-time 30 -w '\n__HTTP__%{http_code}' "$url" 2>/dev/null || true)"
  else
    raw="$(wget --server-response --spider --timeout=30 "$url" 2>&1 || true)"
  fi
  # 仅在 2xx 时采信 content-length：404 等错误页也有 body 长度，会把进度算错
  code="$(printf '%s\n' "$raw" | sed -n 's/.*__HTTP__\([0-9][0-9][0-9]\).*/\1/p' | tail -1)"
  case "$code" in
    '') printf '%s\n' "$raw" | grep -qE 'HTTP/[0-9.]+ 2[0-9][0-9]' || { echo 0; return 0; } ;;
    2*) : ;;
    *) echo 0; return 0 ;;
  esac
  n="$(printf '%s\n' "$raw" | awk 'BEGIN{IGNORECASE=1} /^content-length:/{gsub(/[^0-9]/,"",$2); v=$2} END{print v+0}')"
  case "$n" in ''|*[!0-9]*) echo 0 ;; *) echo "$n" ;; esac
}

# 进度文本：有总量时「已下载 X MB / Y MB · P%」，否则只显示已下载量
progress_text() {
  local cur="$1" total="${2:-0}"
  case "$total" in ''|*[!0-9]*) total=0 ;; esac
  if [ "$total" -gt 0 ]; then
    local pct=$(( cur * 100 / total ))
    [ "$pct" -gt 100 ] && pct=100
    printf '已下载 %s MB / %s MB · %s%%' "$(fmt_mb "$cur")" "$(fmt_mb "$total")" "$pct"
  else
    printf '已下载 %s MB' "$(fmt_mb "$cur")"
  fi
}

# <<< download-helpers

# 单次下载（后台下载 + 前台秒级轮询，自绘 MB 进度）。
# 下载器退出码经全局 DL_RC 传出，避免 set -e 吞码。
DL_RC=0
do_download() {
  local url="$1" out="$2"
  local total="${ASSET_SIZE:-0}"
  local rcfile="$TMPD/.dlrc.$$"
  local pid tty=0 start elapsed rc cur last_pct=0
  case "$total" in ''|*[!0-9]*) total=0 ;; esac
  rm -f "$out" "$rcfile"
  [ -t 2 ] && tty=1

  # 下载器放进子 shell，用「退出码文件」判断真的结束：
  # 不用 kill -0 判活（子进程退出后成僵尸仍返回 0），
  # 也避免 set -e 让失败的子 shell 提前退出而不写码。
  (
    set +e
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL --connect-timeout 15 --max-time 300 --retry 2 --retry-delay 2 "$url" -o "$out"
    else
      wget -qO "$out" --timeout=300 "$url"
    fi
    echo $? > "$rcfile"
  ) &
  pid=$!

  start="$(date +%s)"
  while [ ! -f "$rcfile" ]; do
    cur="$(size_of "$out")"
    if [ "$tty" -eq 1 ]; then
      printf '\r\033[K  %s' "$(progress_text "$cur" "$total")" >&2
    else
      local pct=0
      [ "$total" -gt 0 ] && pct=$(( cur * 100 / total ))
      if [ "$pct" -ge $(( last_pct + 10 )) ]; then
        last_pct="$pct"
        log "  $(progress_text "$cur" "$total")"
      fi
    fi
    sleep 1
  done

  wait "$pid" 2>/dev/null || true
  rc="$(cat "$rcfile" 2>/dev/null || echo 1)"
  rm -f "$rcfile"
  if [ "$tty" -eq 1 ]; then printf '\r\033[K' >&2; fi

  cur="$(size_of "$out")"
  elapsed=$(( $(date +%s) - start ))
  [ "$elapsed" -lt 1 ] && elapsed=1
  DL_RC="$rc"
  if [ "$rc" -eq 0 ] && [ "$cur" -gt 0 ]; then
    log "  ✅ 下载完成：$(fmt_mb "$cur") MB，用时 ${elapsed}s，均速 $(fmt_mb $(( cur / elapsed ))) MB/s"
    return 0
  fi
  return 1
}

# 下载（直连 → 自定义镜像 → gh-proxy 回退）
download_with_fallback() {
  local url="$1" out="$2"
  local -a tries=("$url")
  [ -n "${UPDATE_MIRROR:-}" ] && tries+=("${UPDATE_MIRROR%/}/${url}")
  tries+=("https://gh-proxy.com/${url}")
  for u in "${tries[@]}"; do
    log "尝试下载: $u"
    if do_download "$u" "$out" && [ -s "$out" ]; then
      return 0
    fi
    warn "下载失败（下载器退出码 ${DL_RC}），尝试下一个镜像..."
  done
  return 1
}

log "目标版本: ${VERSION}"
ZIP="$TMPD/docker-manager-yanzi-linux-x64.zip"
download_with_fallback "$ASSET_URL" "$ZIP" || err "下载失败，请检查网络，或手动下载后运行 install.sh：
  ${ASSET_URL}"

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
