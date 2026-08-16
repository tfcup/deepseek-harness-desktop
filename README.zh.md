<p align="center">
  <a href="https://github.com/tfcup/deepseek-harness-desktop">
    <img src="apps/desktop/public/favicon.svg" width="112" alt="DeepSeek Harness Desktop" />
  </a>
</p>

<h1 align="center">DeepSeek Harness 桌面版</h1>

<p align="center">
  <em>DeepSeek Harness 的 macOS 原生桌面应用 —— 本地一键运行完整 agent 平台，自动跟随官方更新，可自定义主题 / UI / 工具，全程不改任何官方源码。</em>
</p>

<p align="center">
  <a href="https://github.com/tfcup/deepseek-harness-desktop/releases/latest">
    <img src="https://img.shields.io/badge/version-0.1.11-4D6BFE?style=flat-square" alt="version 0.1.11" />
    <img src="https://img.shields.io/github/v/release/tfcup/deepseek-harness-desktop?style=flat-square&label=latest%20release" alt="latest release" />
    <img src="https://img.shields.io/github/downloads/tfcup/deepseek-harness-desktop/total?style=flat-square" alt="downloads" />
  </a>
  <img src="https://img.shields.io/badge/macOS%20ARM64-black?style=flat-square&logo=apple&logoColor=white" alt="macOS ARM64 only" />
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT license" />
</p>

<p align="center">
  <a href="https://github.com/tfcup/deepseek-harness-desktop/releases/latest"><strong>⬇ 下载最新 DMG</strong></a>
</p>

<p align="center">
  <samp>
    <a href="./README.md">English</a> ·
    <strong>中文</strong>
  </samp>
</p>

> **状态：开发预览。** 上游 `dsh` 仍在快速迭代，存在破坏性变更；本项目通过自动化流水线紧密跟随。

## 功能

- **本地一键运行** — DMG 内置预构建的 Baseline Runtime（Harness + Extension Pack），首启离线种入、零下载启动；只需本机装有 Node.js。
- **自动跟随官方更新** — 定时流水线每小时检查官方 `@deepseek-ai/dsh` 新版本，自动构建并验证版本化 Runtime，发布到 `dev` 通道；应用内一键升级（SHA-256 校验），支持一键回滚。
- **不改官方源码的自由定制** — Extension Pack（主题 / UI / 工具 / 集成）全部通过官方扩展机制注入（`ctx.theme.register`、`ctx.slots`、`ctx.tools.register` 等），不 patch 任何官方文件。
- **数据隔离** — 独立数据目录（`~/Library/Application Support/deepseek-harness-desktop/`）与 CLI `dsh` 的 `~/.dsh` 互不干扰；启动时若发现 3080 端口有任何监听者（如外部 CLI dsh），先结束监听者再拉起自己的隔离实例，绝不"采纳"外部实例。
- **轻量原生** — Tauri 2 外壳（系统 WebKit，非自带 Chromium）：标准 macOS 标题栏 + 红绿灯、主题色标题栏、System 主题同步、双击最大化。

> **为什么用 Tauri 而不是 Electron？** 相同功能下它更轻：更小的安装包、更低的内存占用、更跟手的原生窗口控制——对可能要常驻后台的本地 agent 尤为重要；内嵌的是系统 WebKit 而非自带 Chromium，进一步缩小安装体积。

## 界面预览

![DeepSeek Harness Desktop](docs/preview.png)

## 快速开始

1. 在 [Releases](https://github.com/tfcup/deepseek-harness-desktop/releases/latest) 页面下载最新的 `DeepseekDesktop_<版本>_arm64.dmg`；
2. 打开 DMG，把应用拖入 Applications；
3. **首次打开**：应用以**未签名**形式分发（ad-hoc 签名，未接入 Apple Developer 签名），macOS Gatekeeper 首次会拦截：
   - 若提示 **"应用程序已损坏，无法打开"**——文件**并没有损坏**，这是对"ad-hoc 签名 + 下载隔离属性"的误导性报错。在终端执行一次后重新打开即可：
     ```bash
     xattr -dr com.apple.quarantine "/Applications/Deepseek Harness Desktop.app"
     ```
   - 若提示的是普通的"无法验证开发者"，也可用 **右键点击应用 → 打开 → 再点打开**（仅首次）放行。
4. 应用**离线开箱即用**：首启自动种入内置 Baseline Runtime 并启动服务，就绪后内嵌 Harness 界面打开在 `http://127.0.0.1:3080`。

> 一切都在本地完成。**Runtime 更新**（Harness + Extension Pack）在应用内通过"更新源 URL"完成，不涉及 macOS 签名；**桌面端自动更新**依赖 Apple 签名，未签名分发下不可用，发布新版时从 Releases 手动下载 DMG 即可。

### 系统要求

- macOS 11+（**仅 Apple Silicon / arm64**）
- **本机需已安装 Node.js v22.15+ / v23.8+ / v24+**——无需 Rust / pnpm / Docker

应用**直接使用本机安装的 Node.js**（按 PATH → 登录 shell → Homebrew / nvm 顺序解析）。本机缺失或不兼容时应用会**明确报错**，绝不联网下载或内置运行时。

## 更新机制

两条相互独立的更新路径（详见 `updater/README.md`）：

| | Runtime 更新（Harness 内核） | 桌面更新（应用本身） |
|---|---|---|
| 更新什么 | 应用内部的 dsh 引擎——版本化、原子安装、可回滚 | 整个应用 |
| 怎么更新 | 应用内：在侧边栏把**更新源 URL** 设为通道 manifest（`dev` / `beta` / `stable` 或任意自定义 URL），然后 检查 → 下载 → 安装 | **未签名分发下不可用**（依赖 Apple 签名） |
| 流水线 | `upstream-watch`（每小时）检测到官方新版 → `runtime-build` 构建 + Compatibility Gate 验证 → 发布到 `dev` 通道；`beta` / `stable` 人工提升 | tag `v*` → `desktop-release` 在 CI 构建 DMG 并发布 GitHub Release |

当前通道状态（`updater/channels/`）：`dev.json` 指向 runtime `2026.08.16.1`（dsh `0.1.0-rc.6`）；`beta.json` / `stable.json` 为空壳，待人工提升后才有内容。

## 工作原理

```text
┌──────────────────────────────────────────────────────────────┐
│ 应用壳 — Tauri 2 + React（原生标题栏、System 主题）           │
│   boot()：种入 baseline → 启动服务 → iframe → Harness 界面    │
│   侧边栏：服务 / Runtime 更新 / 日志 / 设置                   │
└──────────────────────┬───────────────────────────────────────┘
                       │ invoke 命令（bridge/cmd.rs，约 30 个）
┌──────────────────────┴───────────────────────────────────────┐
│ Rust 后端                                                     │
│   process/    dsh 生命周期：无条件重建——3080 端口任何监听者   │
│               （含外部 CLI dsh）先结束，再用隔离的 $DSH_HOME   │
│               拉起自己的实例（仅杀 lsof -sTCP:LISTEN 监听者） │
│   runtime/    版本化安装（versions/<v> + current/previous）、 │
│               baseline 种入、更新 / 回滚                      │
│   config/     本机 Node 解析、设置、主题、i18n                │
│   service/    调度器 + 健康检查、下载引擎                     │
└──────┬───────────────────────────────┬───────────────────────┘
       │                               │
  packages/ (Extension Pack)      runtime/versions/<v>/
  主题 · UI · 工具 · 集成 ——       （CI 流水线构建，随 DMG
  通过官方扩展点注入，不改官方     内置为 baseline，应用内更新）
       └──────────────┬──────────────┘
                      ▼
   node dsh --profile web --host 127.0.0.1 --port 3080
                      │  DSH_HOME=<app-data>/data/dsh
                      ▼
         http://127.0.0.1:3080/  ← 内嵌 Harness 界面
```

- Harness 内核来自官方 npm 包 `@deepseek-ai/dsh`（另保留 [deepseek-harness-pkg](https://github.com/hairyf/deepseek-harness-pkg) 作为预构建包兜底源）。
- Runtime 快照版本化（`YYYY.MM.DD.N`），发布前经过 Compatibility Gate 验证，安装带 SHA-256 校验且可回滚。
- 实现架构详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；原始设计文档见 [docs/deepseek-harness-desktop-macos-arm64-design.md](docs/deepseek-harness-desktop-macos-arm64-design.md)。

## 数据目录

数据目录为 Application Support 下的自定义命名目录（同 Chrome/VS Code 的做法，不叫 bundle id）：

- macOS：`~/Library/Application Support/deepseek-harness-desktop/`

包含：

- `runtime/versions/<v>/`：版本化 Harness Runtime（current / previous）
- `data/dsh/`：Harness 用户数据（`$DSH_HOME`，含 profile、会话、设置），与 CLI `dsh` 的 `~/.dsh` 隔离
- `logs/`：应用与 dsh 服务日志
- `.store.dat`：桌面端配置（端口、自启动、语言）

## 开发与构建

### 环境要求

- Node.js 20+
- Rust（stable）
- pnpm 11（`corepack enable`，或用 `corepack pnpm`）
- macOS Xcode Command Line Tools

### 本地开发

```bash
git clone https://github.com/tfcup/deepseek-harness-desktop.git
cd deepseek-harness-desktop
corepack pnpm install
corepack pnpm tauri dev
```

### 本地构建 DMG

```bash
# 一次性：准备 baseline runtime zip（需要网络 + npm）
bash scripts/prepare-baseline.sh

cd apps/desktop
export PATH="$HOME/.cargo/bin:/tmp/pnpm-shim:$PATH"
export TAURI_SIGNING_PRIVATE_KEY_PATH="$PWD/../../updater/keys/desktop-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="dev-only-key-do-not-use-in-prod"
corepack pnpm tauri build --target aarch64-apple-darwin --bundles dmg
# → src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/
```

> `tauri-plugin-updater` 已启用，所以构建必须带签名配置；上面用的是仓库内 gitignore 的开发密钥。若上次构建的 DMG 仍挂载着，先 `hdiutil detach "/Volumes/Deepseek Harness Desktop"`。

### 走 CI 发布（推荐）

无需本地工具链——CI 会帮你构建 DMG：

```bash
git add -A && git commit -m "..."
git push origin main                    # 触发 desktop-test（质量门）
git tag v0.1.11 && git push origin v0.1.11   # 触发 desktop-release → 发布 Release + DMG
```

之后到 [Releases](https://github.com/tfcup/deepseek-harness-desktop/releases) 下载 DMG。打 tag 前记得同步升级 `apps/desktop/package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 与 `src-tauri/Cargo.lock` 里的版本号。

## 常见问题

- **3080 端口被占用？** 应用会结束 3080 端口上的监听进程（**仅 LISTEN socket**，绝不碰只持有普通连接的进程，如浏览器），再启动自己的隔离实例；也可以在侧边栏修改端口。
- **提示"应用程序已损坏，无法打开"？** 文件并没有损坏——这是 Gatekeeper 对"ad-hoc 签名 + 下载隔离属性"的误报。执行一次 `xattr -dr com.apple.quarantine "/Applications/Deepseek Harness Desktop.app"` 后重新打开即可（安装新版本后需再执行一次）。
- **会不会污染我 CLI dsh 的数据？** 不会。应用使用独立数据目录和独立 `$DSH_HOME`；3080 上正在运行的 CLI dsh 会被结束而非"采纳"。
- **首次启动发生了什么？** 离线种入内置 Baseline Runtime → 安装扩展 → 启动服务 → 加载 Harness 界面；侧边栏实时展示安装/服务日志。
- **提示找不到 Node.js？** 安装 Node.js v22.15+ / v23.8+ / v24+（Homebrew：`brew install node`，或 nvm）后重开应用。应用不下载 Node。
- **Runtime 更新怎么用？** 在侧边栏把"更新源 URL"设为通道 manifest（dev 通道示例：`https://raw.githubusercontent.com/tfcup/deepseek-harness-desktop/main/updater/channels/dev.json`），然后 检查 → 安装（SHA-256 校验）→ 需要时回滚。
- **怎么获取新版本应用？** 到 Releases 页面下载最新 DMG——未签名分发下桌面自动更新不可用。

## 安全声明

- 本项目仅用于个人学习、研究、测试；请勿用于商业用途
- `dsh` 是一个**具备本地代码执行能力的 agent**，请只在可信、隔离的环境中运行，不要从未知来源导入不受信任的配置/插件
- 开发者不对因使用本项目导致的任何数据丢失或安全问题负责

## 文档导航

- [设计文档](docs/deepseek-harness-desktop-macos-arm64-design.md) — 完整架构与决策
- [实现架构](docs/ARCHITECTURE.md) — 实现说明
- [执行计划](docs/EXECUTION-PLAN.md) — 分阶段计划与进度
- [插件 API 调研](docs/DSH-PLUGIN-API.md) — 官方扩展点研究
- [包契约](docs/PKG-CONTRACT.md) — 发布产物契约
- [通道提升](docs/PROMOTION.md) — 通道提升指南

## 相关项目

| 仓库 | 作用 |
| --- | --- |
| [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | 上游 `dsh`（CLI + Web UI + 插件架构） |
| [deepseek-harness-pkg](https://github.com/hairyf/deepseek-harness-pkg) | 预构建 Harness 包兜底源 |
| [n8n-desktop](https://github.com/tangtao646/n8n-desktop) | 参考实现（一键安装 + 本地运行 + 内嵌 Web 界面） |

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 上游项目
- [n8n-desktop](https://github.com/tangtao646/n8n-desktop) — 参考实现
- [Tauri](https://tauri.app/) — 桌面框架

## License

[MIT](./LICENSE) © deepseek-harness-desktop contributors
