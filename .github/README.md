# .github/workflows

CI / CD 流水线（设计文档 §8 / §10 / §11 / §12）。

| workflow | 触发 | 职责 | 状态 |
|---|---|---|---|
| `upstream-watch.yml` | cron 每小时（第 17 分）+ 手动 | `npm view @deepseek-ai/dsh version` vs `runtime/.known-version`，有新版 → dispatch runtime-build | ✅ 已实现 |
| `runtime-build.yml` | workflow_dispatch（upstream-watch 自动触发） | 固定 dsh 版本 → 构建 runtime zip+sha256+manifest → Compatibility Gate（verify-runtime）→ 发布 channel → GitHub Release（tag `runtime-<v>`） | ✅ 已实现（macOS runner） |
| `runtime-promote.yml` | workflow_dispatch | dev → beta → stable 通道提升（校验方向 + 生成目标通道文件） | ✅ 已实现 |
| `desktop-test.yml` | push / PR（main） | cargo check/test + 前端 build + Extension 行为测试 | ✅ 已实现 |
| `desktop-release.yml` | tag `v*` / workflow_dispatch（version 可空） | 空版本自动 patch +1 → DMG + `.app.tar.gz` + `.sig` + `latest.json` → Release | ✅ 已实现 |

## 本地演练

runtime 流水线可在本机完整跑通（无需 GitHub）：

```sh
# 构建（zip + sha256 + manifest）→ Compatibility Gate → 发布 dev channel
cd runtime
node scripts/build-runtime.ts --channel dev
node scripts/verify-runtime.ts --runtime <STAGING>
node scripts/publish-runtime.ts --channel dev --manifest dist/manifest-*.json
```

> `runtime/.dsh-base/` 与 `runtime/dist/` 为 CI/本地构建产物，不入库（.gitignore 覆盖）。
