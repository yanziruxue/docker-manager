#!/usr/bin/env python3
"""
构建 Debian 包 (.deb) —— 纯 Python 实现（沙箱无 dpkg-deb / ar）

用法: python make-deb.py
产物: build-upload/dockermanagementyanzi_<version>_amd64.deb

设计要点
========
· 复用现有交付内容：把 bundle（二进制 + install.sh + uninstall.sh + .service + README）
  安装到 /opt/dockermanagementyanzi/，与 zip 解压结果一致。
· 二进制内 self-detection 依赖 `basename(execPath) == APP_NAME`，故装到
  /opt/dockermanagementyanzi/dockermanagementyanzi 即可通过。
· systemd 单元由 postinst 非交互调用 install.sh 生成（install.sh 负责替换 __INSTALL_DIR__ /
  __SERVICE_USER__ 占位符、写入 /etc/systemd/system、enable、start），不在 data.tar 里直接
  放已解析单元 —— 避免 dpkg conffile 冲突，且 OTA / 重跑 install.sh 即可修复单元。
· postinst 非交互：自动选取首个 UID>=1000 的登录用户作为服务运行账户；可用
  /etc/default/dockermanagementyanzi 的 APP_RUN_AS_USER / APP_INSTALL_DIR 覆盖。
· 因目标机可能尚未装 Docker，postinst 给 install.sh 传 --ignore-docker（应用仍可启动，
  仅容器管理不可用），与 zip 手动安装时的行为一致。
· 二进制跨机重建（useCodeCache:false 的 blob），故 .deb 内二进制与 zip 内同一份。

.ar 结构: debian-binary(2.0) + control.tar.gz + data.tar.gz（GNU ar，手工拼装）。
"""
import os
import io
import json
import gzip
import hashlib
import tarfile
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # deploy/linux -> 仓库根
OUT_DIR = os.path.join(ROOT, "build-upload")
os.makedirs(OUT_DIR, exist_ok=True)

with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as _f:
    VERSION = json.load(_f)["version"]

APP = "dockermanagementyanzi"
ARCH = "amd64"
PKG = APP
DEB = os.path.join(OUT_DIR, f"{PKG}_{VERSION}_{ARCH}.deb")

# data.tar.gz 要安装的文件：(源文件名, 安装相对路径, 权限)
DATA_FILES = [
    (APP,                f"opt/{APP}/{APP}",                0o755),
    ("install.sh",       f"opt/{APP}/install.sh",            0o755),
    ("uninstall.sh",     f"opt/{APP}/uninstall.sh",          0o755),
    (f"{APP}.service",   f"opt/{APP}/{APP}.service",         0o644),
    ("README.md",        f"opt/{APP}/README.md",             0o644),
]

# ---------------------------------------------------------------------------
# 维护者脚本
# ---------------------------------------------------------------------------
POSTINST = r"""#!/bin/sh
set -e

APP_NAME=dockermanagementyanzi
INSTALL_DIR=/opt/$APP_NAME

# 可选覆盖：/etc/default/$APP_NAME 可设 APP_INSTALL_DIR / APP_RUN_AS_USER
# （仅在显式设置时才传给 install.sh；未设置则交给 install.sh 自行交互询问，行为与手工一致）
if [ -f /etc/default/$APP_NAME ]; then
  . /etc/default/$APP_NAME || true
fi

run_install() {
  bash "$INSTALL_DIR/install.sh" "$@"
}

if [ -t 0 ]; then
  # 交互环境（在终端执行 dpkg -i）：把 stdin 透传给 install.sh，
  # 由它自行询问「安装目录」「服务运行账户」（与手工 `sudo bash install.sh` 完全一致，
  # 含 Docker 依赖检查）。用户中途可自定义目录 / 账户。
  if [ -x "$INSTALL_DIR/install.sh" ]; then
    if ! run_install; then
      echo "WARN: install.sh 返回非零（部署可能不完整）。" >&2
      echo "       请检查后手动执行: sudo bash $INSTALL_DIR/install.sh" >&2
    fi
  fi
else
  # 非交互环境（apt / DEBIAN_FRONTEND=noninteractive / CI）：
  # 自动选取首个 UID>=1000 的登录用户、跳过 Docker 硬检查，避免无人值守安装失败。
  export APP_INSTALL_DIR="${APP_INSTALL_DIR:-$INSTALL_DIR}"
  if [ -z "${APP_RUN_AS_USER:-}" ]; then
    APP_RUN_AS_USER="$(getent passwd | awk -F: '$3>=1000 && $3<65534 && $7!="" && $7!~/(nologin|false)$/ {print $1; exit}')"
  fi
  export APP_RUN_AS_USER

  if [ -z "$APP_RUN_AS_USER" ]; then
    echo "ERROR: 未找到可用的非 root 系统用户（UID 1000-65533 且具登录 shell）。" >&2
    echo "       请先创建用户，或在 /etc/default/$APP_NAME 设置 APP_RUN_AS_USER=<用户名> 后执行：" >&2
    echo "         dpkg --configure -a" >&2
    exit 1
  fi

  if [ -x "$INSTALL_DIR/install.sh" ]; then
    if ! run_install --ignore-docker; then
      echo "WARN: install.sh 返回非零（部署可能不完整），请检查后手动执行：" >&2
      echo "         systemctl daemon-reload && systemctl restart $APP_NAME" >&2
    fi
  fi
fi

systemctl daemon-reload 2>/dev/null || true
exit 0
"""

PRERM = r"""#!/bin/sh
set -e
APP_NAME=dockermanagementyanzi
# 升级 / 卸载 / 重配置前先停服务（先于二进制被 dpkg 移除）
if [ "$1" = "remove" ] || [ "$1" = "deconfigure" ] || [ "$1" = "upgrade" ]; then
  systemctl stop $APP_NAME 2>/dev/null || true
  systemctl disable $APP_NAME 2>/dev/null || true
fi
exit 0
"""

POSTRM = r"""#!/bin/sh
set -e
APP_NAME=dockermanagementyanzi
case "$1" in
  remove|purge|disappear)
    # 单元 / sudoers / drivetemp 配置均非 dpkg 文件，由本包生成，此处清理
    rm -f /etc/systemd/system/$APP_NAME.service
    rm -f /etc/sudoers.d/$APP_NAME
    rm -f /etc/modules-load.d/drivetemp.conf
    ;;
esac
if [ "$1" = "purge" ]; then
  # 彻底清除（含运行时数据）
  rm -rf /opt/$APP_NAME
fi
systemctl daemon-reload 2>/dev/null || true
exit 0
"""

CONTROL = f"""Package: {PKG}
Version: {VERSION}
Section: admin
Priority: optional
Architecture: {ARCH}
Depends: systemd (>= 232)
Maintainer: yanzi <maintainer@dockermanagementyanzi.local>
Description: Docker Stack Manager — 多引擎 Docker 管理面板
 本地部署的 Docker / Compose 管理面板，提供容器、镜像、堆栈、卷、网络的
 可视化管理与文件操作，并支持多引擎、系统信息与温度监控。
 .
 以 systemd 服务形式运行，默认安装到 /opt/{APP}，以一个已存在的非 root 系统用户
 身份运行（安装时自动选取 UID>=1000 的登录用户，可用 /etc/default/{APP} 的
 APP_RUN_AS_USER 覆盖；APP_INSTALL_DIR 可自定义安装目录）。
"""

# ---------------------------------------------------------------------------
# tar 打包
# ---------------------------------------------------------------------------
def make_tar(files, mode="w:gz"):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode=mode, format=tarfile.GNU_FORMAT) as tf:
        for ti, payload in files:
            tf.addfile(ti, io.BytesIO(payload) if payload is not None else None)
    return buf.getvalue()


def dir_entry(path, mode):
    ti = tarfile.TarInfo(path)
    ti.type = tarfile.DIRTYPE
    ti.mode = mode
    ti.uid = 0
    ti.gid = 0
    ti.uname = "root"
    ti.gname = "root"
    ti.mtime = 0
    return ti, None


def file_entry(path, mode, data, mtime=0):
    ti = tarfile.TarInfo(path)
    ti.type = tarfile.REGTYPE
    ti.mode = mode
    ti.size = len(data)
    ti.uid = 0
    ti.gid = 0
    ti.uname = "root"
    ti.gname = "root"
    ti.mtime = mtime
    return ti, data


def build_data_tar():
    files = []
    # 目录项
    files.append(dir_entry("opt", 0o755))
    files.append(dir_entry(f"opt/{APP}", 0o755))
    md5s = []
    for src_name, inst_path, mode in DATA_FILES:
        src = os.path.join(HERE, src_name)
        with open(src, "rb") as fh:
            data = fh.read()
        mtime = int(os.path.getmtime(src))
        files.append(file_entry(inst_path, mode, data, mtime))
        md5s.append(f"{hashlib.md5(data).hexdigest()}  {inst_path}")
    return make_tar(files), md5s


def build_control_tar():
    files = []
    files.append(file_entry("control", 0o644, CONTROL.encode("utf-8")))
    files.append(file_entry("postinst", 0o755, POSTINST.encode("utf-8")))
    files.append(file_entry("prerm", 0o755, PRERM.encode("utf-8")))
    files.append(file_entry("postrm", 0o755, POSTRM.encode("utf-8")))
    # md5sums 在 build_data_tar 之后填充
    return files


# ---------------------------------------------------------------------------
# ar 拼装（GNU 格式）
# ---------------------------------------------------------------------------
def ar_member(name, data, mode):
    name_b = name.encode("ascii")
    if len(name_b) > 15:
        raise ValueError(f"ar 成员名过长: {name}")
    mode_oct = f"{0o100000 | mode:o}"       # 加 S_IFREG 类型位，如 '100644'
    # ar 头为纯 ASCII；先用 str 拼好再整体编码（避免 bytes/str fill 混用）
    header = (
        name_b.ljust(16, b" ").decode("ascii")
        + b"0".rjust(12, b" ").decode("ascii")   # mtime
        + b"0".ljust(6, b" ").decode("ascii")    # uid
        + b"0".ljust(6, b" ").decode("ascii")    # gid
        + mode_oct.rjust(8, " ")                 # mode
        + str(len(data)).rjust(10, " ")          # size
    )
    out = header.encode("ascii") + b"`\n" + data
    if len(data) % 2 == 1:
        out += b"\n"                         # 2 字节对齐填充
    return out


def build_deb():
    data_tar, md5s = build_data_tar()
    control_files = build_control_tar()
    # 把 md5sums 追加进 control.tar
    control_files.append(
        file_entry("md5sums", 0o644, ("\n".join(md5s) + "\n").encode("utf-8"))
    )
    control_tar = make_tar(control_files)

    debian_binary = b"2.0\n"

    with open(DEB, "wb") as out:
        out.write(b"!<arch>\n")
        out.write(ar_member("debian-binary", debian_binary, 0o644))
        out.write(ar_member("control.tar.gz", control_tar, 0o644))
        out.write(ar_member("data.tar.gz", data_tar, 0o644))

    return data_tar, control_tar, md5s


if __name__ == "__main__":
    data_tar, control_tar, md5s = build_deb()
    size = os.path.getsize(DEB)
    print(f"\n完成: {DEB} ({size/1024/1024:.1f} MB)")
    print("=== control 文件 ===")
    for n in ["control", "postinst", "prerm", "postrm", "md5sums"]:
        print(f"  {n}")
    print("=== data 成员 (md5sums) ===")
    for m in md5s:
        print(f"  {m}")
