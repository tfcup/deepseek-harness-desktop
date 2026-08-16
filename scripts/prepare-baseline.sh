#!/bin/bash
# 准备方案 B 基线资源（等价于 desktop-release.yml 的"准备基线"步骤，本地可运行）
#
# 产物：apps/desktop/src-tauri/resources/baseline/
#   runtime.zip   — Baseline Runtime（npm dsh 基座 → build-runtime.ts 产物，已瘦身）
#
# 说明（§15 修订）：Node 不再内置——应用直接使用用户本机 Node（缺失即报错）。
#
# 之后直接 `cd apps/desktop && pnpm tauri build` 即可得到含基线的完整 DMG（~64MB）。
#
# 用法：
#   scripts/prepare-baseline.sh                 # 默认 latest dsh
#   DSH_VERSION=0.1.0-rc.6 scripts/prepare-baseline.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DSH_VERSION="${DSH_VERSION:-latest}"
BASE_DIR="${BASELINE_TMP:-$(mktemp -d /tmp/dsh-baseline.XXXXXX)}"
BASELINE_DIR="$REPO_ROOT/apps/desktop/src-tauri/resources/baseline"

echo "==> 基线目录: $BASELINE_DIR"
mkdir -p "$BASELINE_DIR"

# [1/2] npm 安装 dsh 基座（npm：原生跑 postinstall、真实目录布局、zip 更小）
echo "[1/2] npm 安装 @deepseek-ai/dsh@$DSH_VERSION 到 $BASE_DIR …"
mkdir -p "$BASE_DIR"
cd "$BASE_DIR"
echo "{\"name\":\"dsh-base\",\"private\":true,\"dependencies\":{\"@deepseek-ai/dsh\":\"$DSH_VERSION\"}}" > package.json
npm install --no-audit --no-fund

# [2/2] 构建 Runtime zip 并复制为 baseline
echo "[2/2] 构建 Baseline Runtime…"
cd "$REPO_ROOT"
OUT=$(DSH_BASE="$BASE_DIR" node runtime/scripts/build-runtime.ts --channel dev --out runtime/dist)
echo "$OUT" | tail -4
ZIP=$(ls -t runtime/dist/runtime-*-arm64.zip | head -1)
[[ -n "$ZIP" ]] || { echo "✗ 未生成 runtime zip" >&2; exit 1; }
cp "$ZIP" "$BASELINE_DIR/runtime.zip"
echo "    runtime.zip ← $ZIP"

echo ""
echo "✅ 基线就绪："
ls -lh "$BASELINE_DIR"
echo ""
echo "下一步：cd apps/desktop && pnpm tauri build --target aarch64-apple-darwin（得到含基线的完整 DMG）"
echo "临时 dsh 基座保留在 ${BASE_DIR}（可删除；重新构建会再次 npm install）"
echo "说明：node-pty/koffi 等原生模块在当前环境无法编译（安装脚本静默失败），"
echo "      不影响已验证的核心功能（web UI/扩展/agent）；如后续需要可专项处理。"
