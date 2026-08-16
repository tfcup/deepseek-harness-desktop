// dsh-tools 宿主插件（Cordis 插件 { name, inject, apply }）：经官方 ctx.tools.register
// 注册自定义工具（设计文档 Layer 3 / §2.6）。
//
// 形态对齐官方 dsh-tool-bash（实测）：
//   const inject = ["tools"];   // 服务注入声明（Cordis v4 严格 key：不声明直接访问会抛错）
//   function apply(ctx) { ctx.tools.register(...) }
//
// ToolDefinition（@deepseek-ai/dsh-tools 实测）：
//   { name, description, parameters(JSON Schema), output: { schema, render }, execute(args, exec) }
//
// 首个工具 desktop_env：返回桌面运行时环境信息（纯 JSON，可用于排查环境问题）。

export const name = "dsh-tools";

/** 声明注入 tools 服务（官方模式，缺省会挂起等待；本行让 ctx.tools 可用） */
export const inject = ["tools"];

function registerDesktopEnv(tools) {
  tools.register({
    name: "desktop_env",
    description:
      "返回 DeepSeek Harness Desktop 的运行时环境信息：平台 / 架构 / Node 版本 / DSH_HOME / 端口。",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          platform: { type: "string" },
          arch: { type: "string" },
          nodeVersion: { type: "string" },
          dshHome: { type: "string" },
          port: { type: "string" },
        },
        required: ["platform", "arch", "nodeVersion", "dshHome", "port"],
      },
      render: (_args, value) => [
        { type: "text", text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(_args, _exec) {
      return {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        dshHome: process.env.DSH_HOME ?? "",
        port: process.env.DSH_WEB_PORT ?? "",
      };
    },
  });
}

export function apply(ctx) {
  const tools = ctx?.tools; // 已由 inject 声明注入
  if (!tools || typeof tools.register !== "function") {
    return;
  }
  try {
    registerDesktopEnv(tools);
  } catch (e) {
    // 重复注册 / schema 校验失败等：记录但不阻断插件树
    console.error("[dsh-tools] register desktop_env failed:", e);
  }
}
