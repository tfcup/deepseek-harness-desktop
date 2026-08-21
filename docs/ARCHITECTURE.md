# 架构说明

`deepseek-harness-desktop` 是一个 Tauri 2 桌面应用，将经过 CI 兼容性验证的
`@deepseek-ai/dsh` 随 Desktop Release 一起分发。

## 运行结构

```text
Harness 设置 > 应用更新
        │ postMessage（校验 iframe window + origin）
        ▼
Tauri React 外壳 ── tauri-plugin-updater ── Desktop Release
        │ launch_harness
        ▼
Rust Runtime Manager
  校验 bundle manifest/SHA256
  → 激活 runtime/versions/<v>
  → 启动 Harness
  → 健康检查
  → 失败自动恢复 previous
        ▼
http://127.0.0.1:3080/ → iframe
```

Runtime 是 Desktop App 的内部版本化载荷，不提供远程 Channel、独立更新入口或公开 Release。
App 更新后首次启动会采用构建 manifest 中的精确 Runtime 版本；相同版本跳过，失败版本会被
标记并继续使用上一版本。

## 数据目录

`~/Library/Application Support/Deepseek-Harness-Desktop/` 包含：

- `runtime/versions/`、`current.json`、`previous.json`：当前和回滚 Runtime
- `data/dsh/`：隔离的 `$DSH_HOME`，App/Runtime 更新不会清空
- `logs/`：应用和 Harness 日志
- `.store.dat`：桌面设置

Node.js 不随 App 分发，启动时从 PATH、登录 shell、Homebrew 或 nvm 查找兼容版本。

## 发布结构

```text
npm 上游版本
  → upstream-watch
  → runtime-build + Compatibility Gate
  → desktop-release（DMG + .app.tar.gz + .sig + latest.json）
  → runtime/.known-version
```

新用户使用 DMG；已安装用户通过 Harness 设置中的唯一 App 更新入口安装完整桌面更新。
