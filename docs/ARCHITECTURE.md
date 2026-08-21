# 架构说明

`deepseek-harness-desktop` 是一个 Tauri 2 桌面应用，参考
[tangtao646/n8n-desktop](https://github.com/tangtao646/n8n-desktop) 的「自动下载依赖 +
本地进程 + 内嵌 Web 界面」模式，把 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
包装成无需手动安装 Node.js 的本地桌面体验。

## 组件

```text
┌────────────────────────────────────────────────┐
│ Tauri WebView (React 前端)                     │
│  状态机 → 下载进度 → 就绪后 iframe 加载 dsh UI  │
│  侧边栏：版本/地址/日志/设置/操作               │
└───────────────▲────────────────────────────────┘
                │ invoke 命令 + 事件
┌───────────────┴────────────────────────────────┐
│ Tauri Rust 后端                                │
│  bridge     : invoke 命令（cmd.rs）            │
│  config     : 常量 / 运行时路径 / 设置         │
│  service    : download 安装器 + workflow 进程  │
│  task       : tick 检测 dsh 服务状态           │
└───────┬──────────────────────┬─────────────────┘
        │                      │
   <app-data>/runtime      <app-data>/dependencies/dsh
   (Node.js v22.22.0)      (deepseek-harness-pkg zip 解压)
        │                      │
        └──────────┬───────────┘
                   ▼
        dsh --profile web --host 127.0.0.1 --port 3080
                   │  DSH_HOME=<app-data>/data/dsh
                   ▼
        http://127.0.0.1:3080/  ← iframe
```

## 启动流程

1. 检查/下载 Node.js 运行时（`nodejs.org`，`service/download` 带进度解压）；
2. 检查/下载 `deepseek-harness-pkg-<os>.zip`（GitHub Release）；
3. 解压到 `<app-data>/dependencies/dsh`；
4. 以隔离的 `$DSH_HOME`（`<app-data>/data/dsh`）启动 `dsh --profile web`；
5. 轮询健康检查，就绪后在前端 iframe 中加载 UI。

## 数据目录

- macOS：`~/Library/Application Support/Deepseek-Harness-Desktop/`（自定义命名，不随 bundle id）

包含：`node/`（App Managed Node，独立目录）、`dependencies/dsh/`（harness 发行版）、
`runtime/versions/` + `current.json`/`previous.json`（Runtime 多版本与回滚结构，Phase 1 启用）、
`data/dsh/`（harness 用户数据）、`logs/`、`.store.dat`（桌面设置）。

## 仓库结构

pnpm Monorepo，目录与 `deepseek-harness-desktop-macos-arm64-design.md`（见 `docs/`）对齐：

```text
apps/desktop/                    Tauri 桌面应用（前端 + Rust 后端）
packages/                        Extension Pack（harness-adapter / dsh-theme / dsh-ui / dsh-tools / dsh-integrations / dsh-desktop-bundle）
runtime/                         Harness Runtime 构建工程（Phase 4）
updater/                         发布通道 stable / beta / dev（Phase 4）
tests/                           测试（desktop / runtime / integration / e2e）
scripts/                         仓库级辅助脚本
.github/workflows/               CI/CD 流水线（Phase 4/6）
```

## 目录说明

```text
apps/desktop/src/                    React 前端（状态机、侧边栏、i18n）
apps/desktop/src-tauri/src/bridge/   invoke 命令（cmd.rs）
apps/desktop/src-tauri/src/config/   常量 / 运行时路径 / 设置（store）
apps/desktop/src-tauri/src/process/  Harness 进程生命周期（原 service/workflow）
apps/desktop/src-tauri/src/health/   定时检测 dsh 服务状态（原 task/tick_check_dsh_process）
apps/desktop/src-tauri/src/node/     Managed Node 运行时（占位，Phase 2 落地）
apps/desktop/src-tauri/src/service/  download 安装器 + scheduler
apps/desktop/src-tauri/src/logger/   简易日志系统（SimpleLogger）
apps/desktop/public/favicon.svg      应用图标源（黑标白底圆角，pnpm icons 生成）
docs/PKG-CONTRACT.md                 deepseek-harness-pkg 发布契约
```

> 后端目录与文件命名对齐早期依赖 n8n 的
> [damn-reports](https://github.com/hairyf/damn-reports)（提交 `c818b79`）：
> `bridge/`、`config/`、`core/`、`logger/`、`service/download/`、
> `service/workflow/`、`task/`。
