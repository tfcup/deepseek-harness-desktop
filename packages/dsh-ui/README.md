# dsh-ui

自定义 UI 扩展（设计文档 §16 / Layer 3）。以**官方 Client Plugin** 形态加载，向官方 slot
注入 React UI，不修改任何官方文件。

当前功能：向 `sidebar.footer.action`（官方侧边栏小动作 slot）注入"桌面设置"按钮，
点击经 `window.parent.postMessage` 通知桌面外壳（外壳侧监听属后续 UI 集成）。

## 形态（对齐 SKILL.md "Register Client UI" 规范）

```text
package.json     # dsh.client 声明 + exports["./client"]（叶子包：由聚合包插入行）
lib/index.js     # 宿主半身（{ name, apply }）
lib/client.js    # 浏览器 bundle：__ModuleLoader__.load → apply(ctx)
                 #   ctx.get('slots') → slots.inject('sidebar.footer.action', cb) → slots.register({name,id}, Component)
```

要点（官方规范）：
- 用 `ctx.get('slots')`（不要 `ctx.slots`，除非声明注入）；
- `slots.inject` 等待官方 slot 声明后再注册；
- React 经 loader 提供（`require("react")`，与官方 bundle 同路径）；不可用时优雅降级。

## 验证

| 脚本 | 内容 | 结果 |
|---|---|---|
| `packages/harness-adapter/scripts/verify-ui-logic.ts` | inject→register、组件渲染、onClick postMessage、react 缺失降级 | ✅ |
| `packages/harness-adapter/scripts/verify-client-plugin.ts` | 真实 dsh E2E：引导图含 dsh-ui 条目、client.js 服务 | ✅ |

## 状态

- [x] `sidebar.footer.action` 按钮（slot 注入 + postMessage）
- [ ] 外壳侧监听 postMessage 打开桌面设置（Phase 5 UI 集成）
- [ ] 更多 slot（`settings.plugins.tab`、`shell.overlay` 等）
