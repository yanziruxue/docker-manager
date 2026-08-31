# -*- coding: utf-8 -*-
"""
打包 Docker 镜像构建源码包（本机无 docker 也可直接交付）。
输出: build-upload/docker-manager-yanzi-docker-src.zip
zip 顶层带 docker-manager-yanzi-docker/ 文件夹，解压后即可 docker build。
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))          # deploy/docker
ROOT = os.path.dirname(os.path.dirname(HERE))              # 项目根
OUT = os.path.join(ROOT, "build-upload", "docker-manager-yanzi-docker-src.zip")
PREFIX = "docker-manager-yanzi-docker/"

# 项目根下需要交付的文件与目录
ROOT_FILES = [
    "package.json",
    "package-lock.json",
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
    "tailwind.config.js",
    "postcss.config.js",
    ".dockerignore",
    "docker.png",
]
ROOT_DIRS = ["public", "src", "server", "scripts"]

# deploy/docker 下交付文件（build-image.sh 保留可执行位）
DOCKER_FILES = {
    "Dockerfile": 0o644,
    "docker-compose.yml": 0o644,
    "build-image.sh": 0o755,
    "README.md": 0o644,
}

# 始终排除
EXCLUDE_DIRS = {"node_modules", "dist", ".git", ".workbuddy", "build-upload"}
EXCLUDE_EXT = (".zip", ".tar.gz", ".log", ".blob")


def add_tree(zf, root, rel=""):
    """递归添加目录，返回 (added, skipped)"""
    added = skipped = 0
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if entry in EXCLUDE_DIRS or entry.endswith(EXCLUDE_EXT):
            skipped += 1
            continue
        relp = f"{rel}/{entry}" if rel else entry
        # server 目录特例：dist 编译产物与旧运行时数据不打包
        if rel == "server" and entry in ("dist", "settings.json", "engines.json", "active_engine.json"):
            skipped += 1
            continue
        if os.path.isdir(full):
            a, s = add_tree(zf, full, relp)
            added += a
            skipped += s
        else:
            zf.write(full, PREFIX + relp)
            added += 1
    return added, skipped


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)

    total = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        # 根文件
        for f in ROOT_FILES:
            full = os.path.join(ROOT, f)
            if os.path.exists(full):
                zf.write(full, PREFIX + f)
                total += 1
        # 根目录
        for d in ROOT_DIRS:
            full = os.path.join(ROOT, d)
            if os.path.isdir(full):
                a, _ = add_tree(zf, full, d)
                total += a
        # deploy/docker 交付文件（显式权限位）
        for f, mode in DOCKER_FILES.items():
            full = os.path.join(HERE, f)
            zi = zipfile.ZipInfo(PREFIX + "deploy/docker/" + f)
            zi.external_attr = (mode & 0xFFFF) << 16
            with open(full, "rb") as fh:
                zf.writestr(zi, fh.read())
            total += 1

    size_mb = os.path.getsize(OUT) / 1024 / 1024
    print(f"✅ 打包完成: {OUT} ({size_mb:.2f} MB, {total} 个文件)")


if __name__ == "__main__":
    main()
