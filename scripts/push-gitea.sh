#!/usr/bin/env bash
# ============================================================================
# push-gitea.sh —— 把本工作区源码推到自建 Gitea（yanzi/docker-manager-yanzi）
#
# ★ 入口（2026-09-30 实测更正，旧结论「必须走 IP:8024」**已证伪**）：走**域名** 443
#   仓库地址 = https://git.ziruxue.top/yanzi/docker-manager-yanzi.git
#   · 旧的 http://60.205.251.18:8024 直连**已不可用**（本机 curl 报 000 / git 报
#     502 upstream connect timed out）；
#   · 而本机 git（openssl SSL 后端）与 Node fetch 走域名均正常 —— 证书 `CN=git.ziruxue.top`
#     （SAN 含该域 + www）、链完整、443 OPEN。
#   ⚠️ 本机有 HTTP 代理（http_proxy/https_proxy → 127.0.0.1），且 git 默认 schannel 后端对该站
#      握手失败 ⇒ 推送**必须**附加：-c http.sslBackend=openssl -c http.proxy= -c https.proxy=
#      （本脚本已内置；openssl 后端不可用时自动回退默认后端再试一次）
#
# ★ 认证：刻意不把令牌写进仓库或脚本（只走 wincred）。令牌 scope 必勾 repository 的「读写」
#   —— Gitea 1.27.3 把权限拆成细项（activitypub/admin/issue/misc/notification/organization/
#   package/repository/user），**没有旧版的 repo 复选框**。
#   凭据按 host 存放：域名 host（git.ziruxue.top）需单独 approve 一次，例如：
#     TOKEN=$(printf 'protocol=http\nhost=60.205.251.18:8024\n\n' | git credential fill | sed -n 's/^password=//p')
#     printf 'protocol=https\nhost=git.ziruxue.top\nusername=yanzi\npassword=%s\n\n' "$TOKEN" | git credential approve
#   要清除用 git credential reject。
#   令牌获取（本机浏览器打开）：
#     https://git.ziruxue.top/user/settings/applications
#     → 「管理访问令牌 / Manage Access Tokens」→ 生成新令牌（scope 见上）
#     → 复制（**只显示一次**，页面刷新就看不到了）
#   推送时填：用户名 = yanzi（Gitea 账号）；密码 = 粘贴刚生成的令牌（比登录密码稳）。
#   想免输入：Windows 凭据管理器会自动记住（credential.helper=wincred）。
#
# 用法：
#   bash scripts/push-gitea.sh                  # 无改动，直接推
#   bash scripts/push-gitea.sh -m "提交说明"     # 先提交全部改动再推
#   DRY=1 bash scripts/push-gitea.sh -m "..."    # 只提交，不推送
#
# 选项：
#   -m <msg>          提交说明；给了就先 git add -A && commit 再推
#   --remote <name>   指定远端名（默认 gitea）
#   --branch <name>   指定分支（默认当前分支）
# ============================================================================
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

REMOTE=gitea
MSG=""
BRANCH=""
DRY="${DRY:-0}"

say() { printf '%s\n' "$*"; }
die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    -m)            MSG="${2:-}"; shift 2 ;;
    --remote)      REMOTE="${2:-}"; shift 2 ;;
    --branch)      BRANCH="${2:-}"; shift 2 ;;
    # ★ 帮助：跳过**第一条**分隔线（文件头起始），打印到**第二条**为止。
    #   若按「遇到 === 就退出」写，会把开头那行当终止符 ⇒ --help 输出为空。
    -h|--help)     awk '/^# ={10,} *$/ {c++; if (c==2) exit; next} c==1 {sub(/^# ?/, ""); print}' "$0"; exit 0 ;;
    *)             die "未知参数：$1（用 --help 看用法）" ;;
  esac
done

[ -d "$ROOT/.git" ] || die "$ROOT 不是 git 仓库"

# 远端自检：没有就补上（幂等）
GITEA_URL="https://git.ziruxue.top/yanzi/docker-manager-yanzi.git"
if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  case "$REMOTE" in
    gitea) git remote add gitea "$GITEA_URL" ;;
    *)     die "远端 $REMOTE 不存在，且我不知道它的地址" ;;
  esac
  say "  已补建远端 $REMOTE → $(git remote get-url "$REMOTE")"
else
  # 地址自愈：旧的 IP:8024 直连已不可用，统一改成域名入口
  CUR="$(git remote get-url "$REMOTE")"
  if [ "$CUR" != "$GITEA_URL" ]; then
    git remote set-url "$REMOTE" "$GITEA_URL"
    say "  已更新远端 $REMOTE：$CUR → $GITEA_URL"
  fi
fi

[ -n "$BRANCH" ] || BRANCH="$(git branch --show-current)"
[ -n "$BRANCH" ] || die "取不到当前分支"

say "=== 远端 ==="
git remote -v
say ""
say "=== 工作区状态 ==="
git status --short | head -20
say ""

if [ -n "$(git status --porcelain)" ]; then
  [ -n "$MSG" ] || die "有未提交改动。要一并提交请用 -m \"<提交说明>\"，或自己先 git commit。"
  say "=== 提交 ==="
  git add -A || die "git add 失败"
  git commit -m "$MSG" || die "提交失败"
  say ""
fi

say "=== 推送 → $REMOTE/$BRANCH ==="
say "  Gitea 若问账号密码：用户名 = yanzi；密码 = 访问令牌（见脚本头部注释）。"
if [ "$DRY" = 1 ]; then
  say "  [DRY] 跳过推送"
  exit 0
fi

# 本机 git 默认 schannel 后端对 git.ziruxue.top 握手失败、且 HTTP 代理会拦该站
# ⇒ 强制 openssl 后端 + 清空代理；openssl 不可用时回退默认后端再试一次
git -c http.sslBackend=openssl -c http.proxy= -c https.proxy= push -u "$REMOTE" "$BRANCH"
rc=$?
if [ "$rc" -ne 0 ]; then
  say "  · openssl 后端推送失败，回退默认后端再试一次…"
  git push -u "$REMOTE" "$BRANCH"
  rc=$?
fi
if [ "$rc" -ne 0 ]; then
  say ""
  say "✗ 推送失败（退出码 $rc）。常见原因："
  say "  · 认证失败 → 密码要用 Gitea **访问令牌**，不是登录密码（该账号可能开了 2FA）"
  say "  · 令牌权限不足 → 重新生成时勾上 repository 的「读写」"
  say "  · 远端非空且历史不同 → 先 git pull --rebase $REMOTE $BRANCH 再推"
  say "  · 连不上 443 → 需能访问 https://git.ziruxue.top（IP:8024 直连已不可用，勿再改回去）"
  exit "$rc"
fi

say ""
say "✓ 已推送 → $(git remote get-url "$REMOTE")  分支 $BRANCH"
say "  网页：https://git.ziruxue.top/yanzi/docker-manager-yanzi"
