# dsh-integrations

外部集成扩展（设计文档 §16 / Layer 3）。以**宿主插件**形态向 agent 注入桌面环境上下文。

当前功能：向 agent 的 system prompt 注册 `desktop:environment` 段（描述当前会话运行于
DeepSeek Harness Desktop，并提示可用 `desktop_env` 工具）。

## 关于 Client↔Host RPC（实测结论）

SKILL.md 的 `harness.handle`（Host）/ `host.call`（Client）RPC 接缝在 **0.1.0-rc.6 仅于
沙箱上下文（动态 cordis 插件）提供**：静态插件树中不存在 `harness` 服务，声明
`inject: ["harness"]` 会导致插件永久 pending、启动失败。因此本包暂用静态可用的
`systemPrompt` 注入；RPC 接缝待官方 rc 提供静态 harness 服务后启用。

## 形态

```text
package.json     # 宿主插件包
lib/index.js     # { name, inject, apply }：inject = ["systemPrompt"]，
                 #   apply(ctx) → ctx.systemPrompt.section({ name, order, text })
```

## 验证

| 脚本 | 内容 | 结果 |
|---|---|---|
| `packages/harness-adapter/scripts/verify-host-plugins.ts` | inject 声明、section 注册、降级 | ✅ |
| `packages/harness-adapter/scripts/verify-client-plugin.ts` | 真实 dsh E2E：组合树含 dsh-integrations 行、服务器正常启动 | ✅ |

## 状态

- [x] `desktop:environment` prompt 段
- [ ] 外部服务集成（网络调用放 Host；依赖官方静态 harness 服务或动态插件）
