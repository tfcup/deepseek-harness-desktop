# dsh-theme

主题 / CSS 扩展（设计文档 §16 / Layer 3）。以**官方 Client Plugin** 形态加载，不修改任何官方文件：

- **明暗双主题**：注册 `dsh-desktop-dark` / `dsh-desktop-light`（`ctx.theme.register`，
  `--dsw-alias-*` token 覆盖，官方明示"第三方主题是扩展点"），按 `matchMedia` 系统偏好自动选择；
- 兜底 CSS 走官方加载路径的 `<style data-plugin>` 标签（幂等注入）；
- 宿主半身 `lib/index.js` 让包进入插件树，client-modules 借此挂载浏览器 bundle。

## 形态（对齐官方 dsh-client-ui-theme 实测结构）

```text
package.json     # dsh.client 声明 + exports["./client"]（叶子包：不自行 insert，由聚合包插入行）
lib/index.js     # 宿主半身（Cordis 插件 { name, apply }）
lib/client.js    # 浏览器 bundle（__ModuleLoader__.load({ id, factory }) → apply(ctx)）
```

> 聚合：由 `dsh-desktop-bundle` 的 `cordis.patch.yml` insert 本包宿主行。

## 验证

| 脚本 | 内容 | 结果 |
|---|---|---|
| `packages/harness-adapter/scripts/verify-theme-logic.ts` | 无浏览器行为测试：双主题注册 / CSS 幂等 / matchMedia 自动选择 | ✅ |
| `packages/harness-adapter/scripts/verify-client-plugin.ts` | 真实 dsh E2E：聚合安装 → 组合树 → 引导图 → client.js 服务 | ✅ |

## 状态

- [x] 明暗双主题注册 + 自动选择 + CSS 幂等注入
- [x] 行为测试与真实 dsh 加载链 E2E
- [ ] 外壳联动：经 `harness.handle`/`host.call` RPC 读 `ui-theme.preference` 精确跟随桌面偏好
  （当前用 matchMedia 系统偏好近似）
- [ ] 更多 token 定制
