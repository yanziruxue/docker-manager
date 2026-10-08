#!/usr/bin/env bash
# ============================================================================
# push-gitea.sh —— 把本工作区源码推到自建 Gitea（yanzi/docker-manager-yanzi）
#
# ★ 入口（可覆盖，默认＝内网地址）：
#   bash scripts/push-gitea.sh
#   GITEA_BASE=https://git.example.com bash scripts/push-gitea.sh   # 公网入口
#   仓库地址 = ${GITEA_BASE}/yanzi/docker-manager-yanzi.git
#
# ⚠️ 入口现状（2026-10-08 实测）：
#   · **默认入口＝内网 http://192.168.24.16:8024** —— API HTTP 200、仓库 public
#     （匿名可读，满足 OTA 与 quick-install.sh 的前置条件）。
#   · **旧域名 https://git.ziruxue.top 已完全不通** —— 本机 curl 返 000，
#     **Node fetch 也 fetch failed**（不再只是「curl 不通、Node 通」的老问题）。
#     域名恢复后可用 GITEA_BASE=https://git.ziruxue.top 覆盖回去。
#   · 更早的 http://60.205.251.18:8024 已超时废弃。
#   · 脚本按入口协议自动选推送参数：http 入口只清空代理（内网不该走代理），
#     https 入口强制 openssl SSL 后端 + 清空代理（避开本机 schannel 握手失败）。
#
# ★ 认证：刻意不把令牌写进仓库或脚本（只走 wincred / GITEA_TOKEN）。令牌 scope 必勾
#   repository 的「读写」—— Gitea 1.27.3 把权限拆成细项（activitypub/admin/issue/misc/
#   notification/organization/package/repository/user），**没有旧版的 repo 复选框**。
#   凭据按 host 存放：**换入口 = 换 host = 换一条凭据**，旧条目不会被复用。例如：
#     # 取令牌（浏览器打开 ${GITEA_BASE}/user/settings/applications 生成，只显示一次）
#     TOKEN=xxx
#     # 内网入口
#     printf 'protocol=http\nhost=192.168.24.16:8024\nusername=yanzi\npassword=%s\n\n' "$TOKEN" | git credential approve
#     # 旧域名入口（若将来恢复）
#     printf 'protocol=https\nhost=git.ziruxue.top\nusername=yanzi\npassword=%s\n\n' "$TOKEN" | git credential approve
#   要清除用 git credential reject。
#   推送时填：用户名 = yanzi（Gitea 账号）；密码 = 粘贴刚生成的令牌（比登录密码稳）。
#   想免输入：Windows 凭据管理器会自动记住（credential.helper=wincred）。
#
# 用法：
#   bash scripts/push-gitea.sh                  # 无改动，直接推
#   bash scripts/push-gitea.sh -m "提交说明"     # 先提交全部改动再推
#   DRY=1 bash scripts/push-gitea.sh -m "..."    # 只提交，不推送
#
# 环境变量：
#   GITEA_BASE   Gitea 站点根地址（默认 http://192.168.24.16:8024 内网）
#   GITEA_TOKEN  可选，走 URL 形式的凭据（不落 wincred）
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
# 入口可覆盖：GITEA_BASE=https://git.example.com bash scripts/push-gitea.sh
GITEA_BASE="${GITEA_BASE:-http://192.168.24.16:8024}"
GITEA_BASE="${GITEA_BASE%/}"
GITEA_URL="${GITEA_BASE}/yanzi/docker-manager-yanzi.git"
case "$GITEA_BASE" in
  https://*) GIT_PUSH_OPTS="" ;;
  # http 入口（含 IP:端口）：清空代理，避免本机 HTTP 代理拦内网地址
  *)        GIT_PUSH_OPTS="-c http.proxy= -c https.proxy=" ;;
esac
if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  case "$REMOTE" in
    gitea) git remote add gitea "$GITEA_URL" ;;
    *)     die "远端 $REMOTE 不存在，且我不知道它的地址" ;;
  esac
  say "  已补建远端 $REMOTE → $(git remote get-url "$REMOTE")"
else
  # 地址自愈：与当前 GITEA_BASE 不一致时统一改成当前入口
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

# 令牌注入：只在本次命令的 URL 里临时带上，**不写入 .git/config**（remote 仍是无凭证的干净 URL）
#   · 不设 GITEA_TOKEN 时行为不变（走 wincred / 交互输入）
#   · 设了 GITEA_TOKEN 时必须让 git 无条件采用它，否则仍会先问 wincred 而挂起
if [ -n "${GITEA_TOKEN:-}" ]; then
  PUSH_URL="$(printf '%s' "$GITEA_URL" | sed -E "s#^(https?://)#\1yanzi:${GITEA_TOKEN}@#")"
  say "  · 已注入 GITEA_TOKEN（仅本次命令有效，不写入 git config）"
fi

# 追踪配置：branch.main.remote 必须指向**远端名**（如 gitea），不能是带令牌的 URL。
#   推完后无条件校正一次 —— `push -u <url>` 会把 branch.main.remote 写成那个 URL（明文令牌进 .git/config），
#   而后续 fetch/pull 再走它就会静默用该令牌；这里覆盖回干净的远端名。
fix_tracking() {
  local cur
  cur="$(git config --get "branch.$BRANCH.remote" || true)"
  if [ -n "$cur" ] && [ "$cur" != "$REMOTE" ]; then
    git config "branch.$BRANCH.remote" "$REMOTE"
    say "  · 已把 branch.$BRANCH.remote 从 URL 形式校正为远端名 '$REMOTE'（避免明文令牌留在 .git/config）"
  fi
}

# https 入口（本机 git 默认 schannel 后端握手失败、且 HTTP 代理会拦该站）
#   ⇒ 强制 openssl 后端 + 清空代理；openssl 不可用时回退默认后端再试一次
# http 入口（IP:端口）⇒ 只需清空代理（内网地址不该走代理）
# 另：GIT_TERMINAL_PROMPT=0 保证「凭证助手挂起」时立刻报错而不是无限等待
if [ -n "${GITEA_TOKEN:-}" ]; then
  # 令牌模式：push 到 URL 而非远端名 ⇒ 天然不会污染 .git/config
  if [ -n "${GIT_PUSH_OPTS:-}" ]; then
    GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/echo git $GIT_PUSH_OPTS push "$PUSH_URL" "$BRANCH:$BRANCH"
  else
    GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/echo git -c http.sslBackend=openssl -c http.proxy= -c https.proxy= -c credential.helper= push "$PUSH_URL" "$BRANCH:$BRANCH"
  fi
  rc=$?
else
  if [ -n "${GIT_PUSH_OPTS:-}" ]; then
    GIT_TERMINAL_PROMPT=0 git $GIT_PUSH_OPTS push -u "$REMOTE" "$BRANCH"
  else
    GIT_TERMINAL_PROMPT=0 git -c http.sslBackend=openssl -c http.proxy= -c https.proxy= push -u "$REMOTE" "$BRANCH"
    rc=$?
    if [ "$rc" -ne 0 ]; then
      say "  · openssl 后端推送失败，回退默认后端再试一次…"
      GIT_TERMINAL_PROMPT=0 git push -u "$REMOTE" "$BRANCH"
      rc=$?
    fi
  fi
  [ -n "${rc:-0}" ] || rc=0
fi

fix_tracking
if [ "$rc" -ne 0 ]; then
  say ""
  say "✗ 推送失败（退出码 $rc）。常见原因："
  say "  · 认证失败 → 密码要用 Gitea **访问令牌**，不是登录密码（该账号可能开了 2FA）"
  say "  · 令牌权限不足 → 重新生成时勾上 repository 的「读写」"
  say "  · 远端非空且历史不同 → 先 git pull --rebase $REMOTE $BRANCH 再推"
  say "  · 连不上 → 确认能访问 ${GITEA_BASE}（换入口用 GITEA_BASE=... 覆盖；旧域名 git.ziruxue.top 已不通）"
  say "  · http 入口仍失败 → 检查本机 HTTP 代理是否拦截（脚本已清空 http.proxy/https.proxy）"
  exit "$rc"
fi

say ""
say "✓ 已推送 → $(git remote get-url "$REMOTE")  分支 $BRANCH"
say "  网页：${GITEA_BASE}/yanzi/docker-manager-yanzi"
