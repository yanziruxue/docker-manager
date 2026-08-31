#!/usr/bin/env bash
# ============================================
# 构建 docker-manager-yanzi 镜像
#
# 用法:
#   bash build-image.sh                                              # docker-manager-yanzi:latest
#   bash build-image.sh myrepo/dsm:v1                                # 指定镜像名
#   bash build-image.sh docker-manager-yanzi:latest \
#       --build-arg NPM_REGISTRY=https://registry.npmmirror.com      # 国内 npm 加速
# ============================================
set -euo pipefail

IMAGE="${1:-docker-manager-yanzi:latest}"
EXTRA_ARGS="${@:2}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 构建上下文 = 项目根（Dockerfile 引用的源码都在根下）
CONTEXT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "━━━ 构建 Docker 镜像 ━━━"
echo "[INFO] 镜像名:    ${IMAGE}"
echo "[INFO] 构建上下文: ${CONTEXT_DIR}"
echo "[INFO] Dockerfile: ${SCRIPT_DIR}/Dockerfile"
echo ""

docker build -f "${SCRIPT_DIR}/Dockerfile" -t "${IMAGE}" ${EXTRA_ARGS} "${CONTEXT_DIR}"

echo ""
echo "✅ 镜像构建完成: ${IMAGE}"
echo ""
echo "下一步（二选一）:"
echo "  本地运行:    cd ${SCRIPT_DIR} && docker compose up -d"
echo "  导出离线包:  docker save -o docker-manager-yanzi.tar ${IMAGE}"
