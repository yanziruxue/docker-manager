#!/usr/bin/env bash
# ============================================
# Docker Stack Manager — Linux 构建脚本
#
# 将 bundle.js 打包为 Node.js SEA 单一二进制
#
# 前置（在开发机完成）：
#   npm run build:binary    # 生成 deploy/linux/bundle.js
#   然后把整个 deploy/linux/ 传到 Linux
#
# 用法：
#   bash build.sh
# ============================================
set -euo pipefail

APP_NAME="docker-manager-yanzi"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
title(){ echo -e "\n${BLUE}━━━ $* ━━━${NC}"; }

title "构建 Node.js SEA 二进制"

BUNDLE="${SCRIPT_DIR}/bundle.js"
SEA_CFG="${SCRIPT_DIR}/sea-config.json"
BLOB="${SCRIPT_DIR}/sea-prep.blob"
OUTPUT="${SCRIPT_DIR}/${APP_NAME}"

# 检查 Node.js
if ! command -v node &>/dev/null; then
  err "未安装 Node.js，请先安装 Node.js 20+"
fi
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js $(node -v) 版本过低，需要 20+（推荐 22+）"
fi
log "Node.js $(node -v)"

if [ ! -f "$BUNDLE" ]; then
  err "未找到 bundle.js，请先在开发机运行: npm run build:binary"
fi
log "bundle.js: $(du -h "$BUNDLE" | cut -f1)"

# SEA 配置
log "生成 SEA 配置..."
cat > "$SEA_CFG" <<'EOF'
{
  "main": "PLACEHOLDER_BUNDLE",
  "output": "PLACEHOLDER_BLOB",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true
}
EOF
sed -i "s|PLACEHOLDER_BUNDLE|$BUNDLE|" "$SEA_CFG"
sed -i "s|PLACEHOLDER_BLOB|$BLOB|" "$SEA_CFG"

# 创建 blob
log "创建 SEA blob..."
node --experimental-sea-config "$SEA_CFG"

# 复制 node 二进制
log "复制 Node.js 运行时..."
cp "$(command -v node)" "$OUTPUT"

# 注入 blob
log "注入 SEA blob..."
npx --yes postject "$OUTPUT" \
  NODE_SEA_BLOB "$BLOB" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

chmod +x "$OUTPUT"

# 清理临时文件
rm -f "$SEA_CFG" "$BLOB"

log "构建完成: ${OUTPUT} ($(du -h "$OUTPUT" | cut -f1))"
echo ""
log "下一步: sudo bash install.sh"
