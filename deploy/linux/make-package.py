#!/usr/bin/env python3
"""
打包 Linux 交付 zip（保留 Unix 可执行权限位）

用法: python make-package.py
产物: deploy/linux/docker-manager-yanzi-linux-x64.zip
      zip 顶层含 docker-manager-yanzi/ 文件夹，unzip 到 /opt 即得安装目录

zip 内通过 ZipInfo.external_attr 高 16 位写入 Unix 权限位，
Linux 上 unzip / bsdtar 解压后可执行位会被正确恢复。
"""
import os
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
# 本部署实例的应用名（目录 / 服务 / 用户 / 二进制名）
APP = "docker-manager-yanzi"
# 源二进制（交叉构建产物）
SRC_BIN = os.path.join(HERE, APP)
OUT = os.path.join(HERE, f"{APP}-linux-x64.zip")
PREFIX = f"{APP}/"  # zip 内顶层文件夹

FILES = [
    # (arcname, 源路径, 权限)
    (PREFIX + APP, SRC_BIN, 0o755),
    (PREFIX + "install.sh", os.path.join(HERE, "install.sh"), 0o755),
    (PREFIX + "uninstall.sh", os.path.join(HERE, "uninstall.sh"), 0o755),
    (PREFIX + f"{APP}.service", os.path.join(HERE, f"{APP}.service"), 0o644),
    (PREFIX + "README.md", os.path.join(HERE, "README.md"), 0o644),
]


def main():
    if not os.path.exists(SRC_BIN):
        raise SystemExit(f"[ERROR] 未找到源二进制: {SRC_BIN}")

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, src, mode in FILES:
            st = os.stat(src)
            info = zipfile.ZipInfo(name, time.localtime(st.st_mtime)[:6])
            # Unix 权限位写入 external_attr 高 16 位（否则 Linux 解压后全变 0644）
            info.external_attr = (mode & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(src, "rb") as fh:
                zf.writestr(info, fh.read())
            print(f"  {oct(mode)} {st.st_size:>12} {name}")

    size = os.path.getsize(OUT)
    print(f"\n完成: {OUT} ({size/1024/1024:.1f} MB)")

    # 验证权限位
    print("\n=== 验证 zip 内权限位 ===")
    with zipfile.ZipFile(OUT) as zf:
        for zi in zf.infolist():
            perm = (zi.external_attr >> 16) & 0o7777
            print(f"  {oct(perm)} {zi.file_size:>12} {zi.filename}")


if __name__ == "__main__":
    main()
