#!/bin/bash
# 准备方案 B 基线资源（等价于 desktop-release.yml 的"准备基线"两步，本地可运行）
#
# 产物：apps/desktop/src-tauri/resources/baseline/
#   node.tar.gz   — App Managed Node（darwin-arm64，与 NODE_VERSION 常量一致）
#   runtime.zip   — Baseline Runtime（npm dsh 基座 → build-runtime.ts 产物）
#
# 之后直接 `cd apps/desktop && pnpm tauri build` 即可得到含基线的完整 DMG（~126MB）。
#
# 用法：
#   scripts/prepare-baseline.sh                 # 默认 v22.22.0 + latest dsh
#   NODE_VERSION=v22.22.0 DSH_VERSION=0.1.0-rc.6 scripts/prepare-baseline.sh
#   --force                                     # 强制重新下载 node.tar.gz
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-v22.22.0}"
DSH_VERSION="${DSH_VERSION:-latest}"
BASE_DIR="${BASELINE_TMP:-$(mktemp -d /tmp/dsh-baseline.XXXXXX)}"
BASELINE_DIR="$REPO_ROOT/apps/desktop/src-tauri/resources/baseline"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

echo "==> 基线目录: $BASELINE_DIR"
mkdir -p "$BASELINE_DIR"

# [1/3] Node tarball
NODE_TGZ="$BASELINE_DIR/node.tar.gz"
if [[ -f "$NODE_TGZ" && "$FORCE" == 0 ]]; then
  echo "[1/3] node.tar.gz 已存在，跳过下载（--force 重新下载）"
else
  echo "[1/3] 下载 Node $NODE_VERSION (darwin-arm64)…"
  curl -fsSL -o "$NODE_TGZ" \
    "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-arm64.tar.gz"
fi

# [2/3] npm 安装 dsh 基座（npm：原生跑 postinstall、真实目录布局、zip 更小）
echo "[2/3] npm 安装 @deepseek-ai/dsh@$DSH_VERSION 到 $BASE_DIR …"
mkdir -p "$BASE_DIR"
cd "$BASE_DIR"
echo "{\"name\":\"dsh-base\",\"private\":true,\"dependencies\":{\"@deepseek-ai/dsh\":\"$DSH_VERSION\"}}" > package.json
npm install --no-audit --no-fund

# [3/3] 构建 Runtime zip 并复制为 baseline
echo "[3/3] 构建 Baseline Runtime…"
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
echo "下一步：cd apps/desktop && pnpm tauri build --target aarch64-apple-darwin（得到 ~126MB 完整 DMG）"
echo "临时 dsh 基座保留在 ${BASE_DIR}（可删除；重新构建会再次 npm install）"
echo "说明：node-pty/koffi 等原生模块在当前环境无法编译（安装脚本静默失败），"
echo "      不影响已验证的核心功能（web UI/扩展/agent）；如后续需要可专项处理。"
