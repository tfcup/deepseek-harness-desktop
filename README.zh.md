<p align="center">
  <a href="https://github.com/tfcup/deepseek-harness-desktop">
    <img src="public/favicon.svg" width="112" alt="DeepSeek Harness Desktop" />
  </a>
</p>

<h1 align="center">DeepSeek Harness 桌面版</h1>

<p align="center">
  <em>DeepSeek Harness 的一键式桌面应用 —— 无需安装 Node.js、无需 pnpm、无需 Docker，即可在本地运行完整的 agent 平台。</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.9-4D6BFE?style=flat-square" alt="version 0.1.9" />
  <img src="https://img.shields.io/github/v/release/tfcup/deepseek-harness-desktop?style=flat-square" alt="latest release" />
  <img src="https://img.shields.io/github/downloads/tfcup/deepseek-harness-desktop/total?style=flat-square" alt="downloads" />
  <img src="https://img.shields.io/github/stars/tfcup/deepseek-harness-desktop?style=flat-square" alt="GitHub stars" />
  <img src="https://img.shields.io/github/license/tfcup/deepseek-harness-desktop?style=flat-square" alt="MIT license" />
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/macOS%20ARM64-black?style=flat-square&logo=apple&logoColor=white" alt="Windows | macOS | Linux" />
</p>

<p align="center">
  <samp>
    <a href="./README.md">English</a> ·
    <strong>中文</strong>
  </samp>
</p>

> **状态：开发预览。** 上游 `dsh` 仍在快速迭代，存在破坏性变更；本项目同步跟随。

## 功能

- **一键安装** — 无需 Node.js / pnpm / Docker，内置 Harness 内核与 Node 运行时，首次启动全自动装配。
- **自愈更新** — 每次启动自动同步最新版本，发现新版时静默弹出「立即更新 / 稍后」提示。
- **轻量跨平台** — Tauri 2 外壳，安装包更小、内存占用更低；Windows / macOS / Linux 原生窗口，界面中英双语。
- **内嵌 Web 界面** — Harness 界面运行在窗口内，侧边栏提供服务状态、端口、日志、自启动、浏览器打开、数据目录与语言等控制。

> **为什么用 Tauri 而不是 Electron？** 相同功能下它更轻：更小的安装包、更低的内存占用、更跟手的原生窗口控制——对可能要常驻后台的本地 agent 尤为重要；内嵌的是系统 WebView2/WebKit 而非自带 Chromium，进一步缩小安装体积。

## 界面预览

![DeepSeek Harness Desktop](docs/preivew.png)

## 快速开始

1. 在 [Releases](https://github.com/tfcup/deepseek-harness-desktop/releases) 页面下载 `DeepseekDesktop_<版本>_arm64.dmg`；
2. 打开 DMG，把应用拖入 Applications；
3. **首次打开**：应用以**未签名**形式分发（未接入 Apple Developer 签名），macOS Gatekeeper 首次会拦截，任选其一放行：
   - **右键点击应用 → 打开 → 再点打开**（仅首次）；或
   - 终端执行一次：`xattr -dr com.apple.quarantine /Applications/Deepseek\ Harness\ Desktop.app`
4. 应用**离线开箱即用**（方案 B）：DMG 内置基线 Node.js 运行时与 Baseline Harness Runtime，首启自动种入，无需联网下载；就绪后内嵌 Harness 界面打开在 `http://127.0.0.1:3080`。

> 一切都在本地完成。**Runtime 更新**（Harness + Extension Pack）走内置 Runtime Manager，**不涉及 macOS 签名**，有新版时静默提示；**桌面端自动更新**依赖 Apple 签名，未签名分发下不可用，发布新版时手动下载 DMG 即可。

**系统要求**

- macOS 11+（仅 Apple Silicon / arm64）
- 无需任何开发工具（Node.js / Rust / pnpm 均不需要）

应用始终使用 **App 托管的 Node.js v22.22.0 LTS** 运行时（安装于应用数据目录，满足 Harness 的 **v22.15.0+ 或 v23.8.0+** 要求）。不依赖系统 Node.js / Homebrew / nvm，保证所有用户环境一致。

## 开发与构建

### 环境要求

- Node.js 20+
- Rust 1.77+
- pnpm 9+
- 平台编译工具链（Windows: MSVC + WebView2；macOS: Xcode CLT；Linux: WebKit2GTK）

### 本地开发

```bash
git clone https://github.com/tfcup/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
pnpm tauri dev
```

### 构建安装包

```bash
pnpm tauri build
```

### 重新生成图标

```bash
pnpm icons
```

## 工作原理

```text
┌──────────────────────────────────────────────┐
│ Tauri WebView (React)                        │
│   安装状态机 → 下载进度 → iframe              │
│   加载 dsh Web 界面 + 侧边栏控制              │
└──────────────────────┬───────────────────────┘
                       │ invoke 命令 + 事件
┌──────────────────────┴───────────────────────┐
│ Tauri Rust 后端                              │
│   service/download  安装器 + 解压             │
│   service/workflow  dsh 进程生命周期          │
│   task              dsh 健康检查              │
└──────┬───────────────────────────┬───────────┘
       │                           │
  runtime/ (Node.js v22.22.0)   dependencies/dsh/ (发行版)
       └─────────────┬─────────────┘
                     ▼
   dsh --profile web --host 127.0.0.1 --port 3080
                     │  DSH_HOME=<app-data>/data/dsh
                     ▼
        http://127.0.0.1:3080/  ← 内嵌界面
```

- Harness 发行版由 [deepseek-harness-pkg](https://github.com/hairyf/deepseek-harness-pkg) 构建并发布，发布契约见 [docs/PKG-CONTRACT.md](docs/PKG-CONTRACT.md)；
- 每次启动应用都会从 `deepseek-harness-pkg` 拉取最新 release commit，本地发行版过期时自动重新下载（GitHub 不可达时保留本地安装）。
- 完整架构说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 数据目录

数据目录由 Tauri 的 bundle identifier（`io.github.tfcup.deepseek-harness-desktop`）决定：

- macOS：`~/Library/Application Support/io.github.tfcup.deepseek-harness-desktop/`

包含：

- `node/`：App 托管的 Node.js 运行时
- `runtime/versions/<v>/`：版本化 Harness Runtime
- `data/dsh/`：Harness 用户数据（`$DSH_HOME`，含 profile、会话、设置）
- `logs/`：应用与 dsh 服务日志
- `.store.dat`：桌面端配置（端口、自启动、语言）

## 常见问题

- **3080 端口被占用？** 在侧边栏设置中修改端口并重启服务。
- **首次安装时发生了什么？** 侧边栏会实时展示安装日志与服务日志。
- **为什么首次启动要下载这么多内容？** 需要一次性下载 Node.js 运行时与 Harness 发行包（约几百 MB），之后即可离线运行。
- **为什么每次启动都会访问 GitHub？** 用于对比本地 Harness 发行版与最新 release commit，不一致时自动重新下载；GitHub 不可达时保留本地安装。
- **安装后如何更新？** 启动后跳过安装界面，后台静默检查新版并弹出「立即更新 / 稍后」提示；点击更新会重新下载发行版并重启服务。

## 安全声明

- 本项目仅用于个人学习、研究、测试；请勿用于商业用途
- `dsh` 是一个**具备本地代码执行能力的 agent**，请只在可信、隔离的环境中运行，不要从未知来源导入不受信任的配置/插件
- 开发者不对因使用本项目导致的任何数据丢失或安全问题负责

## 相关项目

| 仓库 | 作用 |
| --- | --- |
| [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | 上游 `dsh`（CLI + Web UI + 插件架构） |
| [deepseek-harness-pkg](https://github.com/hairyf/deepseek-harness-pkg) | 打包好的 Harness 发行版（桌面端下载源） |
| [n8n-desktop](https://github.com/tangtao646/n8n-desktop) | 参考实现（一键安装 + 本地运行 + 内嵌 Web 界面） |

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 上游项目
- [n8n-desktop](https://github.com/tangtao646/n8n-desktop) — 参考实现
- [Tauri](https://tauri.app/) — 桌面框架

## License

[MIT](./LICENSE) © deepseek-harness-desktop contributors
