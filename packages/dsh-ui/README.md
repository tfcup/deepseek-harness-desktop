# dsh-ui

自定义 UI 扩展（设计文档 §16 / Layer 3）。以**官方 Client Plugin** 形态加载，向官方 slot
注入 React UI，不修改任何官方文件。

当前功能：

- 向 `settings.general.item` 注入“应用更新”设置行；
- 通过版本化 `postMessage` 协议请求 Tauri 父窗口检查、安装和重启，浏览器页不直接获得原生权限。

## 形态（对齐 SKILL.md "Register Client UI" 规范）

```text
package.json     # dsh.client 声明 + exports["./client"]（叶子包：由聚合包插入行）
lib/index.js     # 宿主半身（{ name, apply }）
lib/client.js    # 浏览器 bundle：__ModuleLoader__.load → apply(ctx)
                 #   ctx.get('slots') → inject settings.general.item
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

- [x] Harness 自带设置中的 App 更新入口（`settings.general.item`）
- [x] 外壳侧安全消息桥（校验 iframe window + service origin）
