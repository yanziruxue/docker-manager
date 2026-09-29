#!/usr/bin/env bash
# ============================================================================
# push-gitea.sh —— 把本工作区源码推到自建 Gitea（yanzi/docker-manager-yanzi）
#
# ★ 为什么走 IP:8024：① https://git.ziruxue.top 的证书 SAN **不含该域名**
#   （openssl 后端报 "no alternative certificate subject name matches target hostname
#    'git.ziruxue.top'"，schannel 直接握手失败）；② ssh://git@60.205.251.18:8022 端口
#   Connection refused（未开放）。⇒ 两个「官方」入口都推不了，必须走 IP:8024 直连。
#   仓库地址 = http://60.205.251.18:8024/yanzi/docker-manager-yanzi.git
#
# ★ 认证：刻意不把令牌写进仓库或脚本（只走 wincred）。令牌 scope 必勾 repository 的「读写」
#   —— Gitea 1.27.3 把权限拆成细项（activitypub/admin/issue/misc/notification/organization/
#   package/repository/user），**没有旧版的 repo 复选框**。
#   本机 wincred 已缓存过一次凭据 ⇒ 通常免输入；要清除用 git credential reject。
#   令牌获取（本机浏览器打开）：
#     http://60.205.251.18:8024/user/settings/applications
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
if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  case "$REMOTE" in
    gitea) git remote add gitea http://60.205.251.18:8024/yanzi/docker-manager-yanzi.git ;;
    *)     die "远端 $REMOTE 不存在，且我不知道它的地址" ;;
  esac
  say "  已补建远端 $REMOTE → $(git remote get-url "$REMOTE")"
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
say "  Gitea 会问账号密码：用户名 = yanzi；密码 = 访问令牌（见脚本头部注释）。"
if [ "$DRY" = 1 ]; then
  say "  [DRY] 跳过推送"
  exit 0
fi

git push -u "$REMOTE" "$BRANCH"
rc=$?
if [ "$rc" -ne 0 ]; then
  say ""
  say "✗ 推送失败（退出码 $rc）。常见原因："
  say "  · 认证失败 → 密码要用 Gitea **访问令牌**，不是登录密码（该账号可能开了 2FA）"
  say "  · 令牌权限不足 → 重新生成时勾上 repo（读+写）"
  say "  · 远端非空且历史不同 → 先 git pull --rebase $REMOTE $BRANCH 再推"
  say "  · 误用域名远端 → 域名证书不含 git.ziruxue.top，改走 gitea（IP:8024）"
  exit "$rc"
fi

say ""
say "✓ 已推送 → $(git remote get-url "$REMOTE")  分支 $BRANCH"
say "  网页：http://60.205.251.18:8024/yanzi/docker-manager-yanzi"
