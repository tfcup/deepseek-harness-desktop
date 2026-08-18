# dsh-desktop-bundle

Extension Pack 聚合 bundle（设计文档 Layer 3）。**Phase 3 完成**：四个叶子包全部接入。

**分层约定（Model B）**：叶子包（`dsh-theme`/`dsh-ui`/`dsh-tools`/`dsh-integrations`）
只声明自身能力、**不自行插入行**；本包是唯一需要加入 `dsh.profile.bundles` 的聚合入口，
其 `cordis.patch.yml` 统一 insert 各叶子包的行（`dependencies` 字段供未来 pnpm 构建期安装）。

```text
package.json      # dsh.bundle.patch → cordis.patch.yml + dependencies（四个叶子包）
cordis.patch.yml  # insert dsh-theme / dsh-ui / dsh-tools / dsh-integrations 宿主行
```

## 聚合内容

| 叶子包 | 形态 | 能力 |
|---|---|---|
| `dsh-theme` | Client Plugin | 明暗双主题（`ctx.theme.register`）+ CSS 幂等注入 |
| `dsh-ui` | Client Plugin | 桌面设置按钮 + `settings.general.item` App 更新入口 |
| `dsh-tools` | Host 插件 | `desktop_env` 工具（`ctx.tools.register`） |
| `dsh-integrations` | Host 插件 | `desktop:environment` prompt 段（`ctx.systemPrompt.section`） |

## 验证

`packages/harness-adapter/scripts/verify-client-plugin.ts`：安装聚合 + 四叶子包 →
组合树含全部行（133 行）→ 服务器启动 → 引导图含 dsh-theme/dsh-ui → client.js 服务。**实测通过**。

## 状态

- [x] 聚合入口（四叶子包行全启用）
- [x] 真实 dsh E2E
- [ ] 接入 runtime 构建流水线（Phase 4：pnpm 安装依赖 + 复制到 profile）
