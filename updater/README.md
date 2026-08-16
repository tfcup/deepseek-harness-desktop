# updater

桌面端双更新体系（设计文档 §18 / §19）：

```text
Update Manager（侧边栏 UI）
        ├── Desktop Update ── tauri-plugin-updater（本目录：latest.json 清单 + 签名）
        └── Runtime Update  ── Runtime Manager（runtime/ 构建 + updater/channels/*.json）
```

## 目录

```text
updater/
├── channels/                # Runtime 通道清单（dev/beta/stable，runtime publish 写入，桌面端 check_runtime_update 消费）
├── schema/                  # RuntimeManifest JSON Schema（§7）
├── scripts/
│   └── generate-updater-json.ts   # 生成 Tauri Desktop Update 的 latest.json
├── keys/                    # 更新签名密钥对（私钥 *.key 已 gitignore，仅 dev 用；生产密钥只存 CI Secrets）
└── dist/                    # 生成的 latest.json（上传到 endpoint 指向的 GitHub Release 资产）
```

## Desktop Update 发布流程（Phase 6 完整启用；当前依赖已接入）

```sh
# 1) 构建含签名配置的 App（CI：TAURI_SIGNING_PRIVATE_KEY(_PATH) + PASSWORD 环境变量）
cd apps/desktop
pnpm tauri build --target aarch64-apple-darwin

# 2) 对安装产物（.app.tar.gz）签名，生成 .sig
tauri signer sign -f <target>/aarch64-apple-darwin/release/bundle/macos/app.tar.gz \
  -k updater/keys/desktop-updater.key -p "<password>"

# 3) 生成 latest.json 并随 Release 上传（endpoint 指向该 URL）
node updater/scripts/generate-updater-json.ts \
  --version 1.2.4 \
  --url https://github.com/<owner>/<repo>/releases/download/v1.2.4/app.tar.gz \
  --signature-file <path.sig>
```

桌面端：侧边栏"桌面更新"卡片 → 检查/安装（`@tauri-apps/plugin-updater`，pubkey/endpoint 在
`tauri.conf.json` plugins.updater）。

## 密钥说明

- `updater/keys/desktop-updater.key` 为**开发用**密钥（已 gitignore）；生产密钥应只在 CI Secrets
  （`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）中配置；
- 公钥 `desktop-updater.key.pub` 入库，写入 `tauri.conf.json` 的 `plugins.updater.pubkey`。
