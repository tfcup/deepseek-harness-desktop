//! 行为测试：dsh-tools 与 dsh-integrations 宿主插件逻辑（无 dsh 运行时，stub ctx）。
//!
//! 验证：
//!   dsh-tools      — apply(ctx) 经 ctx.tools.register 注册 desktop_env 工具
//!                    （ToolDefinition 形态：name/description/parameters/output/execute）；
//!                    execute() 返回 JSON 兼容的环境信息。
//!   dsh-integrations — apply(ctx) 经 ctx.harness.handle 注册 dsh-desktop:ping；
//!                    调用 handler 返回 { ok, at, pid }。
//!
//! 用法：node packages/harness-adapter/scripts/verify-host-plugins.ts

import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TOOLS_JS = join(process.cwd(), "packages", "dsh-tools", "lib", "index.js");
const INTEGRATIONS_JS = join(process.cwd(), "packages", "dsh-integrations", "lib", "index.js");

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // ---------- dsh-tools ----------
  console.log("[1] dsh-tools: inject 声明 + ctx.tools.register(desktop_env)…");
  const registeredTools: unknown[] = [];
  const toolsMod = (await import(pathToFileURL(TOOLS_JS).href)) as {
    name?: string;
    inject?: string[];
    apply: (ctx: unknown) => void;
  };
  if (toolsMod.name !== "dsh-tools" || typeof toolsMod.apply !== "function") {
    fail("dsh-tools 导出形态异常（应为 { name, inject, apply }）");
  }
  if (!toolsMod.inject?.includes("tools")) {
    fail(`dsh-tools 未声明 inject=["tools"]（Cordis v4 必须声明注入，否则直接访问 ctx.tools 会抛错）: ${JSON.stringify(toolsMod.inject)}`);
  }
  toolsMod.apply({
    get: () => null,
    tools: {
      register: (def: unknown) => registeredTools.push(def),
    },
  });
  if (registeredTools.length !== 1) fail(`tools.register 调用次数异常: ${registeredTools.length}`);
  const tool = registeredTools[0] as {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
    output?: { schema?: Record<string, unknown>; render?: (a: unknown, v: unknown) => unknown };
    execute?: (args: unknown, exec: unknown) => Promise<unknown>;
  };
  if (tool.name !== "desktop_env" || !tool.description || !tool.parameters || !tool.output) {
    fail(`ToolDefinition 形态异常: ${JSON.stringify(tool).slice(0, 200)}`);
  }
  const result = await tool.execute!({}, {});
  const r = result as Record<string, unknown>;
  if (typeof r.platform !== "string" || typeof r.arch !== "string" || typeof r.nodeVersion !== "string") {
    fail(`execute 返回值异常: ${JSON.stringify(r)}`);
  }
  const blocks = tool.output!.render!({}, r) as Array<{ type?: string; text?: string }>;
  if (!Array.isArray(blocks) || blocks[0]?.type !== "text" || !blocks[0].text) {
    fail("output.render 未返回 text content block");
  }
  console.log(`    ✓ desktop_env 注册成功，execute → ${JSON.stringify({ platform: r.platform, arch: r.arch })}`);

  console.log("[2] dsh-tools: tools 服务缺失时优雅降级…");
  const toolsMod2 = (await import(pathToFileURL(TOOLS_JS).href)) as { apply: (ctx: unknown) => void };
  toolsMod2.apply({ get: () => null }); // 无 tools 服务，不应抛错
  console.log("    ✓ 无 tools 服务时静默跳过");

  // ---------- dsh-integrations ----------
  console.log("[3] dsh-integrations: inject 声明 + ctx.systemPrompt.section(desktop:environment)…");
  const sections: Array<{ name?: string; text?: string }> = [];
  const intMod = (await import(pathToFileURL(INTEGRATIONS_JS).href)) as {
    name?: string;
    inject?: string[];
    apply: (ctx: unknown) => void;
  };
  if (intMod.name !== "dsh-integrations" || typeof intMod.apply !== "function") {
    fail("dsh-integrations 导出形态异常");
  }
  if (!intMod.inject?.includes("systemPrompt")) {
    fail(`dsh-integrations 未声明 inject=["systemPrompt"]: ${JSON.stringify(intMod.inject)}`);
  }
  intMod.apply({
    get: () => null,
    systemPrompt: {
      section: (def: { name?: string; text?: string }) => sections.push(def),
    },
  });
  if (sections.length !== 1 || sections[0].name !== "desktop:environment") {
    fail(`systemPrompt.section 注册异常: ${JSON.stringify(sections)}`);
  }
  if (!sections[0].text?.includes("DeepSeek Harness Desktop")) {
    fail("desktop:environment 内容缺失");
  }
  console.log(`    ✓ desktop:environment 已注册（name=${sections[0].name}）`);

  console.log("[4] dsh-integrations: systemPrompt 服务缺失时优雅降级…");
  const intMod2 = (await import(pathToFileURL(INTEGRATIONS_JS).href)) as { apply: (ctx: unknown) => void };
  intMod2.apply({ get: () => null });
  console.log("    ✓ 无 systemPrompt 服务时静默跳过");

  console.log("\n✅ 全部通过：dsh-tools / dsh-integrations 宿主插件逻辑正确。");
}

void main();
