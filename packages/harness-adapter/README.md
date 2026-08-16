# harness-adapter

Compatibility Adapter（设计文档 Layer 2 / Anti-Corruption Layer）。

只包装官方 dsh 的**稳定接缝**，隔离官方 API 演进对 Extension Pack 的影响。接口均基于
`docs/DSH-PLUGIN-API.md` 的调研**并经真实 dsh 二进制实测验证**（§5.2 验证记录）。

## 已实现接口（实测通过）

| 接口 | 职责 | 对应官方机制 |
|---|---|---|
| `installBundleToProfile(dshHome, srcDir, name)` | 扩展包复制进 `$DSH_HOME/profiles/node_modules/<name>/` | §2.1 Bundle + §4.3-① 扁平回退目录（官方维护，只增不删） |
| `addBundleToProfile / removeBundleFromProfile` | 编辑 `profiles/web/package.json` 的 `dependencies` 与 `dsh.profile.bundles`（幂等） | §2.1（追加即"用户所有"，官方不改写） |
| `writeUserPatch(dshHome, patchYaml)` | 写 `profiles/web/cordis.patch.yml`（官方热监听 HMR） | §2.2 用户 patch 层 |
| `readThemePreference(dshHome)` | 读 `settings.yaml` 的 `ui-theme.preference`（light/dark/system） | §2.5 主题持久化命名空间（官方 ThemeRuntime 同源） |
| `dumpConfig / assertConfigCompatible` | 跑 `dsh --profile web --dump-config`，断言关键行 id（`ui-theme`/`webserver`/`web-runtime`） | §5.1-1 版本兼容门 |
| `healthCheck(url)` | HTTP 探活 | §13 健康检查 |
| `parseDump(stdout)` | 解析 dump 输出中的 `id` 行 | —— |

## 验证

```sh
node scripts/verify-layout.ts             # 需要 dsh 在 PATH（或 DSH_BIN 环境变量）
node scripts/verify-theme-logic.ts        # dsh-theme 运行时行为（无浏览器，stub 环境）
node scripts/verify-ui-logic.ts           # dsh-ui slot 注册逻辑（stub 环境）
node scripts/verify-host-plugins.ts       # dsh-tools / dsh-integrations 宿主逻辑（stub 环境）
node scripts/verify-client-plugin.ts      # 完整 Extension Pack 加载链 E2E（真实 dsh）
```

- `verify-layout.ts`：全新 DSH_HOME 兼容断言 → adapter 安装 bundle + patch 注入标记 → 主题桥读取。
- `verify-theme-logic.ts`：stub 加载 dsh-theme client.js，断言明暗双主题注册、CSS 幂等、matchMedia 自动选择。
- `verify-ui-logic.ts`：stub 加载 dsh-ui client.js，断言 slots.inject→register、按钮渲染、react 缺失降级。
- `verify-host-plugins.ts`：stub ctx 验证 dsh-tools（tools.register + execute）与 dsh-integrations（systemPrompt.section）。
- `verify-client-plugin.ts`：安装 `dsh-desktop-bundle` 聚合 + 四叶子包 → 组合树全部行 →
  服务器启动 → `__DSH_BOOT__` 含 dsh-theme/dsh-ui → 各 client.js 正常服务。

详见各脚本与 `docs/DSH-PLUGIN-API.md §5.2 / §5.3`。

## 设计约束（来自调研，勿违反）

- 不直连官方 internal API（`window.__DSH_BOOT__` / `__ModuleLoader__` 内部形状）；
- id 定位 patch 是**整体替换 config** 非深合并（restate 保留字段）；
- 不往 `$DSH_HOME` 放会被官方覆盖的文件（根 `cordis.yml`）；
- `cordis.patch.yml` 禁止写空内容（官方会抛错，禁用用 `[]`）；
- insert 新行避免与既有行提供相同 service（实测：重复注册会启动失败）。

## 状态

- [x] Phase 3：官方 API 调研（`docs/DSH-PLUGIN-API.md`）
- [x] Phase 3：adapter 稳定接缝实现 + 端到端验证
- [ ] Phase 3：`dsh-theme` Client Plugin（`ctx.theme.register` + token 覆盖）
- [ ] Phase 3：`dsh-ui` / `dsh-tools` / `dsh-integrations` / `dsh-desktop-bundle`
- [ ] Phase 4：接入 runtime 构建流水线
