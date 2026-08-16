# DeepSeek Harness Desktop（macOS ARM64）设计方案

> 目标：基于 `hairyf/deepseek-harness-desktop` 的思路，构建一个可长期维护、可自动跟进官方更新、可独立扩展、可直接分发给其他用户使用的 macOS Apple Silicon 桌面应用。

---

## 1. 项目目标

本项目最终需要满足以下三个核心目标：

1. **及时跟进官方 DeepSeek Harness 更新**
   - 自动检查 `@deepseek-ai/dsh` 新版本。
   - 自动构建新的 Harness Runtime。
   - 自动执行兼容性测试。
   - 通过验证后再推送给桌面端用户。
   - Harness Runtime 更新不要求重新下载安装 DMG。

2. **允许长期维护自己的功能与样式**
   - 不直接修改 DeepSeek Harness 官方源码。
   - 自定义 UI、主题、工具、扩展功能放在独立 Extension 层。
   - 通过 Adapter 层隔离 Harness API 变化。
   - 官方更新时不覆盖本项目自己的代码。
   - 上游出现 breaking change 时，尽可能只修改兼容层。

3. **可以直接发给其他人安装使用**
   - 只支持 macOS Apple Silicon / ARM64。
   - 用户无需安装 Node.js、pnpm、Rust 或其他开发工具。
   - 提供标准 `.dmg`。
   - Developer ID 签名。
   - Apple Notarization。
   - 支持 Desktop App 自身自动更新。
   - 支持 Harness Runtime 独立更新和失败回滚。

---

# 2. 核心设计原则

## 2.1 官方 Harness 永远视为上游内核

不要采用下面这种模式：

```text
DeepSeek Harness 官方源码
        ↓
直接修改 React / CSS / TS
        ↓
重新 build
        ↓
打进 DMG
```

这种方案初期简单，但长期维护成本会快速上升。

正确模式应为：

```text
Official DeepSeek Harness
        │
        │ 不修改
        ▼
Compatibility Adapter
        │
        ▼
My Extension Pack
        │
        ▼
Tauri Desktop Shell
```

原则：

> **Official DeepSeek Harness = NEVER MODIFY**

所有自定义功能尽量放在：

- Desktop Shell
- Harness Adapter
- DSH Client Plugin
- DSH Bundle / Plugin
- Theme / CSS Extension
- 自定义 Tool / Integration

中实现。

---

# 3. 总体系统架构

```text
                         ┌────────────────────────────┐
                         │ deepseek-ai/deepseek-harness│
                         │                            │
                         │ 官方上游                   │
                         └──────────────┬─────────────┘
                                        │
                                        │ npm / release
                                        ▼
                         ┌────────────────────────────┐
                         │ Runtime Builder            │
                         │                            │
                         │ 1. 检测官方新版本          │
                         │ 2. 固定版本                │
                         │ 3. 安装 Extension Pack     │
                         │ 4. 执行兼容性测试          │
                         │ 5. 构建 ARM64 Runtime      │
                         └──────────────┬─────────────┘
                                        │
                               验证通过后发布
                                        │
                                        ▼
                         ┌────────────────────────────┐
                         │ Runtime Release Channel    │
                         │                            │
                         │ dev / beta / stable        │
                         └──────────────┬─────────────┘
                                        │
                              Desktop Runtime Updater
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────┐
│                       Tauri Desktop App                            │
│                                                                    │
│  ┌───────────────────────┐       ┌──────────────────────────────┐ │
│  │ Desktop Shell         │       │ Runtime Manager              │ │
│  │                       │       │                              │ │
│  │ - macOS Window        │       │ - Node Runtime               │ │
│  │ - Menu                │       │ - Harness Runtime            │ │
│  │ - Settings            │       │ - Version Manager            │ │
│  │ - Shortcuts           │       │ - Download                   │ │
│  │ - Desktop Updater     │       │ - Verify                     │ │
│  └───────────┬───────────┘       │ - Rollback                   │ │
│              │                   └──────────────┬───────────────┘ │
│              │                                  │                 │
│              ▼                                  ▼                 │
│                         WKWebView                                   │
│                             │                                      │
│                             ▼                                      │
│                     http://127.0.0.1:PORT                          │
│                             │                                      │
│                             ▼                                      │
│                  Official Harness Runtime                          │
│                             +                                      │
│                    My Extension Pack                               │
└────────────────────────────────────────────────────────────────────┘
```

---

# 4. 四层架构

建议将项目明确拆分为四层。

## Layer 1 — Official DeepSeek Harness

职责：

- 官方 Harness Runtime
- 官方 Web UI
- 官方 Agent / Session / Tool 等基础能力

规则：

```text
NEVER MODIFY
```

不要直接：

- 修改官方 React 页面
- 修改官方 CSS 文件
- 修改 `node_modules/@deepseek-ai/*`
- 长期维护自己的 Harness fork

---

## Layer 2 — Compatibility Adapter

目录建议：

```text
packages/harness-adapter/
```

职责：

- 包装 Harness API。
- 统一处理不同 Harness 版本 API 差异。
- 避免业务代码直接依赖 Harness internal API。
- 提供统一接口给自定义 UI / Tool / Extension 使用。

例如业务代码不直接调用：

```ts
harness.internal.ui.registerSomething(...)
```

而统一调用：

```ts
adapter.ui.register(...)
```

以后 Harness API 改动时：

```text
官方 API 变化
      ↓
只修改 harness-adapter
      ↓
其他 Extension 尽量不动
```

这相当于系统设计中的 **Anti-Corruption Layer**。

---

## Layer 3 — My Extension Pack

目录建议：

```text
packages/
├── dsh-desktop-bundle/
├── dsh-theme/
├── dsh-ui/
├── dsh-tools/
└── dsh-integrations/
```

可以实现：

- Theme
- CSS
- Sidebar
- Toolbar
- Status Bar
- 自定义面板
- 自定义设置页面
- 自定义快捷操作
- 自定义工具
- 外部服务集成
- Agent 配置
- Plugin
- Bundle

原则：

> 优先使用 DeepSeek Harness 官方 Plugin / Bundle / Client Plugin 能力，而不是修改官方源码。

---

## Layer 4 — Tauri Desktop Shell

职责：

- macOS App 生命周期
- Tauri Window
- WKWebView
- 菜单栏
- 系统菜单
- 快捷键
- About
- Settings
- Harness Process Manager
- Runtime Manager
- Node Runtime Manager
- Desktop App Updater
- Runtime Updater
- Crash recovery

这一层应该尽可能与 Harness Web UI 解耦。

---

# 5. 推荐项目目录

建议采用 Monorepo，而不是维护多个零散仓库。

```text
deepseek-desktop/
│
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── shell/
│       │   ├── settings/
│       │   ├── updater/
│       │   ├── components/
│       │   └── bridge/
│       │
│       └── src-tauri/
│           ├── src/
│           │   ├── runtime/
│           │   ├── process/
│           │   ├── updater/
│           │   ├── node/
│           │   ├── health/
│           │   └── config/
│           │
│           ├── capabilities/
│           └── tauri.conf.json
│
├── packages/
│   ├── harness-adapter/
│   ├── dsh-desktop-bundle/
│   ├── dsh-theme/
│   ├── dsh-ui/
│   ├── dsh-tools/
│   └── dsh-integrations/
│
├── runtime/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── scripts/
│   │   ├── detect-upstream.ts
│   │   ├── build-runtime.ts
│   │   ├── verify-runtime.ts
│   │   └── publish-runtime.ts
│   │
│   └── tests/
│       ├── smoke/
│       ├── api/
│       └── compatibility/
│
├── updater/
│   ├── channels/
│   │   ├── stable.json
│   │   ├── beta.json
│   │   └── dev.json
│   └── schema/
│
├── tests/
│   ├── desktop/
│   ├── runtime/
│   ├── integration/
│   └── e2e/
│
├── scripts/
│
├── .github/
│   └── workflows/
│       ├── upstream-watch.yml
│       ├── runtime-build.yml
│       ├── runtime-promote.yml
│       ├── desktop-test.yml
│       └── desktop-release.yml
│
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

# 6. Harness Runtime 设计

## 6.1 Runtime 不应该绑定 Desktop App 版本

版本必须分开。

例如：

```text
Desktop App
1.2.3

DeepSeek Harness
0.1.0-rc.12

Extension Pack
1.4.2

Node Runtime
24.x
```

About 页面建议显示：

```text
DeepSeek Desktop
Version 1.2.3

DeepSeek Harness
0.1.0-rc.12

Extension Pack
1.4.2

Node.js
24.x
```

这样 Harness 升级：

```text
rc.12
  ↓
rc.13
```

不需要重新发布：

```text
DeepSeekDesktop.dmg
```

---

# 7. Runtime Manifest

建议定义自己的 Runtime Manifest。

例如：

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "runtimeVersion": "2026.08.15.1",
  "harnessVersion": "0.1.0-rc.12",
  "extensionVersion": "1.4.2",
  "nodeVersion": "24.6.0",
  "platform": "darwin",
  "arch": "arm64",
  "url": "https://example.com/runtime-arm64.zip",
  "sha256": "...",
  "minimumDesktopVersion": "1.2.0",
  "publishedAt": "2026-08-15T10:00:00Z"
}
```

Desktop 不应该只比较 Harness Version。

应该比较整个：

```text
Runtime Version
```

因为一次 Runtime 发布可能同时包含：

- Harness 更新
- Extension 更新
- Node 更新
- Compatibility Fix

---

# 8. 官方 Harness 自动更新流程

建议采用：

> **Auto Detect + Auto Validate + Controlled Promotion**

而不是：

> **官方有新版 → 所有用户立即安装**

流程：

```text
DeepSeek 官方发布新版本
          │
          ▼
GitHub Action 检测
          │
          ▼
创建 Runtime Candidate
          │
          ▼
固定 Harness Version
          │
          ▼
安装 Extension Pack
          │
          ▼
构建 macOS ARM64 Runtime
          │
          ▼
执行 Compatibility Tests
          │
      ┌───┴────┐
      │        │
    FAIL      PASS
      │        │
      ▼        ▼
停止发布      dev
               │
               ▼
              beta
               │
               ▼
             stable
```

---

# 9. Runtime Channel

建议至少包含三种 Channel：

```text
dev
beta
stable
```

## dev

用途：

- 自动构建。
- 第一时间跟进官方更新。
- 可以接受不稳定。
- 主要给 CI 和开发环境使用。

## beta

用途：

- 自动测试已经通过。
- 给自己日常使用。
- 提前观察官方变化。

## stable

用途：

- 普通用户。
- 只发布确认兼容的 Runtime。
- Desktop 默认 Channel。

推荐规则：

```text
官方发布
   ↓
dev
   ↓
自动测试通过
   ↓
beta
   ↓
人工确认 / soak test
   ↓
stable
```

---

# 10. GitHub Actions：上游检查

建议：

```text
.github/workflows/upstream-watch.yml
```

职责：

```text
每小时
  ↓
npm view @deepseek-ai/dsh version
  ↓
读取当前 known version
  ↓
比较
  ↓
如果有新版
  ↓
触发 runtime-build
```

示例策略：

```yaml
schedule:
  - cron: "17 * * * *"
```

没有必要每几分钟检查一次。

每小时一次已经足够及时。

---

# 11. Runtime Build Pipeline

建议：

```text
runtime-build.yml
```

执行：

```text
Checkout
   ↓
Setup Node
   ↓
Setup pnpm
   ↓
锁定 @deepseek-ai/dsh 版本
   ↓
pnpm install --frozen-lockfile
   ↓
安装 My Extension Pack
   ↓
构建 Runtime
   ↓
Smoke Test
   ↓
API Compatibility Test
   ↓
UI / Client Plugin Test
   ↓
启动 Harness
   ↓
Health Check
   ↓
生成 ZIP
   ↓
计算 SHA256
   ↓
生成 Manifest
   ↓
发布 Candidate
```

---

# 12. Compatibility Gate

由于 DeepSeek Harness 仍处于快速发展阶段，必须在自动更新链路中增加 Compatibility Gate。

至少测试：

## Runtime 启动测试

```text
Harness process starts
```

## Health Check

例如：

```text
GET http://127.0.0.1:<port>/
```

返回正常状态。

## Plugin Load Test

检查：

```text
My Extension Pack
```

是否成功加载。

## Client Plugin Test

检查：

- 页面可以打开。
- 自定义 UI 存在。
- 必要 Slot 注册成功。
- CSS 生效。
- Console 无严重异常。

## Basic Workflow Test

至少覆盖：

```text
启动
创建 Session
发送消息
收到响应
切换页面
关闭
重新启动
```

---

# 13. Runtime 更新机制

Desktop 每次启动：

```text
启动 App
   ↓
读取 local runtime manifest
   ↓
请求 stable.json
   ↓
比较 Runtime Version
   ↓
如果相同
   │
   └── 正常启动
   ↓
如果有新版
   ↓
下载 ZIP
   ↓
验证 SHA256
   ↓
解压到 staging
   ↓
启动新 Runtime
   ↓
Health Check
   ↓
成功 → 激活
失败 → 回滚
```

---

# 14. Runtime 回滚设计

目录建议：

```text
~/Library/Application Support/<AppName>/
│
├── runtime/
│   ├── versions/
│   │   ├── 2026.08.15.1/
│   │   └── 2026.08.16.1/
│   │
│   ├── current.json
│   └── previous.json
│
├── node/
│
├── data/
├── logs/
└── config/
```

更新成功：

```text
old current
   ↓
previous

new runtime
   ↓
current
```

更新失败：

```text
new runtime
   ↓
disable / remove

previous
   ↓
restore current
```

用户应看到类似：

```text
Harness Runtime 更新失败。
已自动恢复到上一版本。
```

而不是 App 无法启动。

---

# 15. Node Runtime 策略（修订版）

> 2026-08 修订：**直接使用用户本机安装的 Node.js**；不下载、不内置；
> 本机缺失或不兼容时**直接报错**（不联网下载、不静默跳过）。

查找范围：

```text
PATH（含 nvm 等） → /opt/homebrew/bin → /usr/local/bin
```

版本要求：v22.15+ / v23.8+（v24+ 亦可），不满足或缺失时给出明确报错：

```text
未找到 Node.js：请先安装 Node.js v22.15+ / v23.8+（https://nodejs.org）
Node.js 版本不兼容：当前 X.Y.Z，需要 v22.15+ / v23.8+
```

说明：

- 用户需自行安装 Node.js（这是分发的前置要求，README 明示）；
- 不做"本机没有就联网下载"的兜底——找不到直接报错，保持简单与可预期；
- 早期版本曾内置 Managed Node（本节原案），后按分发诉求改为本机 Node；
- Runtime Manifest 的 `nodeVersion` 记录**本机实际 Node 版本**（读取失败时回退支持基线 v22.22.0）。

例如：

```text
Desktop 1.2.3
Node（本机）24.6
Harness rc.12
Extension Pack 1.4.2
```

---

# 16. UI / 样式定制策略

自定义样式不要修改官方 Web UI 文件。

建议：

```text
packages/dsh-theme/
```

负责：

```text
Theme
Typography
Spacing
Colors
Layout tweaks
CSS
UI tokens
```

自定义功能：

```text
packages/dsh-ui/
```

负责：

```text
Sidebar
Toolbar
Panel
Status UI
Settings
Quick Actions
Command UI
```

如果 Harness 提供 Client Plugin / Slot API，应优先使用正式扩展接口。

---

# 17. 如何避免官方升级破坏自己的修改

无法保证上游 breaking change 永远不影响插件。

但可以保证：

> **官方更新不会直接覆盖自己的源码。**

并将影响范围限制到尽量小。

架构：

```text
My Theme ───────────────┐
My UI ──────────────────┤
My Tools ───────────────┤
My Integration ─────────┤
                        ▼
                Harness Adapter
                        │
                        ▼
                DeepSeek Harness
```

如果官方 API 从：

```ts
ui.registerSlot(...)
```

变成：

```ts
ui.slots.register(...)
```

理想情况下只修改：

```text
packages/harness-adapter/
```

而不是修改所有 Extension。

---

# 18. Desktop App 更新

Runtime 更新和 Desktop App 更新必须分离。

## Runtime Update

更新：

```text
Harness
Extension Pack
Node Runtime
Runtime Fix
```

不需要重新安装 App。

## Desktop Update

更新：

```text
Tauri
Rust Shell
Window Behavior
Menu
Native Features
Updater
Settings UI
Desktop Bug Fix
```

建议使用：

```text
Tauri Updater
```

---

# 19. 双更新体系

最终：

```text
              Update Manager
                    │
          ┌─────────┴─────────┐
          │                   │
          ▼                   ▼
Desktop Update          Runtime Update
          │                   │
          ▼                   ▼
Tauri Updater          Runtime Manager
          │                   │
          ▼                   ▼
App 1.2.3              Runtime 25
   ↓                        ↓
App 1.2.4              Runtime 26
```

两个版本独立管理。

---

# 20. DMG 分发策略

最终产物：

```text
DeepSeekDesktop_1.2.3_arm64.dmg
```

目标用户体验：

```text
下载
  ↓
打开 DMG
  ↓
拖到 Applications
  ↓
打开
  ↓
直接使用
```

用户不应该需要（§15 修订后，唯一例外：**需本机已安装 Node.js v22.15+ / v23.8+**）：

```bash
# 不需要
npm install
pnpm install
cargo install
xattr -dr ...

# 需要（前置要求，缺失启动即报错）
brew install node   # 或官网安装 Node.js v22.15+ / v23.8+
```

---

# 21. Apple 签名与 Notarization

如果需要发给其他人正式使用，应配置：

```text
Apple Developer ID Application
+
codesign
+
Apple Notarization
+
staple
```

GitHub Actions：

```text
git tag v1.2.3
        ↓
GitHub Actions
        ↓
build aarch64-apple-darwin
        ↓
codesign
        ↓
notarize
        ↓
staple
        ↓
generate DMG
        ↓
GitHub Release
```

---

# 22. ARM64 Only

本项目只面向 Apple Silicon：

```text
aarch64-apple-darwin
```

不处理：

```text
x86_64-apple-darwin
Windows
Linux
```

优点：

- CI 更简单。
- Runtime 只有一种架构。
- Node 只维护 darwin-arm64。
- DMG 只有一种。
- 测试矩阵明显缩小。
- 发布链路更容易维护。

---

# 23. DMG 内容策略

有两种可选方案。

## 方案 A：小 DMG + 首次启动下载 Runtime

```text
DMG
 │
 └── Desktop Shell

第一次启动
    ↓
下载 Node
    ↓
下载 Harness Runtime
```

优点：

- DMG 小。
- Runtime 始终最新。

缺点：

- 首次启动依赖网络。
- 首次体验较慢。
- 下载失败会影响第一次使用。

---

## 方案 B：DMG 内置 Baseline Runtime

推荐正式分发采用该方案。

```text
DMG
├── Desktop App
└── Baseline Harness Runtime
（Node 不内置——使用用户本机 Node，§15 修订版）
```

安装后：

```text
立即可以启动（需本机已装 Node.js，缺失会提示报错）
        ↓
后台检查新的 stable runtime
        ↓
有新版再更新
```

优点：

- 开箱即用（Harness Runtime 离线内置）。
- 离线情况下也能第一次启动（Node 已在本机）。
- 更符合普通 macOS App 的体验。

代价：

- DMG 体积较大（含 Baseline Runtime ~60MB）。
- 用户需自备 Node.js（v22.15+ / v23.8+）。

对于“发给别人直接用”的需求，推荐方案 B（并明示 Node.js 前置要求）。

---

# 24. 本地数据与 Runtime 必须分离

不要把用户数据存进 Runtime 目录。

推荐：

```text
~/Library/Application Support/<AppName>/
│
├── runtime/
├── config/
├── workspace/
├── sessions/
├── cache/
└── logs/
```

> （§15 修订：不再由 App 管理 `node/` 目录——Node 直接使用本机安装。）

Runtime 更新时只替换：

```text
runtime/
```

不动：

```text
workspace/
sessions/
config/
```

确保升级、回滚不会影响用户数据。

---

# 25. Release Model

建议版本体系：

```text
Desktop Version
1.2.3

Runtime Version
2026.08.15.1

Harness Version
0.1.0-rc.12

Extension Version
1.4.2

Node Version
24.6.0
```

Runtime Version 不要完全等同 Harness Version。

因为 Runtime 是一个完整发行单元：

```text
Harness
+
Node
+
Extension
+
Compatibility Fix
```

---

# 26. Release Channel 示例

### stable.json

```json
{
  "runtimeVersion": "2026.08.15.1",
  "channel": "stable",
  "harnessVersion": "0.1.0-rc.12",
  "extensionVersion": "1.4.2",
  "nodeVersion": "24.6.0",
  "arch": "arm64",
  "url": "...",
  "sha256": "...",
  "minimumDesktopVersion": "1.2.0"
}
```

### beta.json

可能已经指向：

```text
Harness rc.13
```

而 stable 仍然保持：

```text
Harness rc.12
```

这样自己可以提前测试，不影响其他用户。

---

# 27. 推荐开发阶段

## Phase 1 — 基础 Desktop

目标：

```text
Tauri App
   ↓
启动本地 Harness
   ↓
WKWebView 加载
```

完成：

- macOS ARM64 build
- Node Manager
- Process Manager
- Health Check
- WebView
- Local DSH_HOME

---

## Phase 2 — Runtime Manager

完成：

- Runtime Manifest
- Runtime 下载
- SHA256
- Version Manager
- Staging
- Atomic Switch
- Previous Runtime
- Rollback

---

## Phase 3 — Extension Layer

完成：

- harness-adapter
- dsh-desktop-bundle
- dsh-theme
- dsh-ui
- 自定义功能

目标：

```text
不修改官方 Harness 源码
```

---

## Phase 4 — CI / Automatic Runtime Build

完成：

```text
upstream-watch
runtime-build
runtime-test
runtime-promote
```

---

## Phase 5 — Desktop Update

接入：

```text
Tauri Updater
```

实现：

```text
Desktop 自动检查新版本
```

---

## Phase 6 — Distribution

完成：

```text
Apple Developer ID
codesign
notarization
staple
DMG
GitHub Releases
```

---

# 28. 推荐保留与修改 hairyf 项目的部分

## 建议保留

```text
Tauri 2
WKWebView
本地 Harness Server
Rust Process Manager
独立 DSH_HOME
Runtime 下载
Harness 生命周期管理
Health Check
SHA256 校验
GitHub Actions
```

---

## 建议调整

### 当前思路

```text
系统 Node 可用就复用
```

改为（2026-08 修订）：

```text
直接使用本机 Node（PATH / Homebrew / nvm 均可），缺失或不兼容直接报错
```

> 不做"本机没有就联网下载"，也不内置 Managed Node——详见 §15 修订版。

---

### 当前思路

```text
Harness 上游更新
  ↓
直接生成最新 Runtime
```

改为：

```text
Harness 更新
  ↓
Candidate
  ↓
Compatibility Gate
  ↓
dev
  ↓
beta
  ↓
stable
```

---

### 增加

```text
Runtime Rollback
```

---

### 增加

```text
Extension Pack Version
```

---

### 增加

```text
Compatibility Adapter
```

---

### 增加

```text
Tauri Desktop Updater
```

---

### 删除不需要的平台

```text
Windows
Linux
Intel Mac
```

只保留：

```text
macOS ARM64
```

---

# 29. 最终维护体验

理想情况下，DeepSeek 官方发布新版后：

```text
DeepSeek 发布新版
        ↓
GitHub Action 自动发现
        ↓
构建新 Runtime
        ↓
安装自己的 Extension
        ↓
运行 compatibility tests
        ↓
失败
  └────→ 不发布

通过
        ↓
进入 dev
        ↓
进入 beta
        ↓
确认稳定
        ↓
Promote stable
        ↓
Desktop 自动发现
        ↓
用户更新 Runtime
```

整个过程中：

```text
官方 Harness Repo
```

无需 merge 到自己的 repo。

---

# 30. 自己开发新功能时的体验

例如修改主题：

```text
packages/dsh-theme
        ↓
开发
        ↓
测试
        ↓
Extension Pack 1.4.3
        ↓
Runtime Build
        ↓
发布
```

不需要：

```text
fork DeepSeek Harness
```

也不需要：

```text
merge upstream
```

---

# 31. 最终推荐架构

```text
┌─────────────────────────────────────┐
│ Layer 4                             │
│ Tauri Desktop Shell                 │
│                                     │
│ macOS / updater / menu / runtime    │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│ Layer 3                             │
│ My Extension Pack                   │
│                                     │
│ theme / UI / tools / integrations   │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│ Layer 2                             │
│ Compatibility Adapter               │
│                                     │
│ isolate Harness API changes         │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│ Layer 1                             │
│ Official DeepSeek Harness           │
│                                     │
│ NEVER MODIFY                        │
└─────────────────────────────────────┘
```

---

# 32. 最终结论

基于当前需求，推荐采用：

> **Tauri Desktop Shell + Managed Node + Managed Harness Runtime + Extension Pack + Compatibility Adapter + Runtime Channels + Compatibility Gate + Rollback + Tauri Updater**

而不是简单地：

> fork `hairyf/deepseek-harness-desktop` 后直接修改 UI。

`hairyf/deepseek-harness-desktop` 非常适合作为基础参考项目，其最值得保留的设计是：

- Tauri 2
- WKWebView
- Harness 作为本地进程运行
- Runtime 与 Desktop 分离
- Harness 生命周期管理
- Runtime 下载与校验

在此基础上增加：

- Managed Node
- Runtime Manifest
- Compatibility Adapter
- Extension Pack
- stable / beta / dev Channel
- Compatibility Gate
- Rollback
- Desktop Updater
- Apple Code Signing / Notarization

即可形成一套真正适合长期维护和公开分发的 DeepSeek Harness macOS Desktop 架构。

---

## 下一步建议

下一阶段可以直接进入工程落地，依次完成：

1. 创建 Monorepo。
2. 从 `hairyf/deepseek-harness-desktop` 提取 Tauri Desktop 核心。
3. 精简为 macOS ARM64 only。
4. 建立 Managed Node。
5. 实现 Runtime Manager。
6. 设计 Runtime Manifest。
7. 建立 `harness-adapter`。
8. 建立第一个 `dsh-theme` Client Plugin。
9. 建立 Runtime CI。
10. 完成 DMG、签名和 Notarization。
11. 接入 Tauri Desktop Updater。
12. 建立完整 Release Channel。

完成这些后，项目就具备长期独立维护的基础。
