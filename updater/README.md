# updater

桌面端双更新体系（设计文档 §18 / §19）：

```text
Harness 设置（General）
        └── Desktop Update ── postMessage 安全桥 → tauri-plugin-updater
桌面工具侧边栏
        └── Runtime Update  ── Runtime Manager（runtime/ 构建 + updater/channels/*.json）
```

## 目录

```text
updater/
├── channels/                # Runtime 通道清单（dev/beta/stable，runtime publish 写入，桌面端 check_runtime_update 消费）
├── schema/                  # RuntimeManifest JSON Schema（§7）
├── scripts/
│   ├── generate-updater-json.ts   # 生成 Tauri Desktop Update 的 latest.json
│   └── resolve-desktop-version.mjs # 手动版本或最新桌面 tag 自动 patch +1
├── keys/                    # 更新签名密钥对（私钥 *.key 已 gitignore，仅 dev 用；生产密钥只存 CI Secrets）
└── dist/                    # 生成的 latest.json（上传到 endpoint 指向的 GitHub Release 资产）
```

## Desktop Update 发布流程（Phase 6 完整启用；当前依赖已接入）

```sh
# 1) 构建含签名配置的 App（createUpdaterArtifacts 自动生成 .app.tar.gz + .sig）
cd apps/desktop
pnpm tauri build --target aarch64-apple-darwin

# 2) 生成 latest.json 并随 Release 上传（使用 Tauri 自动生成的 .sig）
node updater/scripts/generate-updater-json.ts \
  --version 1.2.4 \
  --url https://github.com/<owner>/<repo>/releases/download/v1.2.4/app.tar.gz \
  --signature-file <path.sig>
```

桌面端：Harness 自带“设置 > 常规 > 应用更新”通过受限 postMessage 桥检查/安装；父窗口严格校验
iframe window 与本地服务 origin。pubkey/endpoint 位于 `tauri.conf.json` 的 `plugins.updater`。
endpoint 使用固定的 `desktop-updater` Release tag，避免非 prerelease 的 `runtime-*` Release 抢占
GitHub `releases/latest`，导致 Desktop 清单返回 404。

`desktop-release` 的 `version` 输入为空时读取最高 `vX.Y.Z` 并自动递增 patch；显式输入可用于
major/minor 发布。并发发布被序列化，已存在的显式版本不会被覆盖。

## 密钥说明

- `updater/keys/desktop-updater.key` 为**开发用**密钥（已 gitignore）；生产密钥应只在 CI Secrets
  （`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）中配置；
- 公钥 `desktop-updater.key.pub` 入库，写入 `tauri.conf.json` 的 `plugins.updater.pubkey`。
