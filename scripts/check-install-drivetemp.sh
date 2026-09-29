#!/usr/bin/env bash
# ============================================================
# 安装脚本门禁：drivetemp 内核模块配置块
#
# 覆盖对象：deploy/linux/install.sh 的「配置磁盘温度传感器（drivetemp）」段
#           + deploy/linux/uninstall.sh 的对应清理段 + 参数解析接线
#
# 为什么需要它：
#   ① 应用读磁盘温度走 sysfs hwmon，**不需要 root**，但 SATA/HDD 的 hwmon 节点只在
#      drivetemp 模块加载后才存在 —— 这段逻辑决定「装完能不能看到盘温」；
#   ② install.sh 要 root + systemd 才能真跑，开发机（Windows/Git Bash）**无法执行**，
#      改坏了只会在用户机器上才暴露；
#   ③ 最关键的不变量是「**绝不阻塞安装**」：内核没编该模块 / 已内置 / 无 modprobe /
#      无 systemd，四种情况都必须告警后继续装，绝不能因温度功能让整个安装失败。
#      这条只有在 set -euo pipefail 下逐分支跑才验得出来。
#
# 做法：从两个脚本里**抽出真实代码块**（不是复制一份，避免与实现漂移），
#       把 /etc/modules-load.d 改写到工作区内的沙箱，再用桩命令
#       （modinfo / modprobe / systemctl）驱动 7 种环境。
#
# 新增用例时的两个坑（都实测踩过）：
#   ★ PATH 里的桩目录必须用 `cygpath -u` 转成 POSIX 形式（/d/...）：写成 D:/... 时
#     MSYS 不做路径查找，桩命令全部「不可见」，会误判成「本机没有 modprobe/modinfo」。
#   ★ 只「前置追加」桩目录，**绝不整段替换 PATH**：替换会把工具链自己的 shim 目录挤掉，
#     命令拦截随即挂死（实测 timeout 124 无输出）。
#
# 负向自检（新增/修改用例后必做）：把 install.sh 里「模块不可用」分支的 warn 改成 err
#   ⇒ 用例③ 应立刻失败、脚本 exit 1；还原后回到全绿。
#
# 运行：bash scripts/check-install-drivetemp.sh   （已接入 npm run test:install / test:gates）
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/deploy/linux/install.sh"
U_SRC="$ROOT/deploy/linux/uninstall.sh"
SANDBOX="$ROOT/.tmp-install-check/sandbox"
STUB="$SANDBOX/bin"
rm -rf "$ROOT/.tmp-install-check"
mkdir -p "$STUB" "$SANDBOX/calls"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $*"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $*"; }
eq()  { if [ "$2" = "$3" ]; then ok "$1 = $3"; else bad "$1 期望 [$3] 实际 [$2]"; fi; }
has() { if grep -qF -- "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1（未在 $3 中找到「$2」）"; fi; }

for f in "$SRC" "$U_SRC"; do
  [ -f "$f" ] || { echo "❌ 缺少 $f"; exit 1; }
done

echo "── ① 静态接线：参数与清理口径"
has "① install.sh 默认不跳过（SKIP_DRIVETEMP=0）" 'SKIP_DRIVETEMP=0' "$SRC"
has "① 支持 --no-drivetemp 开关" '--no-drivetemp|--skip-drivetemp) SKIP_DRIVETEMP=1 ;;' "$SRC"
has "① 帮助里列出 --no-drivetemp" '--no-drivetemp              跳过 drivetemp 内核模块配置' "$SRC"
has "① uninstall 只删带归属标记的 conf" 'grep -q "^# ${APP_NAME}:" "$DRIVETEMP_CONF"' "$U_SRC"

# ---- 抽取真实代码块 ----
A=$(grep -n '^# 配置磁盘温度传感器（drivetemp）$' "$SRC" | cut -d: -f1)
B=$(grep -n '^# 停止旧服务$' "$SRC" | cut -d: -f1)
if [ -z "$A" ] || [ -z "$B" ] || [ "$B" -le "$A" ]; then
  echo "❌ install.sh 锚点定位失败（A=$A B=$B）—— 函数/注释被改名？门禁拒绝静默通过"; exit 1
fi
BLOCK="$SANDBOX/block.sh"
sed -n "${A},$((B-1))p" "$SRC" | sed "s#/etc/modules-load.d#${SANDBOX}/etc/modules-load.d#g" > "$BLOCK"
for sym in SKIP_DRIVETEMP DRIVETEMP_CONF modinfo modprobe drivetemp; do
  has "① 抽出块含 ${sym}" "$sym" "$BLOCK"
done
echo "   抽取 install.sh ${A}..$((B-1)) 共 $((B-A)) 行"

UA=$(grep -n '^# 删除安装脚本写入的 drivetemp 模块配置$' "$U_SRC" | cut -d: -f1)
UB=$(grep -n '^# 删除 sudoers 授权片段' "$U_SRC" | cut -d: -f1)
if [ -z "$UA" ] || [ -z "$UB" ] || [ "$UB" -le "$UA" ]; then
  echo "❌ uninstall.sh 锚点定位失败（UA=$UA UB=$UB）"; exit 1
fi
U_BLOCK="$SANDBOX/uninstall-block.sh"
sed -n "${UA},$((UB-1))p" "$U_SRC" | sed "s#/etc/modules-load.d#${SANDBOX}/etc/modules-load.d#g" > "$U_BLOCK"
echo ""

# ---- 桩命令 ----
write_stub() {
  local name="$1" mode="$2"   # mode: ok | fail
  local rc=0; [ "$mode" = fail ] && rc=1
  cat > "$STUB/$name" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${SANDBOX}/calls/${name}.calls"
exit ${rc}
EOF
  chmod +x "$STUB/$name"
}
reset_stubs() {
  rm -rf "$STUB" "$SANDBOX/etc" "$SANDBOX/calls"
  mkdir -p "$STUB" "$SANDBOX/calls"
}

# 跑一个用例：名称 skip modinfo模式 modprobe模式 是否有systemctl [是否省略modprobe]
run_case() {
  local name="$1" skip="$2" minfo="$3" mprobe="$4" with_sys="$5" omit="${6:-no}"
  reset_stubs
  write_stub modinfo "$minfo"
  [ "$omit" = no ] && write_stub modprobe "$mprobe"
  [ "$with_sys" = yes ] && write_stub systemctl ok
  local OUT="$SANDBOX/out.txt"
  (
    set -euo pipefail
    APP_NAME="docker-manager-yanzi"
    SKIP_DRIVETEMP="$skip"
    log()   { echo "LOG:  $*"; }
    warn()  { echo "WARN: $*"; }
    title() { echo "TITLE: $*"; }
    # 只前置追加桩目录，且转 POSIX 形式（见文件头两条坑）
    export PATH="$(cygpath -u "$STUB"):$PATH"
    # shellcheck disable=SC1090
    source "$BLOCK"
  ) > "$OUT" 2>&1
  RC=$?
  N_PROBE=$( [ -f "$SANDBOX/calls/modprobe.calls" ] && wc -l < "$SANDBOX/calls/modprobe.calls" || echo 0 )
  N_INFO=$( [ -f "$SANDBOX/calls/modinfo.calls" ] && wc -l < "$SANDBOX/calls/modinfo.calls" || echo 0 )
  CONF="$SANDBOX/etc/modules-load.d/drivetemp.conf"
  if [ -f "$CONF" ]; then CONF_STATE="存在"; else CONF_STATE="无"; fi
  echo "── 用例：$name"
  echo "   exit=$RC  conf=$CONF_STATE  modprobe=$N_PROBE  modinfo=$N_INFO"
  sed 's/^/     | /' "$OUT"
}

echo "── ② 分支行为（核心：每一种都必须 exit 0，不得中断安装）"

run_case "① 默认：模块可用" 0 ok ok yes
eq "① exit" 0 "$RC"
eq "① 写入 conf" "$CONF_STATE" "存在"
eq "① modprobe 调用次数" "$N_PROBE" "1"
if grep -q '^drivetemp$' "$CONF" 2>/dev/null; then ok "① conf 含 drivetemp 行"; else bad "① conf 缺 drivetemp 行"; fi
if grep -q "^# docker-manager-yanzi:" "$CONF" 2>/dev/null; then ok "① conf 带归属标记（供卸载识别）"; else bad "① conf 缺归属标记"; fi
if grep -q "已加载 drivetemp 模块" "$SANDBOX/out.txt"; then ok "① 打印「已加载」"; else bad "① 未打印「已加载」"; fi

run_case "② --no-drivetemp 跳过" 1 ok ok yes
eq "② exit" 0 "$RC"
eq "② 未写 conf" "$CONF_STATE" "无"
eq "② 未调用 modprobe" "$N_PROBE" "0"
eq "② 未调用 modinfo（跳过时不探测）" "$N_INFO" "0"

run_case "③ 模块不可用（modinfo 失败）" 0 fail ok yes
eq "③ exit（必须 0，不可中断安装）" 0 "$RC"
eq "③ 未写 conf" "$CONF_STATE" "无"
eq "③ 未调用 modprobe" "$N_PROBE" "0"

run_case "④ modprobe 失败" 0 ok fail yes
eq "④ exit（必须 0）" 0 "$RC"
eq "④ 仍写 conf（重启后还有机会）" "$CONF_STATE" "存在"
eq "④ modprobe 被调用" "$N_PROBE" "1"

run_case "⑤ 非 systemd（无 systemctl、无 modules-load.d）" 0 ok ok no
eq "⑤ exit（必须 0）" 0 "$RC"
eq "⑤ 未写 conf（不写多余文件）" "$CONF_STATE" "无"
eq "⑤ modprobe 仍被调用" "$N_PROBE" "1"

run_case "⑥ 无 modprobe（极简系统）" 0 ok ok yes omit
eq "⑥ exit（必须 0）" 0 "$RC"
eq "⑥ 仍写 conf（载不了也要能重启后生效）" "$CONF_STATE" "存在"
eq "⑥ 未调用 modprobe" "$N_PROBE" "0"
if grep -q "未找到 modprobe" "$SANDBOX/out.txt"; then ok "⑥ 打印「未找到 modprobe」"; else bad "⑥ 未给出提示"; fi

echo ""
echo "── ③ 卸载侧归属识别（不能误删用户自建的 conf）"
UCONF="$SANDBOX/etc/modules-load.d/drivetemp.conf"
rm -rf "$SANDBOX/etc"; mkdir -p "$SANDBOX/etc/modules-load.d"

printf '# docker-manager-yanzi: marker\ndrivetemp\n' > "$UCONF"
( set -euo pipefail; APP_NAME="docker-manager-yanzi"
  log(){ echo "LOG:  $*"; }; warn(){ echo "WARN: $*"; }
  source "$U_BLOCK" ) > "$SANDBOX/un1.txt" 2>&1
if [ -f "$UCONF" ]; then bad "⑦-1 未删除带标记的 conf"; else ok "⑦-1 已删除带标记的 conf"; fi

printf 'drivetemp\n' > "$UCONF"
( set -euo pipefail; APP_NAME="docker-manager-yanzi"
  log(){ echo "LOG:  $*"; }; warn(){ echo "WARN: $*"; }
  source "$U_BLOCK" ) > "$SANDBOX/un2.txt" 2>&1
if [ -f "$UCONF" ]; then ok "⑦-2 保留了用户自建的 conf（无标记）"; else bad "⑦-2 误删了用户自建的 conf"; fi

echo ""
echo "结果: PASS=$PASS FAIL=$FAIL"
rm -rf "$ROOT/.tmp-install-check"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
