# dsh-ui

自定义 UI 扩展（设计文档 §16 / Layer 3）。以**官方 Client Plugin** 形态加载，向官方 slot
注入 React UI，不修改任何官方文件。

当前功能：

- 向 `settings.general.item` 注入两组本机字体/实际字重选择器；
- 通过官方 `settingsScope` 把 UI 与编程字体独立保存到 `desktop-fonts`；
- 向 `settings.general.item` 注入“应用更新”设置行；
- 通过版本化 `postMessage` 协议请求 Tauri 父窗口列举本机字体或执行 App 更新，浏览器页不直接获得原生权限。

## 形态（对齐 SKILL.md "Register Client UI" 规范）

```text
package.json     # dsh.client 声明 + exports["./client"]（叶子包：由聚合包插入行）
lib/index.js     # 宿主半身：注册 desktop-fonts settings schema
lib/client.js    # 浏览器 bundle：__ModuleLoader__.load → apply(ctx)
                 #   settingsScope 持久化 + slots 注入字体/更新设置行
```

要点（官方规范）：
- 在 Client Plugin 的 `exports.inject` 中声明 slots、locale 和 settingsScope 等服务后再使用；
- `slots.inject` 等待官方 slot 声明后再注册；
- React 经 loader 提供（`require("react")`，与官方 bundle 同路径）；依赖缺失时明确启动失败，禁止静默隐藏设置项。

## 验证

| 脚本 | 内容 | 结果 |
|---|---|---|
| `packages/harness-adapter/scripts/verify-ui-logic.ts` | 字体搜索、真实 face 联动、独立持久化/默认回退、slot 与消息协议 | ✅ |
| `packages/harness-adapter/scripts/verify-client-plugin.ts` | 真实 dsh E2E：引导图含 dsh-ui 条目、client.js 服务 | ✅ |

## 状态

- [x] Harness 自带设置中的 App 更新入口（`settings.general.item`）
- [x] 本机 UI/编程字体和实际字重选择器（`desktop-fonts`）
- [x] 外壳侧安全消息桥（校验 iframe window + service origin）
