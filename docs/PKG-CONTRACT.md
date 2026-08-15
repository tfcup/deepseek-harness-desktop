# deepseek-harness-pkg 发布契约

`deepseek-harness-desktop` 在首次运行时自动下载「打包好的 DeepSeek Harness 发行版」，
由 [hairyf/deepseek-harness-pkg](https://github.com/hairyf/deepseek-harness-pkg)
构建并发布到 GitHub Release。本文档记录桌面端所消费的产物格式。

> 契约与上游 `deepseek-harness` 一样处于快速迭代期；pkg 仓库的产物格式若有变化，请同步更新本文档与 `src-tauri/src/api/harness/`。

## 1. 发布方式

- 仓库：`hairyf/deepseek-harness-pkg`
- 发布：GitHub Release（`releases/latest`），每个平台一个 zip 资产
- 资产命名：

  | 平台 | 产物 |
  | --- | --- |
  | Windows | `deepseek-harness-pkg-windows.zip` |
  | macOS (Apple Silicon) | `deepseek-harness-pkg-macos-arm64.zip` |
  | macOS (Intel) | `deepseek-harness-pkg-macos-x64.zip` |
  | Linux | `deepseek-harness-pkg-linux.zip` |

  桌面端按 `deepseek-harness-pkg-<suffix>.zip` 匹配资产，其中
  `<suffix>` 由 `src-tauri/src/api/harness/installer.rs::pkg_asset_name` 生成。

## 2. zip 内部布局

zip 是自包含的 npm 项目，**顶层目录直接就是包内容**（没有额外的包裹目录）：

```text
<zip>/
├─ package.json            # pkg 清单（见第 3 节）
├─ package-lock.json
├─ patches/                # pnpm 补丁
└─ node_modules/
   ├─ @deepseek-ai/dsh/    # dsh CLI（入口 lib/bin.js）
   ├─ @deepseek-ai/*       # 全部上游 workspace 包
   ├─ @deepseek-ai/dsh-web-frontend/dist/  # 构建好的 Web UI（必须存在）
   └─ .bin/dsh             # bin shim（桌面端不使用，直接跑 lib/bin.js）
```

桌面端解压到 `<app-data>/dependencies/dsh/`，并直接调用
`node_modules/@deepseek-ai/dsh/lib/bin.js` 作为 CLI 入口。

## 3. 清单字段

`package.json`（pkg 自带的 npm 清单）中，桌面端用到：

```json
{
  "name": "deepseek-harness-pkg",
  "version": "1.0.0",
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "dependencies": {
    "@deepseek-ai/dsh": "0.1.0-rc.6"
  }
}
```

- `dependencies["@deepseek-ai/dsh"]` → 界面展示的 Harness 版本
- `version` → pkg 自身版本（用于诊断展示）
- `engines.node` → 运行时要求的参考值；桌面端最低要求为 **v22.15.0+ / v23.8.0+**（默认捆绑 `v22.22.0` LTS）

## 4. 完整性校验

桌面端通过 GitHub API 获取 `releases/latest`，按资产名匹配当前平台的 zip，
读取资产 `digest` 字段（格式 `sha256:<hex>`）做下载校验；本地 zip 哈希一致时跳过下载。

## 5. 启动方式

```bash
<node> <app-data>/dsh-core/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile web --host 127.0.0.1 --port 3080
```

环境变量：`DSH_HOME=<app-data>/dsh-home`（隔离的 harness 用户目录）、
`DSH_TELEMETRY_DISABLED=1`（隐私默认）。

## 6. 已知事项

- pkg 通过补丁（`patches/dsh-web-app@*.patch`）支持 `DSH_PKG_ALLOW_LAN=1` 显式开放
  `--host 0.0.0.0`；桌面端始终绑定 `127.0.0.1`，不涉及该开关。
- Linux 产物基于 `ubuntu-latest`（x64）构建；`linux-arm64` 暂未提供。
