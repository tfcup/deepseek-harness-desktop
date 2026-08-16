# DSH 官方扩展机制调研与 Layer 3 扩展包决策

> 调研对象：官方 `@deepseek-ai/dsh`（本地安装版 `0.1.0-rc.6`，2025-08-14 布局）与
> 官方仓库 `deepseek-ai/deepseek-harness`（master）。
> 原则：**NEVER MODIFY** —— 不修改官方包内任何文件；本文只回答"官方提供了哪些扩展机制、
> 分别怎么用、桌面端如何接入"。
> 所有路径均基于本机实际安装；行号/字段均来自对已安装产物与官方文档的核对，未确认项已显式标注。

---

## 1. 结论摘要（TL;DR）

dsh 不是"一个写死的 Web 应用"，而是一个**基于 Cordis v4 的可组合插件树**：整个 Web UI、
工具、模型适配器、设置、持久化全部是插件，通过**按层叠加的 patch 配置**组装。官方扩展机制
**真实存在且足够完整**，Layer 3 扩展包可以全部走官方机制，无需修改官方源码：

| 需求 | 官方机制（可用性） | 结论 |
|---|---|---|
| 主题 / CSS tokens | `ctx.theme.register / overrideTokens`（**完全官方**，`--dsw-alias-*` token 体系）+ Client Plugin 工厂内注入任意 CSS（官方加载路径） | **推荐**，`dsh-theme` 应做成 Client Plugin |
| 自定义 UI（侧边栏/面板/设置页/工具卡片） | Slot 注册表 `ctx.slots.register(...)`（**完全官方**，声明式 slot 扩展点） | **推荐**，`dsh-ui` 应做成 Client Plugin |
| 自定义工具 | Host 侧 `ctx.tools.register(ToolDefinition)`（**完全官方**） | **推荐**，`dsh-tools` 应做成 Host Bundle |
| 分发/聚合 | Bundle 包（`dsh.bundle.patch`）+ profile 层 `cordis.patch.yml`（**完全官方**） | **推荐**，`dsh-desktop-bundle` 聚合 |
| 外部集成 | 任意 Host 插件 + `harness.handle`/`host.call` RPC seam（官方） | 可行，`dsh-integrations` 做成 Host Bundle |
| 兜底：任意 CSS/JS 注入 | Host 插件注册 `webServer.tapIndex(...)` index 变换（官方宿主 seam，主题 bootstrap 与 `__DSH_BOOT__` 注入都走它） | 兜底方案，一般不必要 |

**关键事实**：官方 Web UI 的**每一行**（`ui-theme`、`ui-sidebar`、`ui-conversation`、`ui-tool`、
`webserver`、`web-runtime`……）都是 `dsh-web-app` bundle 的 `cordis.patch.yml` 里可被
`id` 寻址、可被上层 patch **替换 config / 禁用 / 追加 insert** 的条目。`dsh --profile web --dump-config`
打印的整棵配置树"任何条目都可以由你自己的 patch 替换"（官方架构文档原话）。

**推荐架构一句话**：Extension Pack = 一组 npm 包（`dsh-theme`/`dsh-ui` 为 Client Plugin，
`dsh-tools`/`dsh-integrations` 为 Host Bundle，`dsh-desktop-bundle` 为聚合 Bundle），随 Runtime
构建安装进 `$DSH_HOME/profiles/web`，`harness-adapter` 只包装"写 patch 文件 / 读 settings.yaml /
管理 bundle 安装"这几个稳定接口。

---

## 2. 官方扩展机制清单

### 2.0 背景：dsh 是什么（启动链）

桌面端启动命令 `node .../lib/bin.js --profile web --host 127.0.0.1 --port 3080` 的真实语义
（证据：`<dsh>/lib/bin.js`、`<dsh>/lib/profile-boot-*.js`）：

1. 启动器（bin.js）只解析自己的 flag：`--profile`、`--patch`（可重复）、`--dump-config`、
   `--dump-default-config`；**其余参数原样交给被启动的 profile**。
2. `--host/--port/--trusted-host` 属于 web 应用的 flag，由 `dsh-web-app/startup` 里的
   `web-startup` 插件解析并 `ctx.provide('webStartup', {...})`（证据：`dsh-web-app/lib/startup.js`；
   注意 `--host 0.0.0.0` 被官方**显式拒绝**，桌面端用 `127.0.0.1` 是正确的）。
3. profile boot 按顺序叠加 patch 层（证据：`lib/profile-boot-DG5t9aNs.js` 的 `composeProfile`）：
   - 空根 `[]`（`$DSH_HOME/profiles/<name>/cordis.yml`，每次启动重写）
   - bundle 层：`dsh.profile.bundles` 列表顺序
   - profile 用户层：`$DSH_HOME/profiles/<name>/cordis.patch.yml`
   - home 用户层：`$DSH_HOME/cordis.patch.yml`
   - `--patch <file>` overlay（可重复）
   - 遥测开关（`DSH_TELEMETRY_DISABLED` 非空即禁用）
4. profile 目录：`$DSH_HOME/profiles/<name>/`，内含 `package.json`（含 `dsh.profile.bundles`
   清单）、`cordis.patch.yml`、`pnpm-workspace.yaml`（`nodeLinker: hoisted`）。`web`/`headless`
   模板首次启动自动初始化（`web = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`）。

`$DSH_HOME` 解析优先级（证据：`dsh-home-paths/lib/index.js`）：显式配置 > `$DSH_HOME` > `~/.dsh`。
桌面端设 `DSH_HOME=<data>/dsh`，所以 web profile 落在 `<data>/dsh/profiles/web/`。

---

### 2.1 机制一：Bundle（组合包）—— 分发"配置 patch + 宿主代码"的官方格式

- **是什么**：一个 npm 包，manifest 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`；
  该 patch 文件是 Cordis 配置 patch（顶层 YAML 数组：按 `id` 替换 config、`insert` 插入条目、
  `disabled` 禁用、`!!js` 表达式）。包还可以带宿主侧代码（`main` 指向的插件），patch 里用
  `name` 引用它。
- **如何加载**：把包加入 profile 的 `dsh.profile.bundles` 列表，并保证包可从 profile 目录
  resolve（pnpm 安装进 profile `node_modules`，或放入 `$DSH_HOME/profiles/node_modules` 扁平
  回退目录——后者由官方 `healProfilesModuleFallback` 维护，Node 父目录上溯即可解析）。
  官方管理命令：`dsh plugin --profile web add <pkg>`（转调 pnpm，成功后按"是否声明
  `dsh.bundle`"自动 reconcile `dsh.profile.bundles`；手动改 manifest 也可以，`loadProfile`
  直接读取列表——`sameBundles` 规范化只针对 headless 模板元组，web profile 的列表原样保留，
  追加条目即"用户所有"，不会被官方改写）。
- **能力**：向配置树插入任意宿主插件行 / 客户端插件行；其内容可被其上的所有 patch 层再覆盖。
- **限制**：`dsh.profile.bundles` 里列出但未声明 `dsh.bundle` 的包会 fail loud（校验）；安装
  依赖 pnpm（CI/构建期可解决，见 §4）。
- **证据**：
  - 官方包 `dsh-web-app/package.json`：`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
  - 官方文档 `apps/cli/README.md`（README.zh.md 同）："组合包先从 dsh 安装目录解析……再从
    profile 自身的 `node_modules` 解析"
  - 官方 `docs/architecture.zh.md`："**组合包**是 Cordis 配置项及其挂载代码的分发格式……
    `dsh.bundle` 指向一个组合包的 patch 文件"
  - 第三方实例（npm registry 实测）：`dsh-plugin-langfuse@0.1.2` 同样声明
    `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 并 `exports["./cordis.patch.yml"]`
  - 本机：`dsh/lib/plugin-9h8shc4d.js`（reconcile 逻辑）、`dsh-app-boot/lib/index.js`
    （`PROFILE_TEMPLATES`、`loadProfile`、`healProfilesModuleFallback`）

### 2.2 机制二：cordis.patch.yml 用户 patch 层 —— 纯配置扩展（零新代码）

- **是什么**：profile 级 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 与 home 级
  `$DSH_HOME/cordis.patch.yml`，以及 `--patch` overlay。格式与 bundle patch 相同。
- **如何加载**：文件存在即被解析叠加（home 级高于 profile 级，`--patch` 最高）；两个用户
  patch 文件被 `watchUserPatches` **热监听**——运行中改文件即事务性重组合（HMR）。
- **能力**：
  - 按 `id` 替换某行的整个 `config`（整棵官方配置树任意一行）；
  - `disabled: true` 禁用某行（例如关闭 `ui-deliverables`、替换 `ui-tool`）；
  - `insert` 追加新行（引用已可解析的插件名）；
  - `!!js` 表达式（如 `process.env.X`、`dshHomePath('...')`、`ctx.<service>.field`）；
  - 只改配置、不改官方代码，是"零代码扩展"首选。
- **限制**：`insert` 引用的插件名必须可解析（见 2.1 的解析路径）；id 定位 patch 是**整体替换
  config 而非深合并**（官方明示：restate 保留字段）；空文件/纯注释文件会抛错，禁用用 `[]`。
- **证据**：`dsh-app-boot/README.md`（Profiles 节、`loadOptionalPatches`）、
  `lib/profile-boot-DG5t9aNs.js`（`composeProfile`、`watchUserPatches`）、
  `dsh-web-app/cordis.patch.yml` 本身就是"按 id 覆盖 dsh-base"的活教材（第 1-6 行注释）。

### 2.3 机制三：Client Plugin（浏览器侧插件，`dsh.client`）—— 自定义 UI / CSS 的官方通道

- **是什么**：双面 npm 包。manifest 声明 `"dsh": { "client": { "inject": [...], "platform": "web",
  "immediately": true } }`，且 `exports["./client"]` 指向**构建后的浏览器 bundle**；
  `main`/`exports["."]` 指向宿主（node）半身。
- **如何加载**（完整链路，证据：`dsh-client-modules/README.md` 与 `lib/*`）：
  1. 组合树里存在该包的宿主行（`dsh.client` 包）→ node 半身扫描启用条目，解析
     `exports["./client"]`，把 bundle 内容哈希进引导图；
  2. index.html 被注入 `window.__DSH_BOOT__`（`{rev, entries:[{id,url,rev,inject,immediately}]}`），
     由 `webServer.tapIndex` 变换完成（证据：`dsh-client-modules/lib/index.js:163`）；
  3. bundle 经 `/plugins/<id>/client.js?rev=<rev>` 提供（同文件 321-323 行）；
  4. 浏览器端执行 bundle 只**注册工厂**（`window.__ModuleLoader__.load({id, factory})`），
     **工厂物化时才执行全部副作用——包括 CSS 注入**（`<style data-plugin>` 标签，记录在
     `data-plugin-css`）；`import` 时按需物化。
- **能力**：React 组件注册进 slot（见 2.4）；工厂闭包内注入 CSS；`ctx.get('slots')`、
  `ctx.theme`、`ctx.remote`、`host.call` 等客户端服务。
- **限制**：bundle 必须是构建产物（tsdown，`DSH_BUILD_FACE=client`）；值导入（跨插件共享代码）
  必须走 `exports` 子路径（如 `dsh-client-runtime/client`），否则会内联第二份实例；客户端无
  `loader.unload` 全链（官方已知限制）。
- **证据**：`dsh-client-ui-theme/package.json`（`dsh.client` 声明 + `exports["./client"]`）、
  `dsh-client-modules/lib/types/client/manifest.d.ts`（`WebBootGraph`/`DshWindow`）、
  `dsh-web-app/cordis.patch.yml` 147-152 行（"浏览器插件名册（dsh.client rows）"）、
  `docs/development.zh.md`（Host/Client 双 aggregate、`DSH_BUILD_FACE`）。

### 2.4 机制四：Slot 注册表（`ctx.slots`）—— 官方 UI 扩展点

- **是什么**：浏览器侧声明式 UI 组合 API（`dsh-client-ui-slots` 纯核心 +
  `dsh-client-runtime` 运行时）。一次 `slots.register({ name, key?, children?, store?, inject?, ...kind }, Component)`
  把组件挂进**已声明**的 slot；`slots.inject('slot.name', cb)` 等待声明存在再注册。
- **能力**：向官方预留的 slot 注入 UI。官方技能文档（`config/agent-presets/cordis/skills/
  cordis-plugin-development/SKILL.md`）点名的 slot 示例：
  - `settings.section` / `settings.general.item` / `settings.plugins.tab` / `settings.plugin.item`
    —— 设置页（`ui-settings-plugins` 的 README 确认 `settings.plugins.tab` 为根 list slot，
    每个带浏览器半身的插件往 `settings.plugin.item` 注册自己的卡片）；
  - `sidebar.footer.action` —— 侧边栏小动作（"不要替换整个 sidebar"）；
  - `conversation.chat.turnTail` —— 回合尾部补充内容；
  - `shell.overlay` —— 全局 overlay / 通知；
  - `tool.call.toolview` —— 工具调用卡片（key = tool 名；可替换产品默认卡片）；
  - `tool.view.cordis` —— cordis_run 结果卡专用面板；
  - `root` —— 内置根 slot。
  注册协议分 `single / list / keyed / chain` 四类；session 级 slot 的 props 自带
  `useSession/useSessions/useWorkspaces/useProjection` 等标准工具包。
- **限制**：不能注册进**未声明**的 slot（会抛错）；覆盖整个区域会连带移除其声明的子 slot
  （官方警告不要默认替换 `root/sidebar/conversation/details` 整区）；props 是只读数据，不要
  JSON.stringify / 递归复制（官方明确禁止处理内部活数据）。
- **证据**：`dsh-client-ui-slots/README.md`（zh 同）、`dsh-client-runtime/README.md`
  （"Slot declaration injection"节）、SKILL.md（"Register Client UI"节）、
  `dsh-client-ui-settings-plugins/README.md`。

### 2.5 机制五：主题系统（`ctx.theme` / `ThemeRuntime`）—— 官方主题扩展

- **是什么**：`dsh-client-ui-theme` 提供 `ThemeRuntime`（client 服务键 `ctx.theme`）：
  - `ctx.theme.register({ id, colorScheme: 'light'|'dark', tokens: Record<string,string> })`
    —— 注册第三方主题（tokens = `--dsw-alias-*` 别名变量覆盖）；重复 id 抛错；返回 disposer；
  - `ctx.theme.overrideTokens(source, tokens)` —— 在激活主题之上叠加 token 层（每 token 需
    `{ light, dark }` 双值，验证严格）；返回 disposer；
  - `ctx.theme.setTheme(id)` / `getTheme()` / `theme/change` 事件。
- **能力**：官方明示"Third-party themes are an extension point"（第三方主题是扩展点）。
  token 体系：静态色阶 `--dsw-static-*` → 语义别名 `--dsw-alias-*`（5 张样式表：
  `base.css / design-platform.css / scrollbar.css / gradient-shadow-text.css / shiki.css`，
  由 shell 的 `base.css` 引入）。
- **限制**：第三方主题只能覆盖**别名层 token**（无完备性校验，覆盖不全会掉 token）；token 表是
  唯一颜色权威（不追加设计稿外的色值）；主题服务不改 DOM（DOM 呈现归 `ui-layout`）；**不能**用
  `document.body`/硬编码 DOM 选择器去改（官方禁止）。
- **持久化**：偏好经 Host settings API 存 `$DSH_HOME/settings.yaml` 的
  `ui-theme: { preference: light|dark|system }` 命名空间（常量 `THEME_SETTINGS_NAMESPACE="ui-theme"`、
  `THEME_PREFERENCE_FIELD="preference"`）；远程浏览器无特权设置 API，仅进程内有效。
  此外宿主侧还有一个 **index 变换**：`webServer.tapIndex(html => injectBootTheme(html, preference))`
  在 `<body>` 后注入预插件主题引导（证据：`dsh-client-ui-theme/lib/index.js:76`）。
- **证据**：`dsh-client-ui-theme/lib/types/client/index.d.ts`（完整 API + ThemeDefinition）、
  `README.md`（"Third-party themes are an extension point"）、`lib/types/theme-settings.d.ts`、
  `lib/types/boot-theme.d.ts`、`docs/web-styling.zh.md`（职责归属：ui-theme 拥有全局样式表）。

### 2.6 机制六：工具注册（`ctx.tools`）—— 自定义工具官方 API

- **是什么**：Host 侧 `ctx.tools.register(ToolDefinition)`（全局或当前 agent 作用域注册；
  作用域工具遮蔽全局；返回 disposer，随 fiber 卸载自动撤销）。`defineTool` 是第一方类型化辅助，
  `ctx.tools.register` 直接接受原始 JSON Schema `ToolDefinition`（MCP 来源工具即此路径）。
- **配套扩展点**：`tools/pre-execute`（waterfall 门禁）、`ctx.tools.guard()`、`tools/execute`、
  `tools/post-execute`、`tools/result` —— 权限门禁/沙箱/指标类插件用。
- **如何交付**：工具包 = 普通 Cordis 插件（如 `@deepseek-ai/dsh-tool-web`），在 bundle patch
  里以行 `- id: tool-xxx / name: '@scope/dsh-tool-xxx'` 挂载；web profile 里官方把模型工具
  移到 agent preset 之后，Host 工具注册表仍留在宿主平面。
- **限制**：工具参数/返回值必须 JSON 兼容；`execute` 拥有业务结果，render/presentation 归
  UI 层；重复名/保留名 `run_code` 冲突会失败。
- **证据**：`dsh-tools/lib/types/index.d.ts:603`（register）、`docs/cookbook/extension-cookbook.zh.md`
  （"工具插件……在 `ctx.tools` 上注册"、钩子插件示例）、`dsh-base/cordis.patch.yml`（tool-* 行）、
  SKILL.md（"Register a dynamic model Tool"）。

### 2.7 机制七：Client↔Host RPC（`harness.handle` / `host.call`）—— 集成类插件

- **是什么**：Host 注册包私有方法 `harness.handle(method, handler)`；Client 调
  `host.call(method, args)`（JSON RPC，参数/返回值必须无损 JSON）。这是"浏览器 UI 调宿主能力"
  的官方 seam（如 `dsh-integrations` 需要调外部服务时，Host 侧做网络调用，Client 侧只展示）。
- **证据**：SKILL.md（"Call Host from Client"节）。

### 2.8 机制八：动态插件系统（`cordis_*` 工具，运行时定义）—— 供参考，不建议作为产品底座

- **是什么**：产品内置的"运行时定义/运行/停用插件"能力：模型（或用户）在会话里用
  `cordis_inspect_list/query/self`、`cordis_define`、`cordis_run`、`cordis_stop`、`cordis_undefine`
  动态创建 Host/Client 插件（纯 JS 函数体，无 TS/JSX/bundler），Client 包需用户审批授权。
  `styles.insert(css)` 即该系统的样式注入 API（`data-dyn` 标签，包卸载自动移除）。
- **证据**：SKILL.md 全文、`dsh-cordis-client-runner/lib/types/client/evaluator.d.ts`
  （`DynamicCordisStyles`）、`dsh-web-app/cordis.patch.yml`（`cordis-host-runner`/
  `cordis-client-runner`/`ui-cordis` 行）。
- **结论**：它是官方为"在会话中动态扩展"设计的（进程内、临时、需审批）；桌面端 Extension
  Pack 应走**静态 bundle**（2.1/2.3）保证确定性，动态系统可留作高级用户入口。

### 2.9 机制九：宿主 index 变换（`webServer.tapIndex`）—— CSS/JS 兜底注入

- **是什么**：`WebServer.tapIndex(transform)` 注册一个纯 `html → html` 变换，每次 index 响应
  （`/` 与所有 SPA fallback）按注册顺序执行（`applyIndexTaps`）。官方自身用它做两件事：
  boot-manifest 注入（`window.__DSH_BOOT__`，client-modules）与主题 bootstrap 注入（ui-theme）。
- **能力**：从宿主插件注入 `<style>`/`<link>`/`<script>` 到每个页面响应——**任意 CSS 的最强兜底**。
- **限制**：需要 Host 侧插件（bundle），且是页面级全局注入（无 scoping）；对已物化的单页应用
  内动态插入的内容（如 React 子树）不生效——那部分要靠 slot/组件。
- **证据**：`dsh-host-webserver/lib/index.js`（`tapIndex`/`applyIndexTaps`）、
  `dsh-host-frontend-static/lib/index.js`（`renderIndex = applyIndexTaps(读 index.html)`）、
  `dsh-client-ui-theme/lib/index.js:76`、`dsh-client-modules/lib/index.js:163`。

### 2.10 机制十：配置文件与环境变量（非插件但官方支持的"接缝"）

- **`$DSH_HOME/settings.yaml`**：用户设置文档（`dsh-settings-file` 行，**热重载**）。官方命名空间：
  `ui-theme.preference`（主题）、`llm-deepseek:` / `llm-pi-ai:`（模型适配器段，Web Models 页写入）。
  桌面端读它做外壳主题同步是**官方认可的持久化边界**。
- **`$DSH_HOME/.credentials.yaml`**：托管凭据（Models 页写入）。
- **`$DSH_HOME/.agent-presets`**：用户自建 agent preset（"a preset IS a composition"，与 shell
  同信任级）；官方预设 `config/agent-presets/` 只读（`system` 信任）。
- **环境变量**（实测确认）：
  - `DSH_HOME`（home 根，缺省 `~/.dsh`）；
  - `DSH_TELEMETRY_DISABLED`（**任意非空值**均禁用，含 `'0'/'false'`）；
  - `DSH_TOOLS_MODE`（`native|code|both`，临时开关，web patch 里 `!!js process.env.DSH_TOOLS_MODE`）；
  - `DSH_WEB_URL` / `DSH_WEB_MODE`（官方 shell-env 发布给模型的 shell 变量，web-app 注册
    `web-runtime` 变量组含 `DSH_WEB_URL`）。
  - **`DSH_WEB_PORT`：未确认** —— 桌面端设了它，但在 `0.1.0-rc.6` 全量 `@deepseek-ai/*` 产物中
    未 grep 到任何消费者；端口权威来源是 `--port` flag（`webStartup`）。验证方式见 §5。

---

## 3. 现有注入方式参考（桌面端现状与升级路径）

### 3.1 现状盘点

- **启动**（`apps/desktop/src-tauri/src/process/mod.rs` `launch()`）：`node <dsh>/lib/bin.js
  --profile web --host 127.0.0.1 --port <port>`，cwd=安装目录，env 注入 `DSH_HOME`（`<base>/data/dsh`）、
  `DSH_TELEMETRY_DISABLED=1`、`NO_COLOR=1`、`DSH_WEB_PORT=<port>`，stdin 置空、stdout/stderr 进日志。
  WebView 就绪后 `App.tsx` 用 iframe 加载 `http://127.0.0.1:3080`（`generateTimestampedUrl` 加时间戳
  破缓存）。
- **主题同步**（`useDshTheme.ts` + `theme.rs`）：Rust 侧解析 `$DSH_HOME/settings.yaml` 的
  `ui-theme.preference`（手写行级解析，缺省 dark），变化时经 `dsh-theme-updated` 事件推送；
  前端把结果写到**桌面外壳**的 `<html data-theme="...">` 切换外壳 CSS 变量。
- **`useAutoSync.ts`**：仅监听 `app://sync-state` 事件 + 时间戳 URL，与扩展机制无关。

### 3.2 评估

- 主题桥（读 settings.yaml 的 `ui-theme.preference`）**与官方持久化完全对齐**——官方 ThemeRuntime
  就用同一文件同一命名空间，这是"官方认可"的同步方式，**保留**；建议把 Rust 侧手写 YAML 行解析
  换成最小 YAML 解析或接受官方字段不变性（字段由 `theme-settings.d.ts` 锁定）。
- 当前 `useDshTheme` 只美化**外壳**；**iframe 内** dsh UI 的换肤由官方主题系统自己完成（壳与
  iframe 跨源，外壳的 `<html data-theme>` 不影响 iframe）。所以"升级"不是替换 useDshTheme，而是：
  1. `dsh-theme` 作为 **Client Plugin** 在 iframe 内通过 `ctx.theme.register/overrideTokens`
     注册主题（官方通道）；
  2. 外壳侧保留 useDshTheme 做外观联动（可读同一 settings.yaml，无需改动协议）。
- **不能升级为官方机制的现状**：外壳侧对 iframe 内容做任何 DOM/CSS 注入（跨源 iframe + Tauri
  WebView init-script 只作用于顶层文档，官方不支持对子 frame 注入——**未确认项**，见 §5 验证方法）。

---

## 4. 对 harness-adapter 与 dsh-theme 的设计建议

### 4.1 总体架构（与设计文档 Layer 2/3 对齐）

```text
Tauri Shell (React) ── useDshTheme 外壳换肤（保留）── iframe ──► dsh web (127.0.0.1:3080)
                                                                    │ 官方插件树
runtime 构建期（CI 有 pnpm）：                                      ▼
  runtime/package.json 固定 @deepseek-ai/dsh 版本                    $DSH_HOME/profiles/web/
    + 安装 Extension Pack → 随 zip 分发                          ├─ package.json (dsh.profile.bundles)
桌面首启：                                                       ├─ cordis.patch.yml (用户层)
  harness-adapter 写入 profile/patch/node_modules 布局             └─ node_modules / profiles/node_modules
                                                                   （Extension Pack 各包在此可解析）
```

**结论：官方机制存在且完整，adapter 不需要发明协议，只需要包装五个稳定接口。**

### 4.2 各包落地方式（推荐 vs 避免）

| 包 | 形态 | 官方 API | 说明 |
|---|---|---|---|
| `dsh-theme` | Client Plugin（`dsh.client` + `exports["./client"]`） | `ctx.theme.register(...)` / `overrideTokens(...)`；如需全局 CSS 则在工厂物化时注入（官方加载路径的 `<style data-plugin>`） | 主题 = token 覆盖；Typography/Spacing/Layout tweaks 优先用 `--dsw-alias-*`，不够再注入 CSS；**避免** `document.body`/硬编码选择器 |
| `dsh-ui` | Client Plugin | `ctx.slots.register(...)`（`settings.plugins.tab`、`sidebar.footer.action`、`shell.overlay`、`tool.call.toolview` 等） | **避免**替换整区 slot；按官方"查询 → 最小入口"纪律做 |
| `dsh-tools` | Host Bundle（`dsh.bundle.patch`） | `ctx.tools.register(ToolDefinition)`；门禁用 `tools/pre-execute`/`guard` | 工具注册进宿主平面后对 preset agent 可见 |
| `dsh-integrations` | Host Bundle + 可选 Client 半身 | Host：`harness.handle`；Client：`host.call` + slot | 网络/外部调用放 Host，UI 放 Client |
| `dsh-desktop-bundle` | 聚合 Bundle（`dsh.bundle.patch`，insert 上述各包的行） | —— | patch 内 `- insert:` 一组行即可；一行一个包 |
| `harness-adapter` | **不**做成 dsh 插件，留在桌面侧 | 包装：① 写 `$DSH_HOME/profiles/web/cordis.patch.yml` 与 `dsh.profile.bundles`；② bundle 安装（见 4.3）；③ 读 `settings.yaml`（主题桥）；④ 健康检查/代理；⑤ 版本兼容门（对 `--dump-config` 输出做断言） | 目标接口如 `adapter.ui.register({slot, component})` 应在 adapter 内转译为 slot 注册或 patch 生成，**不是**直连官方 internal API |

### 4.3 关键决策：Extension Pack 如何进 profile（无 pnpm 运行时依赖）

桌面端没有 pnpm（README 明示"无需 pnpm"），而官方 `dsh plugin` 依赖 pnpm。三条可行路径
（推荐 ①，兜底 ②，③ 仅零代码场景）：

1. **运行时布局（推荐）**：Extension Pack 随 runtime zip 分发（`runtime/` 构建期用 pnpm 装好
   workspace），桌面首启时由 adapter 执行：
   - 把各扩展包复制/软链到 `$DSH_HOME/profiles/node_modules/`（**官方自己维护的扁平回退目录**，
     父目录上溯即可解析——这是官方代码路径，不是 hack；已读源码确认
     `healProfilesModuleFallback` 只增不改不删，未知条目不会被清理）；
   - 向 `$DSH_HOME/profiles/web/package.json` 的 `dependencies` 追加扩展包名，并向
     `dsh.profile.bundles` 追加 `dsh-desktop-bundle`（追加后该列表即"用户所有"，`loadProfile`
     原样保留）；
   - 需要时在 `cordis.patch.yml` 补行/覆盖行。扩展包 peer 依赖（cordis、dsh-client-runtime 等）
     由回退目录/安装目录的父级 node_modules 解析。
2. **`dsh plugin --profile web add`**：构建期/安装期在有 pnpm 的环境执行（CI 或把 pnpm 打进
   runtime）；适合 registry 发布的扩展包。
3. **纯配置 patch**：只覆盖官方行 config / 禁用行 / 调 `!!js`——不需要任何新包（但也就没有
   自定义代码/UI）。

> 注意：`web` profile 首次启动自动初始化；adapter 若在首启前预置 `profiles/web/`，官方
> `initProfile` 不会覆盖已存在文件（"Existing files are never touched"）。profile 的
> `cordis.yml` 根配置每次启动会被重写，但那是根、不是 patch，patch 是用户所有、受 HMR 热监听。

### 4.4 dsh-theme 具体设计

- 注册：`apply(ctx)` 里 `ctx.theme.register({ id: 'dsh-desktop', colorScheme: 'dark',
  tokens: { '--dsw-alias-...': '...' } })`；或 `overrideTokens('dsh-theme', {...})` 叠加层。
- 全局 CSS（超出 token 的部分）：在 bundle 工厂物化时注入（官方路径），或兜底用宿主
  `webServer.tapIndex` 注入 `<style>`（2.9）——两者都"不改官方文件"。
- 持久化：不新增设置命名空间；主题偏好继续走官方 `ui-theme.preference`（外壳联动零改动）。
- 多主题：注册多个 id，用 `setTheme(id)` 切换；`theme/change` 事件让外壳（经 settings.yaml
  轮询桥）跟随。
- **避免**：改 `dsh-web-frontend/dist` 的 CSS 文件（NEVER MODIFY）；用初始化脚本往 iframe 注入。

### 4.5 需要避免的"伪官方"路径

- 不要依赖 `window.__DSH_BOOT__`/`__ModuleLoader__` 内部形状做业务（它们是官方注入的 wire
  格式，仅 client-modules 消费；直接读写属于 internal API）。
- 不要 patch 官方行时深合并（官方是整体替换 config，必须 restate 保留字段）。
- 不要往 `$DSH_HOME` 放会被官方覆盖的文件（如根 `cordis.yml`）。

---

## 5. 风险与未知项

| # | 未知/风险 | 现状 | 如何验证 |
|---|---|---|---|
| 1 | `DSH_WEB_PORT` 是否有消费者 | `0.1.0-rc.6` 全量 grep 无消费者；端口权威是 `--port` | 去掉该 env 后启动 `dsh web --port 3080`，确认端口不变；或在官方仓库 grep `DSH_WEB_PORT` |
| 2 | 桌面端是否具备 `dsh plugin`（pnpm）能力 | 未捆绑 pnpm（README 声明"无需 pnpm"）；`dsh plugin` 缺 pnpm 时报 127 并提示安装 | 在带 pnpm 的机器执行 `dsh plugin --profile web add <pkg>` 观察 profile 目录变化；或直接走 4.3-① 布局路径 |
| 3 | 手写 `dsh.profile.bundles`/`dependencies` 后 `loadProfile` 的精确校验行为（fail loud 条件、规范化边界） | 已读源码：追加条目 → 用户所有、原样保留；无 `dsh.bundle` 声明的列表项 fail loud | `dsh --profile web --dump-config` 验证组合结果；故意写错 bundle 声明看报错信息 |
| 4 | 运行中热改 `cordis.patch.yml` 对**新增客户端包**是否即时生效 | 用户 patch 被 `watchUserPatches` 热重组合（宿主侧）；客户端 bundle 变更需 rev 变化 + 刷新（client-hmr 仅在 `dev:web` 构建时活跃） | 改 patch 后不重启观察日志；再强制刷新 iframe（桌面端已有时间戳 URL 机制） |
| 5 | `tapIndex` 注入顺序与缓存 | index 变换在每次 index 响应执行（无 HTTP 缓存头确认） | `curl -v http://127.0.0.1:3080/` 两次对比；`curl -s http://127.0.0.1:3080/ \| grep -o '__DSH_BOOT__\|data-ds-dark-theme'` 确认引导注入 |
| 6 | 第三方主题 token 覆盖的完整性 | 官方明示无完备性校验 | 注册只覆盖部分 token 的主题，肉眼/截图检查明暗两态；用 `ctx.theme.exportInspectTokens()` 列出 token 目录 |
| 7 | Tauri WebView 对 iframe 子 frame 注入 CSS 的可行性 | 未确认；init-script 仅顶层文档；跨源 iframe 使外壳注入不可达 | 在 WebView 顶层尝试 `on_page_load`/初始化脚本后，检查 iframe 内是否生效（预期不生效 → 确认必须走官方插件通道） |
| 8 | 版本演进风险：官方 0.1.0-rc.x 快速迭代、bundle/patch/slot 形状可能变 | 文档多次标注"快速迭代期、存在破坏性变更" | adapter 用 `--dump-config` 断言关键行 id（`ui-theme`/`webserver`/`web-runtime`）存在；Compatibility Gate 在 runtime CI 拦截；变化只改 adapter |
| 9 | 动态插件（cordis_*）在 desktop 场景的可用性 | 机制存在（ui-cordis 行在 web profile 中），但需审批、进程内、临时 | 在 Web UI 里用 `/cordis` 或让 agent 走 cordis_* 工具实际定义一个小插件，确认流程 |
| 10 | 首次启动 profile 自动初始化与 adapter 预置的竞态 | `initProfile`/`prepareProfile` 不覆盖已有文件，但首启顺序未实测 | 删除 `<data>/dsh` 后首次启动，检查 `profiles/web/` 内容与扩展是否加载 |

### 5.1 推荐的验证命令（不改任何官方文件）

```sh
# 1) 打印组合后的整棵配置树（官方：任何条目都可由你的 patch 替换）
dsh --profile web --dump-config

# 2) 打印去掉用户层后的 bundle 层（对比用）
dsh --profile web --dump-default-config

# 3) 确认服务端 index 响应被官方 tap 变换注入的内容
curl -s http://127.0.0.1:3080/ | grep -o '__DSH_BOOT__\|data-ds-dark-theme\|id="root"'

# 4) 确认客户端插件 bundle 服务端点
curl -sI "http://127.0.0.1:3080/plugins/<pkg-id>/client.js"   # 400 系响应属预期（需 rev 参数）

# 5) 观察 profile 目录（首启后自动生成）
ls -R "$DSH_HOME/profiles/web"          # package.json + dsh.profile.bundles + cordis.patch.yml

# 6) 热改验证：运行中编辑 $DSH_HOME/profiles/web/cordis.patch.yml（或 home 级），观察日志 HMR 重组合
```

### 5.2 实测验证记录（2025-08-15，本机 dsh 0.1.0-rc.6，全部通过）

在临时 `DSH_HOME` 下用真实 dsh 二进制端到端验证了 §4.3-① 运行时布局：

| # | 操作 | 结果 |
|---|---|---|
| 1 | 全新 `DSH_HOME` 下 `dsh --profile web --dump-config` | ✅ 自动初始化 `profiles/web/`（package.json 含 `dsh.profile.bundles: ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]`）、`profiles/node_modules/`（254 项扁平回退目录）；输出 490 行组合树、129 个 `id` 条目 |
| 2 | 手写 bundle：`profiles/node_modules/dsh-test-bundle/`（package.json 声明 `dsh.bundle.patch` + `cordis.patch.yml`），并向 profile package.json 的 `dependencies` 与 `dsh.profile.bundles` 追加 | ✅ 重新 dump-config 出现注入行；**证明追加清单原样保留、扁平回退目录可解析** |
| 3 | patch 用 `insert` 追加 `@deepseek-ai/cordis-plugin-timer` 第二实例 | ⚠️ **dump-config 正常显示**，但**实际启动失败**：`service "timer" has been registered` —— insert 不能重复注册 service 类插件；**结论：插入行要避免与既有行提供相同 service** |
| 4 | 改为覆盖已禁用行 `hmr` 的 config（加 marker） | ✅ dump 显示 marker 且 `disabled: true` 保留 —— 确认"id 定位 patch 是整体替换 config、保留其余字段" |
| 5 | 启动 `dsh --profile web --port 3081` | ✅ 服务器正常启动（`dsh web: http://127.0.0.1:3081`），profile 未被破坏 |
| 6 | `curl /` 检查 index taps | ✅ `__DSH_BOOT__`、`data-ds-dark-theme`、`id="root"` 均注入 —— 客户端插件引导图与主题 bootstrap 通道可用 |
| 7 | `curl /plugins/dsh-client-ui-theme/client.js?rev=0` | ✅ HTTP 404（rev 不匹配属预期，端点已路由，真实 rev 见 `__DSH_BOOT__`） |

**结论**：§4.3-① 布局（无 pnpm、`profiles/node_modules` + 手写 bundles 清单）在真实 dsh 上成立；
`packages/harness-adapter` 与 `scripts/verify-layout.ts`（见该包 README）即按此实现并可复现上述验证。

### 5.3 实现期补充发现（Phase 3 Extension Pack 实测，全部经真实 dsh 验证）

| # | 发现 | 结论 |
|---|---|---|
| 1 | **Cordis v4 严格 key 访问**：宿主插件直接 `ctx.tools`/`ctx.harness`（未声明注入）会**抛错** `cannot get property "tools" without inject`，不是返回 undefined | 宿主插件必须用官方模式：`export const inject = ["tools"]`（数组），`apply(ctx)` 内 `ctx.tools.register(...)` 直接可用（对齐 `dsh-tool-bash`：`const inject = ["tools", "shell", "systemPrompt", "shellEnv"]`） |
| 2 | **`harness` 服务仅沙箱可用**（0.1.0-rc.6）：静态插件树中不存在 `harness` service，`inject: ["harness"]` 会导致插件**永久 pending** → `dsh: 1 entry did not activate` → 启动失败 | `harness.handle` RPC 接缝（§2.7）当前只对**动态 cordis 插件**（沙箱上下文）开放；静态集成改用 `ctx.systemPrompt.section` 等静态服务；待官方 rc 提供静态 harness 服务后再接 |
| 3 | **ToolDefinition 的 JSON Schema 只支持单一类型字符串**：`type: ["string","null"]`（type 数组）会被拒（`JsonSchemaError: must be a single type string`） | `output.schema` / `parameters` 里 type 一律写单值；可空字段用空字符串兜底而非 null 联合 |
| 4 | `dsh.client.inject` 可为空数组 `[]`（自包含 client bundle，不依赖注入边） | 验证通过：client-modules 校验仅要求 string 数组 |
| 5 | 客户端插件工厂内 `require("react")` 与官方 bundle 同路径（经 loader 提供）；不可用时**必须优雅降级**（try/catch → 跳过注册），不能抛错 | dsh-ui 已实现降级；浏览器侧真实渲染待 GUI 环境验证 |

**Phase 3 最终形态**（全部经 `verify-client-plugin.ts` E2E 通过）：`dsh-desktop-bundle` 聚合
`dsh-theme`（Client，双主题）/ `dsh-ui`（Client，slot 按钮）/ `dsh-tools`（Host，desktop_env 工具）/
`dsh-integrations`（Host，desktop:environment prompt 段）；组合树 133 行、引导图双客户端条目、
client.js 正常服务。

---

## 附：证据文件索引（本机路径）

| 证据 | 路径 |
|---|---|
| 启动器/CLI 语法 | `<dsh>/lib/bin.js`、`<dsh>/README.md`、`<dsh>/README.zh.md` |
| profile boot / patch 层序 / 遥测开关 | `<dsh>/lib/profile-boot-DG5t9aNs.js` |
| `dsh plugin`（bundle reconcile） | `<dsh>/lib/plugin-9h8shc4d.js` |
| app-boot（profile/bundle/patch 语义） | `<dsh>/node_modules/@deepseek-ai/dsh-app-boot/README.md`、`lib/index.js` |
| web 组合（每行可 patch） | `<dsh>/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml` |
| 客户端插件加载 / boot graph | `<dsh>/node_modules/@deepseek-ai/dsh-client-modules/README.md`、`lib/index.js`、`lib/types/client/manifest.d.ts` |
| 主题 API / 设置命名空间 | `<dsh>/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/types/client/index.d.ts`、`lib/types/theme-settings.d.ts`、`lib/types/boot-theme.d.ts`、`README.md` |
| slot 注册表 | `<dsh>/node_modules/@deepseek-ai/dsh-client-ui-slots/README.md`、`README.zh.md`、`<dsh>/node_modules/@deepseek-ai/dsh-client-runtime/README.md` |
| 工具注册 | `<dsh>/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts`、官方 `docs/cookbook/extension-cookbook.zh.md` |
| index 变换 / 静态托管 | `<dsh>/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js`、`dsh-host-frontend-static/lib/index.js` |
| 动态插件 / styles.insert | `<dsh>/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/types/client/evaluator.d.ts`、`<dsh>/config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md` |
| 官方架构/样式/开发文档 | 官方仓库 `docs/architecture.zh.md`、`docs/web-styling.zh.md`、`docs/development.zh.md`、`docs/cookbook/extension-cookbook.zh.md`、`docs/user/develop/framework/index.zh.md` |
| 桌面端现状 | `apps/desktop/src/hooks/useDshTheme.ts`、`apps/desktop/src-tauri/src/config/theme.rs`、`apps/desktop/src-tauri/src/process/mod.rs` |

> `<dsh>` = `/Users/tfc/my_data/node/node-v24.18/global_packages/lib/node_modules/@deepseek-ai/dsh`
