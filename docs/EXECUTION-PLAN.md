# DeepSeek Harness Desktop（macOS ARM64）执行方案

> 依据 `deepseek-harness-desktop-macos-arm64-design.md` 设计文档，结合当前仓库（v0.1.11）实际代码盘点后整理。
> 原则：渐进式演进，最大化复用现有代码；官方 Harness 永远视为上游内核（NEVER MODIFY）。

---

## 0. 现状盘点与差距分析

### 可直接复用的现有能力

| 能力 | 现有实现 | 说明 |
|---|---|---|
| Tauri 2 桌面壳 + WKWebView | `src-tauri/`、`src/` | React 前端 + Rust 后端 |
| 本地 Harness 进程管理 | `src-tauri/src/service/workflow/` | 启动/停止/重启 dsh |
| 健康检查轮询 | `src-tauri/src/task/tick_check_dsh_process/` | 就绪后 iframe 加载 |
| Node 自动下载 | `src-tauri/src/service/download/` | 带进度解压，写入 `app-data/runtime` |
| Harness 发行版下载 + SHA256 | `docs/PKG-CONTRACT.md` digest 契约 | 下载前校验，哈希一致跳过 |
| 隔离 DSH_HOME | `<app-data>/data/dsh` | 已满足"用户数据与 Runtime 分离" |
| 设置 / i18n / 主题注入雏形 | `config/setting.rs`、`i18n/`、`useDshTheme` | 后续扩展 |

### 需要新建/改造的缺口

| 缺口 | 目标（设计文档章节） |
|---|---|
| Runtime 与 Desktop 版本解耦 | §6 / §7 Runtime Manifest |
| 多版本管理 / 原子切换 / 回滚 | §13 / §14 |
| Node 策略（使用本机 Node，缺失即报错，§15 修订版） | §15 |
| Extension 四件套（adapter/theme/ui/tools） | §5 / §16 / §17 |
| Runtime 自动构建 CI + Compatibility Gate | §8 / §10 / §11 / §12 |
| 发布通道 dev / beta / stable | §9 / §26 |
| Desktop 自动更新（双更新体系） | §18 / §19 |
| 签名 / 公证 / DMG 分发 | §20 / §21 / §23 |
| 平台裁剪为 darwin-arm64 only | §22 |

---

## 1. 总体策略：渐进式演进（推荐）

**不做**一次性大重构。当前单仓代码复用度高，按以下顺序在**同一仓库**内增量演进：

1. 先收敛基线（平台裁剪、目录规范、版本解耦）；
2. 再补 Runtime Manager（核心能力）；
3. 引入 pnpm workspace 支撑 Extension 层；
4. 最后上 CI 与分发链路。

> 若后期 packages 共享需求明确变大，再切 Monorepo 也只是把现有目录平移到 `apps/` + `packages/`，成本可控。

---

## 2. 分阶段执行方案

### Phase 0 — 基线收敛（预计 0.5–1 周）

**目标**：锁定 macOS ARM64 单一平台；建立设计文档规定的数据目录与版本语义；为后续各层打地基。

任务：

1. **平台裁剪为 darwin-arm64 only**
   - 删除 `src-tauri/src/service/workflow/win_spawn.rs` 及 Windows 分支逻辑；
   - 移除 `Cargo.toml` 中 `[target.'cfg(windows)'.dependencies]`；
   - 精简 `config/constants.rs` 的多平台路径分支；
   - `tauri.conf.json` 的 `bundle.targets` 限定 `dmg`，去掉 ico/Windows 产物。
2. **数据目录规范对齐设计文档 §24**
   - `<app-data>/runtime/versions/<runtimeVersion>/`（多版本共存）
   - （§15 修订：Node 不内置、不下载，直接使用本机 Node）
   - `data/`、`logs/`、`config/` 保持现状。
3. **版本语义解耦（本地版 Manifest 先行）**
   - 定义 `RuntimeManifest` 结构（§7 字段全集：schemaVersion/channel/runtimeVersion/harnessVersion/extensionVersion/nodeVersion/platform/arch/url/sha256/minimumDesktopVersion）；
   - 写入 `<app-data>/config/runtime-manifest.json`，作为本地 current 版本依据；
   - About 页显示四版本：Desktop / Harness / Extension Pack / Node（§6）。
4. **决策记录**
   - Node 版本从硬编码常量（`NODE_VERSION = "v22.22.0"`）改为 manifest 声明，但本轮先保留常量，Phase 1 再下沉。

**验收标准（Done）**：
- 在 darwin-arm64 上 `pnpm tauri dev` 完整启动、iframe 正常加载；
- 代码中无 Windows/Linux 残留（`win_spawn` 移除、windows-sys 移除）；
- About 页展示分离的四版本。

---

### Phase 1 — Runtime Manager（设计文档 §13 / §14，预计 1–2 周）

**目标**：Runtime 可独立下载、多版本共存、原子切换、失败回滚；更新不依赖重新安装 DMG。

任务：

1. **新模块 `src-tauri/src/runtime/`**
   - `manifest.rs`：RuntimeManifest 结构 + JSON 序列化 + 版本比较；
   - `manager.rs`：`versions/<v>/` 目录管理、`current.json` / `previous.json`、staging 解压、原子切换（重命名/符号链接切换）；
   - `rollback.rs`：新版本 Health Check 失败 → 自动停用新版本、恢复 previous；
   - `download.rs`：复用现有 `service/download/`（进度 + sha256）。
2. **更新流程**（§13）：
   - App 启动 → 读本地 manifest → 请求 `stable.json` → 比较 runtimeVersion；
   - 有新版本 → 下载 ZIP → 校验 SHA256 → 解压 staging → 启动新 Runtime → Health Check → 成功激活 / 失败回滚；
   - 用户提示语："Harness Runtime 更新失败，已自动恢复到上一版本。"
3. **前端扩展**：设置页新增 Runtime 卡片（当前版本、检查更新、版本历史、回滚按钮）；新增 invoke 命令：
   - `get_runtime_info`（扩展现有）、`check_runtime_update`、`install_runtime`、`rollback_runtime`、`get_runtime_versions`。

**验收标准（Done）**：
- 本地可构造两个 runtime 版本目录，切换与回滚均为原子操作；
- 模拟坏版本：启动失败自动回滚且 App 不崩溃；
- 更新期间用户数据（`data/`、`sessions/`、`config/`）零改动。

---

### Phase 2 — Node 策略（本机 Node；原 Managed Node，已修订，预计 0.5 周）

任务：

1. Node 下载源固定 `nodejs.org` darwin-arm64 发行版，安装到 `<app-data>/node/`；
2. `nodeVersion` 由 Runtime Manifest 声明（跟随 Runtime 一起升级），App 按兼容矩阵（§15）校验；
3. 删除一切对系统 Node（`/usr/local/bin/node`、`/opt/homebrew/bin/node`、nvm）的依赖路径；
4. About 页 Node 版本读自 manifest。

**验收标准（Done）**：全新 Mac（无任何开发工具）上 Node 由 App 自行安装启动；卸载系统 Node 不影响应用。

---

### Phase 3 — Extension Layer（设计文档 §5 / §16 / §17，预计 2–4 周，依赖官方 API 调研）

**目标**：自定义主题/UI/工具全部通过官方插件机制加载，官方源码零修改；上游 API 变化只改 adapter。

任务：

1. **官方 API 调研（先行，0.5 周）**
   - 已确认官方包存在 `lib/plugin-*.js`，说明有插件机制；
   - 产出 `docs/DSH-PLUGIN-API.md`：梳理 bundle / client plugin / slot 注册、CSS 注入、UI 扩展点、事件订阅等可用接口；
   - 结论写入 adapter 接口设计，不直接依赖 internal API。
2. **引入 pnpm workspace + `packages/`**（设计文档 §5 目录规范）：
   - `packages/harness-adapter/`：Anti-Corruption Layer，统一暴露 `adapter.ui.register(...)` 等接口，屏蔽不同 Harness 版本差异；
   - `packages/dsh-theme/`：Theme / Typography / Spacing / Colors / CSS tokens（升级现有 `useDshTheme` 注入为正式插件）；
   - `packages/dsh-ui/`：Sidebar / Toolbar / Panel / Status UI / Settings / Quick Actions；
   - `packages/dsh-tools/` + `packages/dsh-integrations/`：自定义工具与外部服务集成；
   - `packages/dsh-desktop-bundle/`：聚合打包入口。
3. **加载链路**：Desktop Shell 启动 Harness 时注入 Extension Pack（与 Phase 1 的 runtime 构建配合，随 Runtime 分发或由 Desktop 注入）。

**验收标准（Done）**：
- `dsh-theme` 以插件形式加载并生效（自定义 CSS/主题可见）；
- 至少一个自定义 UI（如 Toolbar）注册成功；
- `git log` 证明官方源码零修改；
- 模拟一次官方 API 变更（在 adapter 内适配），所有 Extension 无需改动。

---

### Phase 4 — Runtime 构建与 CI 流水线（设计文档 §8 / §10 / §11 / §12，预计 2–3 周）

**目标**：官方发版 → 自动构建候选 Runtime → Compatibility Gate → dev → beta → stable。

任务：

1. **`runtime/` 工程**（§5 目录）
   - `runtime/package.json` + 独立 lockfile：固定 `@deepseek-ai/dsh` 版本、安装 Extension Pack；
   - `runtime/scripts/`：`detect-upstream.ts`（npm view 版本对比）、`build-runtime.ts`（构建 + 打 zip + sha256 + 生成 manifest）、`verify-runtime.ts`（本地验证）、`publish-runtime.ts`（发布到 channel）；
   - `runtime/tests/`：`smoke/`（启动 + health check）、`api/`（compatibility）、`ui/`（client plugin 加载、slot 注册、console 无严重异常）、`workflow/`（启动→建 Session→发消息→收响应→切页→重启）。
2. **`.github/workflows/`**（§10 / §11）：
   - `upstream-watch.yml`：cron 每小时 `npm view @deepseek-ai/dsh version`，有新版本触发 runtime-build；
   - `runtime-build.yml`：锁定版本 → frozen-lockfile 安装 → 装 Extension Pack → 构建 → smoke/api/ui/workflow 测试 → 通过后生成 zip + sha256 + manifest → 发布 dev candidate；
   - `runtime-promote.yml`：dev → beta（自动测试通过）→ stable（人工确认 / soak）；
   - `desktop-test.yml`、`desktop-release.yml`（Phase 6 使用）。
3. **`updater/channels/`**：`stable.json` / `beta.json` / `dev.json` 三通道 + JSON Schema（§9 / §26），URL 先指向 GitHub Releases。

**验收标准（Done）**：
- 官方发布新版本后，全链路自动产出候选 Runtime 并进入 dev channel；
- Compatibility Gate 任一环节失败 → 自动停止发布（不污染 beta/stable）；
- 本地可手动触发完整 pipeline 跑通。

---

### Phase 5 — Desktop 自动更新（设计文档 §18 / §19，预计 1 周，前置：签名能力）

任务：

1. 接入 `tauri-plugin-updater`（需先具备 Developer ID 签名/公证，否则更新包会被 Gatekeeper 拒绝）；
2. 实现 **Update Manager** 统一入口（§19 双更新体系）：
   - Desktop Update：Tauri Updater（更新 Tauri/Rust Shell/窗口/菜单/设置 UI）；
   - Runtime Update：Phase 1 的 Runtime Manager（更新 Harness/Extension/Node）；
   - 两套版本独立管理、互不覆盖；
3. 更新检查策略：启动时后台检查 + 设置页手动检查。

**验收标准（Done）**：发布 Desktop 1.2.4 后，1.2.3 用户收到更新并可升级，升级不触碰 runtime 与用户数据。

---

### Phase 6 — 分发与签名公证（设计文档 §20 / §21 / §23，预计 1–2 周，阻塞：Apple Developer 账号）

任务：

1. **签名与公证**：Developer ID Application 证书 → `codesign` → `notarytool` → `stapler`；
2. **DMG 内容采用方案 B**（§23，§15 修订版）：内置 Baseline Runtime（Desktop App + Baseline Harness Runtime；Node 不内置，使用本机 Node，缺失即报错），离线可首启，后台再检查新 stable runtime；
3. **产物命名**：`DeepSeekDesktop_<version>_arm64.dmg`；
4. **GitHub Releases 发布流**：`git tag vX.Y.Z` → Actions 构建 → codesign → notarize → staple → DMG → 上传 Release；
5. **网站/文档**：更新 `website/` 与 README，给出"下载 → 拖入 Applications → 直接使用"的用户路径。

**验收标准（Done）**：
- 全新 Apple Silicon Mac（无任何开发工具）安装 DMG 后开箱即用；
- `spctl -a -vv` 通过、公证凭证已 staple；
- 用户侧无 `xattr -dr`、无 `brew install node` 等操作。

---

## 3. 依赖与前置条件

| 项 | 何时需要 | 说明 |
|---|---|---|
| Apple Developer 账号（$99/年） | Phase 5–6 | **提前申请**；Phase 0–4 不依赖，可并行推进 |
| GitHub Secrets（证书 p12、APPLE_ID、APPLE_TEAM_ID、APP-SPECIFIC-PASSWORD、NOTARY 凭据） | Phase 4 发布 / Phase 6 | 申请账号后配置 |
| Runtime 产物静态托管 | Phase 1 联调 | 先用 GitHub Releases，后期可换自建 |
| 官方 dsh 插件 API 文档确认 | Phase 3 | 以本地 `lib/plugin-*.js` + 官方仓库源码为准 |

---

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| 官方 Harness API 快速演进（breaking change） | 只改 `harness-adapter`；Compatibility Gate 在 CI 拦截 |
| 官方插件机制未正式文档化 | Phase 3 先产出 `docs/DSH-PLUGIN-API.md` 调研报告再动手 |
| 签名/公证阻塞分发 | 账号提前申请；Phase 0–4 全部不依赖签名 |
| 首次启动依赖网络（方案 A 的缺点） | 采用方案 B：DMG 内置 Baseline Runtime |
| 大重构拖慢进度 | 渐进式演进，每一 Phase 独立可交付、可验收 |

---

## 5. 排期总览

| Phase | 内容 | 预计耗时 | 依赖 |
|---|---|---|---|
| 0 | 基线收敛（平台裁剪/目录/版本解耦） | 0.5–1 周 | 无 |
| 1 | Runtime Manager（下载/切换/回滚） | 1–2 周 | Phase 0 |
| 2 | Node 策略（本机 Node，缺失报错） | 0.5 周（可并行） | Phase 0 |
| 3 | Extension Layer（adapter/theme/ui/tools） | 2–4 周 | 官方 API 调研 |
| 4 | Runtime CI + Compatibility Gate + Channels | 2–3 周 | Phase 1/2/3 |
| 5 | Desktop 自动更新（双更新体系） | 1 周 | 签名能力 |
| 6 | 签名/公证/DMG/发布 | 1–2 周 | Apple 账号 |

## 进度

- [x] Phase 0：结构/平台/数据目录/Manifest 草案
- [x] Phase 1：Runtime Manager（版本化布局 + 安装/回滚 + 扩展装入）
- [x] Phase 2：Node 策略（原 Managed Node，2026-08 修订为：直接使用本机 Node，缺失/不兼容即报错，不下载不内置）
- [x] Phase 3：Extension Layer（adapter + dsh-theme/ui/tools/integrations + 聚合 + 全量验证）
- [x] Phase 4：runtime/ 构建流水线（build/verify/publish 本机跑通）+ channels/schema + 5 个 workflow
- [x] Phase 5：Desktop 自动更新（tauri-plugin-updater 接入 + 密钥/清单/发布链路 + 双更新 UI）
- [x] Phase 6（代码侧）：identifier 更名、Entitlements/签名配置、desktop-release 完整化（baseline+签名+公证+更新清单）、方案 B seed 逻辑
- [x] Phase 6（分发决策）：**无签名分发路径**（不申请 Apple 账号）——未签名 DMG + 首次右键打开/xattr 放行；README 安装说明已更新
- [x] 端口进程隔离：**无条件重建**——`start()` 发现端口 3080 上有任何 LISTEN 监听者（含外部 CLI dsh）即结束监听者再拉起自己的实例；`kill_port_holder` 改为 `lsof -sTCP:LISTEN` 精确匹配，仅杀监听者，绝不误杀仅持有普通连接（如浏览器）的无关进程；删除 PID 归属机制与 `pkill -9 node`（见 `src-tauri/src/process/mod.rs`）
- [ ]（可选，非目标）若日后需要 Gatekeeper 直装/桌面自动更新，再补 Apple 签名公证

---

## 6. 建议立即执行的三个动作（本周）

1. **启动 Phase 0**：平台裁剪 + 数据目录规范 + Runtime Manifest 草案（不依赖任何外部资源）；
2. **并行调研官方插件 API**：产出 `docs/DSH-PLUGIN-API.md`，为 Phase 3 定接口；
3. **申请 Apple Developer 账号**（若计划公开分发），消除 Phase 5/6 阻塞。

> 备注：当前 DSH 官方安装路径下已确认存在 `lib/plugin-*.js`，插件机制调研可立即开始，无需等待。
