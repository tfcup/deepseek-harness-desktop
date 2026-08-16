# dsh-tools

自定义工具扩展（设计文档 §16 / Layer 3）。以**宿主插件**形态经官方 `ctx.tools.register`
注册工具，不修改任何官方文件。

当前工具：`desktop_env` —— 返回桌面运行时环境信息（平台 / 架构 / Node 版本 / DSH_HOME / 端口），
纯 JSON 输出，可用于排查环境问题。

## 形态（对齐官方 dsh-tool-bash 实测）

```text
package.json     # 宿主插件包（main → lib/index.js）
lib/index.js     # { name, inject, apply }：
                 #   inject = ["tools"]（Cordis v4 必须声明注入，否则 ctx.tools 直接访问抛错）
                 #   apply(ctx) → ctx.tools.register(ToolDefinition)
```

ToolDefinition（@deepseek-ai/dsh-tools 实测）：
`{ name, description, parameters(JSON Schema), output: { schema, render }, execute(args, exec) }`
—— 注意 schema 只支持**单一类型字符串**（`type: ["string","null"]` 会报错）。

## 验证

| 脚本 | 内容 | 结果 |
|---|---|---|
| `packages/harness-adapter/scripts/verify-host-plugins.ts` | inject 声明、tools.register、execute 返回值、降级 | ✅ |
| `packages/harness-adapter/scripts/verify-client-plugin.ts` | 真实 dsh E2E：组合树含 dsh-tools 行、服务器正常启动 | ✅ |

## 状态

- [x] `desktop_env` 工具（注册 + 执行 + 渲染）
- [ ] 更多工具（桌面文件操作、会话管理入口等）
