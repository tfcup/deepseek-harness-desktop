# .github/workflows

| workflow | 触发 | 职责 |
|---|---|---|
| `upstream-watch.yml` | 每小时 + 手动 | 比较 npm 最新 Harness 与 `runtime/.known-version`，发现新版后触发 Runtime 构建 |
| `runtime-build.yml` | upstream-watch + 手动 | 固定 Harness → 构建 Runtime → Compatibility Gate → 调用 Desktop Release → 成功后确认已知版本 |
| `desktop-release.yml` | runtime-build + tag + 手动 | 使用已验证 Artifact 或已确认 Harness 构建完整 DMG、Updater 包、签名和 `latest.json` |
| `desktop-test.yml` | push / PR | Rust、前端和 Extension Pack 质量门禁 |

Runtime 构建不会创建独立 GitHub Release。自动流水线只有在 Desktop Release 成功后才更新
`.known-version`，因此任何构建或发布失败都会在下一轮上游检查时得到重试机会。

手动执行 `desktop-release` 时，`version` 留空会对最高 `vX.Y.Z` 自动增加 patch；
填写版本则严格使用指定版本。
