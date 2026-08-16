// dsh-integrations 宿主插件（Cordis 插件 { name, inject, apply }）：桌面环境上下文注入。
//
// 实测结论（0.1.0-rc.6）：`harness.handle`（Client↔Host RPC，SKILL.md §2.7）只在
// **沙箱上下文**（动态 cordis 插件）提供，静态插件树中不存在该 service（inject 会永久
// pending 导致启动失败）。因此本包当前注入静态可用的 `systemPrompt` 服务，向 agent
// 注入桌面环境上下文；RPC 接缝在动态插件场景或官方 rc 提供静态 harness 服务后启用。
//
// 形态对齐官方 dsh-tool-bash：const inject = ["systemPrompt"]; ctx.systemPrompt.section({...})

export const name = "dsh-integrations";

/** 声明注入 systemPrompt 服务（官方模式） */
export const inject = ["systemPrompt"];

export function apply(ctx) {
  const systemPrompt = ctx?.systemPrompt;
  if (!systemPrompt || typeof systemPrompt.section !== "function") {
    return;
  }
  try {
    systemPrompt.section({
      name: "desktop:environment",
      order: 205,
      text:
        "This session runs inside DeepSeek Harness Desktop (macOS ARM64). " +
        "Runtime environment can be inspected with the desktop_env tool. " +
        "Prefer local filesystem and localhost operations; the model's browser " +
        "and network access reflect the desktop sandbox.",
    });
  } catch (e) {
    console.error("[dsh-integrations] register desktop:environment failed:", e);
  }
}
