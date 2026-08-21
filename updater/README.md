# updater

项目只提供一套用户更新入口：Harness 自带的 **设置 > 常规 > 应用更新**。

```text
Harness Settings
  → 受限 postMessage 桥
  → tauri-plugin-updater
  → desktop-updater/latest.json
  → .app.tar.gz + signature
```

DMG 用于首次安装和手动恢复；已安装 App 使用同一 Desktop Release 中经过签名的
`.app.tar.gz` 完成自动替换。Runtime 随 Desktop App 一起更新，不存在独立 Channel。

## 目录

- `scripts/generate-updater-json.ts`：生成 Tauri Updater 的 `latest.json`
- `scripts/resolve-desktop-version.mjs`：手动版本或自动 patch +1
- `schema/runtime-manifest.schema.json`：App 内置 Runtime 清单结构
- `keys/`：Updater 密钥；私钥只允许保存在本地或 GitHub Secrets

固定的 `desktop-updater` Release tag 只保存可覆盖的 `latest.json`，清单中的更新包
始终指向不可变的 `vX.Y.Z` Desktop Release。
