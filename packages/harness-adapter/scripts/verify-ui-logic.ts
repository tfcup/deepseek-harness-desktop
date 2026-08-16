//! 行为测试：dsh-ui 客户端插件的 slot 注册逻辑（无浏览器，stub 环境）。
//!
//! 按 SKILL.md "Register Client UI" 契约验证：
//!   1. client.js 经 __ModuleLoader__.load 注册；
//!   2. apply(ctx) 用 ctx.get('slots') + slots.inject 等待声明，再 slots.register
//!      注册 { name: 'sidebar.footer.action', id: 'dsh-desktop-settings' } + React 组件；
//!   3. 组件渲染为按钮，onClick postMessage 到父窗口；
//!   4. react 不可用时优雅降级（不注册、不抛错）。
//!
//! 用法：node packages/harness-adapter/scripts/verify-ui-logic.ts

import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLIENT_JS = join(process.cwd(), "packages", "dsh-ui", "lib", "client.js");

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** 简易 stub react：createElement 返回可断言的描述对象 */
function stubReact() {
  return {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
      kind: "element",
      type,
      props: props ?? {},
      children,
    }),
  };
}

async function main(): Promise<void> {
  const registrations: Array<{ name: string; id: string; component: (props?: unknown) => unknown }> = [];
  const loaded: Array<{ id: string; factory: (req: (s: string) => unknown) => unknown }> = [];
  const postMessages: unknown[] = [];

  (globalThis as unknown as Record<string, unknown>).window = {
    __ModuleLoader__: {
      load: (o: { id: string; factory: (req: (s: string) => unknown) => unknown }) => loaded.push(o),
    },
    parent: {
      postMessage: (m: unknown) => postMessages.push(m),
    },
  };

  // --- 加载 client.js（factory 内 require("react") 由 stub 提供） ---
  await import(pathToFileURL(CLIENT_JS).href);
  const entry = loaded.find((e) => e.id === "dsh-ui");
  if (!entry) fail("client.js 未通过 __ModuleLoader__.load 注册（id=dsh-ui）");

  const moduleExports = entry!.factory(() => stubReact()) as { apply: (ctx: unknown) => void };
  if (typeof moduleExports.apply !== "function") fail("client 入口缺少 apply(ctx)");

  // --- stub ctx：slots 同时提供 inject 与 register（与真实 dsh slots 服务一致） ---
  const fakeCtx = {
    get: (key: string) => {
      if (key === "slots") {
        return {
          inject: (slotName: string, cb: () => void) => {
            if (slotName === "sidebar.footer.action") cb();
          },
          register: (
            def: { name: string; id: string },
            component: (props?: unknown) => unknown,
          ) => registrations.push({ ...def, component }),
        };
      }
      return null;
    },
  };

  console.log("[1] apply(ctx) 经 slots.inject → slots.register…");
  moduleExports.apply(fakeCtx);
  if (registrations.length !== 1) fail(`slots.register 调用次数异常: ${registrations.length}`);
  const reg = registrations[0];
  if (reg.name !== "sidebar.footer.action" || reg.id !== "dsh-desktop-settings") {
    fail(`注册目标异常: ${JSON.stringify({ name: reg.name, id: reg.id })}`);
  }
  if (typeof reg.component !== "function") fail("注册的 component 不是函数");

  console.log("[2] 组件渲染为按钮 + onClick postMessage…");
  const element = reg.component({});
  if (
    element.kind !== "element" ||
    element.type !== "button" ||
    String(element.children?.[0]).includes("桌面设置") === false
  ) {
    fail(`组件渲染异常: ${JSON.stringify(element).slice(0, 200)}`);
  }
  (element.props as { onClick?: () => void }).onClick?.();
  const posted = postMessages[0] as { type?: string } | undefined;
  if (!posted || posted.type !== "dsh-desktop:open-settings") {
    fail(`onClick 未 postMessage: ${JSON.stringify(posted)}`);
  }
  console.log(`    ✓ 按钮 + onClick postMessage(${JSON.stringify(posted?.type)})`);

  console.log("[3] react 不可用时优雅降级…");
  const entry2 = loaded.find((e) => e.id === "dsh-ui")!;
  const exportsNoReact = entry2.factory(() => {
    throw new Error("react not available");
  }) as { apply: (ctx: unknown) => void };
  const countBefore = registrations.length;
  exportsNoReact.apply(fakeCtx); // 不应抛错、不应注册
  if (registrations.length !== countBefore) fail("react 缺失时不应注册 slot");
  console.log("    ✓ react 缺失时静默跳过（无抛错、无注册）");

  console.log("\n✅ 全部通过：dsh-ui slot 注册逻辑（inject→register、按钮渲染、降级）正确。");
}

void main();
