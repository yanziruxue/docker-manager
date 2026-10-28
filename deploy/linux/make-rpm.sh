#!/usr/bin/env bash
# 构建 RPM 包（.rpm）—— 复用与 deb 完全相同的交付内容
#
# 用法:
#   bash deploy/linux/make-rpm.sh
#
# 产物:
#   build-upload/dockermanagementyanzi-<version>-1.x86_64.rpm
#
# 设计要点（与 make-deb.py 对齐，保证两条分发路径行为一致）
# ============================================================================
# · 安装内容与 zip / deb 完全一致：二进制 + install.sh + uninstall.sh + .service
#   + README.md → /opt/dockermanagementyanzi/
# · systemd 单元由 %post 非交互调用 install.sh 生成（**不放进 payload**）：
#   install.sh 需替换 __INSTALL_DIR__ / __SERVICE_USER__ 占位符，rpm 无法做这种
#   替换；且 /etc 下的文件 rpm 会标记为 config，升级时弹 conffile 冲突、
#   unattended 安装直接失败。单元不进包同时也让「重跑 install.sh 即修复单元」成立。
# · %post 非交互：自动选取首个 UID>=1000 的登录用户作为服务运行账户；可用
#   /etc/default/dockermanagementyanzi 的 APP_RUN_AS_USER / APP_INSTALL_DIR 覆盖
#   （与 deb postinst 完全相同的环境变量约定）。
# · 目标机可能尚未装 Docker → 传 --ignore-docker（应用仍可启动，仅容器管理不可用）。
#
# ★★ 环境要求（与 deb 的关键差别）
#   本脚本**依赖 rpmbuild**（rpm-build 包）。Debian/Ubuntu 装不了它
#   （源里只有只读查询用的 rpm，不含构建能力），必须在 RPM 系环境执行：
#     Rocky/Alma/CentOS 8+、RHEL 8+、Fedora 30+
#   容器内亦可：docker run --rm -v "$PWD":/w -w /w rockylinux:9 bash -c
#     'yum install -y rpm-build && bash deploy/linux/make-rpm.sh'
#   ★ glibc 约束：内嵌二进制引用最高符号版本为 GLIBC_2.28（Node 22 基座要求），
#     故本包**仅支持 glibc >= 2.28 的发行版**（CentOS/RHEL 8+）；CentOS 7 会报
#     "version `GLIBC_2.28' not found"。
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT_DIR="$ROOT/build-upload"
TOPDIR="$(basename "$ROOT")"

APP="dockermanagementyanzi"
VERSION="$(node -e 'process.stdout.write(require("'"$ROOT"'/package.json").version)' 2>/dev/null \
  || sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
RELEASE="1"          # rpm 特有：同版本重打包时递增（Version-Release 逐段比较）
ARCH="x86_64"        # ★ rpm 用 x86_64，deb 用 amd64
SUMMARY="Docker Manager Yanzi — 多引擎 Docker 管理面板"
LICENSE="MIT"
MAINTAINER="yanzi <maintainer@dockermanagementyanzi.local>"

# ---- 前置检查 -------------------------------------------------------------
if ! command -v rpmbuild >/dev/null 2>&1; then
  cat >&2 <<EOF
ERROR: 未找到 rpmbuild，无法构建 RPM 包。

  本脚本依赖 rpm-build（Debian/Ubuntu 无法安装，请改在 RPM 系环境执行）：
    · Rocky / Alma / CentOS / RHEL 8+：  yum install -y rpm-build
    · Fedora 30+：                        dnf install -y rpm-build
    · 容器内（推荐，不污染开发机）：
        docker run --rm -v "\$PWD":/w -w /w rockylinux:9 bash -c \\
          'yum install -y rpm-build && bash deploy/linux/make-rpm.sh'

  若只想验证环境是否具备，可用更轻量的探测命令：
    docker run --rm rockylinux:9 bash -c "command -v rpmbuild && rpmbuild --version"
EOF
  exit 1
fi

echo "==> rpmbuild: $(command -v rpmbuild)  $(rpmbuild --version 2>&1 | head -1)"
echo "==> 版本: ${VERSION}-${RELEASE}  架构: ${ARCH}"

# ---- 校验源文件齐全 --------------------------------------------------------
MISSING=""
for f in "$APP" install.sh uninstall.sh "${APP}.service" README.md; do
  [ -f "$HERE/$f" ] || MISSING="$MISSING $f"
done
if [ -n "$MISSING" ]; then
  echo "ERROR: deploy/linux 下缺少源文件:$MISSING" >&2
  echo "       请先执行 npm run build:binary 生成 $APP" >&2
  exit 1
fi
# 二进制体积下限校验（与 OTA 的 MIN_BINARY_SIZE 同口径，防打进空壳）
BIN_SIZE=$(wc -c < "$HERE/$APP")
if [ "$BIN_SIZE" -lt 50000000 ]; then
  echo "ERROR: 二进制体积异常（${BIN_SIZE} 字节），疑似构建失败" >&2
  exit 1
fi

# ---- 生成 spec ------------------------------------------------------------
# 用 %install 从源码目录「就地安装」，因此 %setup 不需要（我们不做 tarball 分发，
# rpmbuild 允许 %setup 为空 + %install 里手工 cp）。
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

cat > "$BUILD_DIR/${APP}.spec" <<SPEC
Name:           ${APP}
Version:        ${VERSION}
Release:        ${RELEASE}%{?dist}
Summary:        ${SUMMARY}

License:        ${LICENSE}
URL:            https://github.com/yanziruxue/docker-manager
Source0:        %{name}-%{version}.tar.gz

# ★ 与 deb 的差异：Requires **无版本比较运算符**（rpm 不支持 ">= 232" 这种写法）
Requires:       systemd
Requires(post): systemd

# 用 glibc 的 RPM 包名约束发行版：glibc >= 2.28 ⇒ CentOS/RHEL 8+
# （Node 22 基座的硬要求；CentOS 7 会在启动时找不到 GLIBC_2.28 符号）
Requires:       glibc >= 2.28

BuildArch:      ${ARCH}

# 本包**不从源码编译**（是预构建 SEA 二进制的再打包），故不需要 BuildRequires，
# 也不给 %build 段。用 %{__osinstall_post} 之外的精简流程即可。

%description
本地部署的 Docker / Compose 管理面板，提供容器、镜像、堆栈、卷、网络的
可视化管理与文件操作，并支持多引擎、系统信息与温度监控。

以 systemd 服务形式运行，默认安装到 /opt/${APP}，以一个已存在的非 root 系统用户
身份运行（安装时自动选取 UID>=1000 的登录用户，可用 /etc/default/${APP} 的
APP_RUN_AS_USER 覆盖；APP_INSTALL_DIR 可自定义安装目录）。

%prep

%build

# ★ 关键：不把 systemd 单元放进 payload —— 单元含 __INSTALL_DIR__ /
#   __SERVICE_USER__ 占位符，须由 %post 调 install.sh 现场替换；且 /etc 下文件
#   被 rpm 标记为 config 会在升级时触发 conffile 交互，un unattended 安装失败。
%install
# ★ $SRCDIR 必须写成 \$SRCDIR —— spec 会先把 $ 展开成宏，裸写会被当成未定义宏而清空。
#   ${APP} 是 bash 生成 spec 时替换的（不是 rpm 宏），保持原样即可。
mkdir -p %{buildroot}/opt/${APP}
install -m 0755  "\$SRCDIR/${APP}"            %{buildroot}/opt/${APP}/${APP}
install -m 0755  "\$SRCDIR/install.sh"       %{buildroot}/opt/${APP}/install.sh
install -m 0755  "\$SRCDIR/uninstall.sh"     %{buildroot}/opt/${APP}/uninstall.sh
install -m 0644  "\$SRCDIR/${APP}.service"   %{buildroot}/opt/${APP}/${APP}.service
install -m 0644  "\$SRCDIR/README.md"        %{buildroot}/opt/${APP}/README.md

%files
%dir /opt/${APP}
/opt/${APP}/${APP}
/opt/${APP}/install.sh
/opt/${APP}/uninstall.sh
/opt/${APP}/${APP}.service
/opt/${APP}/README.md

# ---- 脚本段 ---------------------------------------------------------------
# ★★ rpm 的 $1 是**数字**，不是字符串（与 deb 完全不同）：
#     0=erase(卸载)  1=upgrade(升级，旧包仍在)  2=upgrade(升级，新包安装后)
#   deb 的 prerm 收的是 "remove"/"upgrade"/"purge" 等字符串，直接照搬会全错。
%pre
%post
# 与 deb 的 postinst 保持同一套环境变量约定，便于两种包行为一致
APP_NAME=${APP}
INSTALL_DIR=/opt/\$APP_NAME

# 可选覆盖：/etc/default/\$APP_NAME 可设 APP_INSTALL_DIR / APP_RUN_AS_USER
if [ -f /etc/default/\$APP_NAME ]; then
  . /etc/default/\$APP_NAME || true
fi

export APP_INSTALL_DIR="\${APP_INSTALL_DIR:-\$INSTALL_DIR}"

# 非交互选取服务运行账户：首个 UID 1000-65533 的登录用户（shell 非 nologin/false）
if [ -z "\${APP_RUN_AS_USER:-}" ]; then
  APP_RUN_AS_USER="\$(getent passwd | awk -F: '\$3>=1000 && \$3<65534 && \$7!="" && \$7!~/(nologin|false)\$/ {print \$1; exit}')"
fi
export APP_RUN_AS_USER

if [ -z "\$APP_RUN_AS_USER" ]; then
  echo "ERROR: 未找到可用的非 root 系统用户（UID 1000-65533 且具登录 shell）。" >&2
  echo "       请先创建用户，或在 /etc/default/\$APP_NAME 设置 APP_RUN_AS_USER=<用户名> 后执行：" >&2
  echo "         rpm --reconfigure ${APP}" >&2
  exit 1
fi

# 非交互安装：跳过 Docker 依赖硬检查（缺失时面板仍可启动，仅容器管理不可用）
if [ -x "\$INSTALL_DIR/install.sh" ]; then
  if ! bash "\$INSTALL_DIR/install.sh" --ignore-docker; then
    echo "WARN: install.sh 返回非零（部署可能不完整），请检查后手动执行：" >&2
    echo "         systemctl daemon-reload && systemctl restart \$APP_NAME" >&2
  fi
fi

systemctl daemon-reload 2>/dev/null || true
exit 0

%preun
# ★ \$1: 0=erase  1=upgrade ⇒ 两者都要先停服务（必须早于二进制被移除）
if [ "\$1" = "0" ] || [ "\$1" = "1" ]; then
  systemctl stop ${APP} 2>/dev/null || true
  systemctl disable ${APP} 2>/dev/null || true
fi
exit 0

%postun
# ★ \$1: 0=erase（真卸载）  1=upgrade（**不要**清理，否则会把新版单元删掉）
if [ "\$1" = "0" ]; then
  # 单元 / sudoers / drivetemp 配置均非 rpm 文件，由本包生成，此处清理
  rm -f /etc/systemd/system/${APP}.service
  rm -f /etc/sudoers.d/${APP}
  rm -f /etc/modules-load.d/drivetemp.conf
fi
systemctl daemon-reload 2>/dev/null || true
exit 0

%changelog
* Mon Oct 12 2026 yanzi <maintainer@dockermanagementyanzi.local> - ${VERSION}-${RELEASE}
- ${SUMMARY}
- 自动构建，详见 docs/CHANGELOG.md
SPEC

echo "==> spec 已生成: $BUILD_DIR/${APP}.spec"

# ---- 构建 -----------------------------------------------------------------
# 顶层目录名必须与 Source0 的 basename 一致，否则 rpmbuild 找不到源码
mkdir -p "$BUILD_DIR/rpmbuild/SOURCES" "$BUILD_DIR/rpmbuild/SPECS" "$BUILD_DIR/rpmbuild/BUILD" \
         "$BUILD_DIR/rpmbuild/RPMS" "$BUILD_DIR/rpmbuild/SRPMS"
tar -czf "$BUILD_DIR/rpmbuild/SOURCES/${APP}-${VERSION}.tar.gz" \
    --transform "s|^|${APP}-${VERSION}/|" \
    -C "$HERE" "$APP" install.sh uninstall.sh "${APP}.service" README.md
cp "$BUILD_DIR/${APP}.spec" "$BUILD_DIR/rpmbuild/SPECS/"

mkdir -p "$OUT_DIR"
echo "==> 执行 rpmbuild -bb ..."
rpmbuild -bb \
  --define "_topdir $BUILD_DIR/rpmbuild" \
  --define "_tmppath ${TMPDIR:-/tmp}" \
  "$BUILD_DIR/rpmbuild/SPECS/${APP}.spec"

RPM_OUT="$(find "$BUILD_DIR/rpmbuild/RPMS" -name "*.rpm" | head -1)"
if [ -z "$RPM_OUT" ]; then
  echo "ERROR: rpmbuild 未产出 rpm 包" >&2
  exit 1
fi
FINAL="$OUT_DIR/${APP}-${VERSION}-${RELEASE}.${ARCH}.rpm"
mv "$RPM_OUT" "$FINAL"

SIZE=$(wc -c < "$FINAL")
SHA=$(sha256sum "$FINAL" | cut -d' ' -f1)
echo ""
echo "完成: $FINAL (${SIZE} 字节)"
echo "SHA-256: ${SHA}"
echo ""
echo "=== 包内容（rpm -qlp）==="
rpm -qlp "$FINAL" 2>/dev/null || echo "  （rpm 命令不可用，跳过清单打印）"
echo ""
echo "★ 提示：本包仅支持 glibc >= 2.28（CentOS/RHEL/Rocky/Alma 8+、Fedora 30+）。"
echo "  安装: sudo rpm -ivh $FINAL     卸载: sudo rpm -e ${APP}"
