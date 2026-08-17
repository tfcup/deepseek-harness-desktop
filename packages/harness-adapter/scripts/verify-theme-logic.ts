//! 行为测试：dsh-theme 客户端插件的运行时逻辑（无浏览器，stub window/document）。
//!
//! 用官方 wire 格式加载 `packages/dsh-theme/lib/client.js`，捕获
//! `__ModuleLoader__.load` 注册的 factory，stub 出 ctx（theme/slots），调用
//! apply(ctx)，断言：
//!   1. 明暗双主题均注册（id / colorScheme / tokens）；
//!   2. CSS 兜底注入幂等（重复 apply 不重复插入 style）；
//!   3. matchMedia 可用时按系统偏好调用 setTheme。
//!
//! 用法：node packages/harness-adapter/scripts/verify-theme-logic.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLIENT_JS = join(process.cwd(), "packages", "dsh-theme", "lib", "client.js");
const DARK_ID = "dsh-desktop-dark";
const LIGHT_ID = "dsh-desktop-light";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // --- stub 浏览器环境 ---
  const registeredThemes: Array<{ id: string; colorScheme: string; tokens: Record<string, string> }> = [];
  const setThemeCalls: string[] = [];
  const styles: Array<{ attrs: Record<string, string>; textContent: string }> = [];
  const loaded: Array<{ id: string; factory: (req: (s: string) => unknown) => unknown }> = [];

  (globalThis as unknown as Record<string, unknown>).window = {
    __ModuleLoader__: {
      load: (o: { id: string; factory: (req: (s: string) => unknown) => unknown }) => loaded.push(o),
    },
  };
  (globalThis as unknown as Record<string, unknown>).document = {
    querySelector: (sel: string) => {
      if (sel === "style[data-plugin-css='dsh-theme']") {
        return styles.find((s) => s.attrs["data-plugin-css"] === "dsh-theme") ?? null;
      }
      return null;
    },
    createElement: () => {
      const el: { attrs: Record<string, string>; textContent: string; setAttribute: (k: string, v: string) => void } = {
        attrs: {},
        textContent: "",
        setAttribute(k: string, v: string) {
          this.attrs[k] = v;
        },
      };
      return el;
    },
    head: {
      appendChild: (el: { attrs: Record<string, string>; textContent: string }) => styles.push(el),
    },
  };

  // --- 加载 client.js（ESM 顶层访问 window/__ModuleLoader__） ---
  await import(pathToFileURL(CLIENT_JS).href);
  const entry = loaded.find((e) => e.id === "dsh-theme");
  if (!entry) fail("client.js 未通过 __ModuleLoader__.load 注册（id=dsh-theme）");
  const moduleExports = entry!.factory(() => {
    throw new Error("本包不应 require 任何依赖");
  }) as { apply: (ctx: unknown) => void; inject: string[] | undefined };
  if (typeof moduleExports.apply !== "function") fail("client 入口缺少 apply(ctx)");
  if (!Array.isArray(moduleExports.inject) || !moduleExports.inject.includes("theme")) {
    fail(`client 入口必须声明 inject: ["theme"]（Cordis 严格键，未声明访问 ctx.theme 会抛错）：${JSON.stringify(moduleExports.inject)}`);
  }
  console.log(`    ✓ inject 声明含 "theme"（${JSON.stringify(moduleExports.inject)}）`);

  // --- stub ctx 并调用 apply（get 返回 theme 服务，模拟官方 ThemeRuntime 已就绪） ---
  const fakeTheme = {
    register: (d: { id: string; colorScheme: string; tokens: Record<string, string> }) =>
      registeredThemes.push(d),
    setTheme: (id: string) => setThemeCalls.push(id),
  };
  const fakeCtx = {
    get: (key: string) => (key === "theme" ? fakeTheme : null),
  };

  console.log("[1] apply(ctx) 注册明暗双主题…");
  moduleExports.apply(fakeCtx);
  const dark = registeredThemes.find((t) => t.id === DARK_ID);
  const light = registeredThemes.find((t) => t.id === LIGHT_ID);
  if (!dark || dark.colorScheme !== "dark") fail(`缺少深色主题注册: ${JSON.stringify(dark)}`);
  if (!light || light.colorScheme !== "light") fail(`缺少浅色主题注册: ${JSON.stringify(light)}`);
  if (Object.keys(dark!.tokens).length === 0 || Object.keys(light!.tokens).length === 0) {
    fail("主题 tokens 为空");
  }
  console.log(`    ✓ ${DARK_ID} (dark) + ${LIGHT_ID} (light) 均已注册，token 各 ${Object.keys(dark!.tokens).length} 个`);

  console.log("[2] 重复 apply 的 CSS 注入幂等…");
  moduleExports.apply(fakeCtx);
  if (styles.length !== 1) fail(`CSS style 注入不幂等: ${styles.length} 个（应为 1）`);
  const style = styles[0];
  if (style.attrs["data-plugin"] !== "dsh-theme" || style.attrs["data-plugin-css"] !== "dsh-theme") {
    fail("style 标签缺少官方 data-plugin 属性");
  }
  if (!style.textContent.includes("::-webkit-scrollbar")) fail("style 内容缺失");
  console.log(`    ✓ 重复 apply 后仅 1 个 <style data-plugin-css>（幂等）`);

  console.log("[3] matchMedia 可用时自动 setTheme…");
  if (setThemeCalls.length !== 0) fail("无 matchMedia 时不应调用 setTheme");
  (globalThis as unknown as Record<string, unknown>).matchMedia = (q: string) => ({
    matches: q.includes("dark"),
  });
  moduleExports.apply(fakeCtx);
  if (setThemeCalls.length !== 1 || setThemeCalls[0] !== DARK_ID) {
    fail(`setTheme 调用异常: ${JSON.stringify(setThemeCalls)}`);
  }
  console.log(`    ✓ 系统偏好 dark → setTheme(${DARK_ID})`);

  console.log("[4] theme 服务不可用（ctx.get 返回 null）时不抛错、不注册、CSS 仍注入…");
  const themesBefore = registeredThemes.length;
  const stylesBefore = styles.length;
  let threw = false;
  try {
    moduleExports.apply({ get: () => null });
  } catch {
    threw = true;
  }
  if (threw) fail("theme 服务不可用时 apply 不应抛错（降级而非崩溃）");
  if (registeredThemes.length !== themesBefore) fail("theme 服务不可用不应注册主题");
  if (styles.length !== stylesBefore) fail("theme 服务不可用时 CSS 注入应保持幂等（不新增、不抛错）");
  console.log("    ✓ 不抛错、不注册主题、CSS 注入保持幂等");

  console.log("\n✅ 全部通过：dsh-theme 客户端插件运行时逻辑（inject 声明 / 双主题注册 / CSS 幂等 / 自动选择 / 服务缺失降级）正确。");
}

void main();
