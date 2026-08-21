//! dsh-ui 客户端插件行为测试（无浏览器，stub 环境）。
//!
//! 验证 Harness 设置更新行通过官方 slot 注册，并且只发送版本化 postMessage
//! 请求，不注册已删除的桌面工具入口，也不直接接触 Tauri API。

import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLIENT_JS = join(process.cwd(), "packages", "dsh-ui", "lib", "client.js");

interface StubElement {
  kind: "element";
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
}

/** 输出失败原因并终止脚本。 */
function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/**
 * 提供插件所需的最小 React API；useState 直接返回“发现更新”状态，
 * 便于在没有真实 React renderer 时断言按钮动作。
 */
function stubReact(connected = true) {
  return {
    createElement: (type: unknown, props: unknown, ...children: unknown[]): StubElement => ({
      kind: "element",
      type,
      props: (props ?? {}) as Record<string, unknown>,
      children,
    }),
    useState: () => [{
      connected,
      desktop: true,
      phase: "available",
      currentVersion: "0.1.13",
      latestVersion: "0.1.14",
      progress: 0,
    }, () => undefined],
    useEffect: (effect: () => void | (() => void)) => effect(),
  };
}

/** 深度查找 stub React 元素树中第一个满足条件的节点。 */
function findElement(value: unknown, predicate: (element: StubElement) => boolean): StubElement | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object" || (value as StubElement).kind !== "element") return null;
  const element = value as StubElement;
  if (predicate(element)) return element;
  for (const child of element.children) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

/** 执行 slot 注册、渲染和 postMessage 协议断言。 */
async function main(): Promise<void> {
  const registrations: Array<{
    name: string;
    id: string;
    order?: number;
    component: (props?: Record<string, unknown>) => unknown;
  }> = [];
  const loaded: Array<{ id: string; factory: (request: (specifier: string) => unknown) => unknown }> = [];
  const postMessages: unknown[] = [];
  const messageListeners: Array<(event: unknown) => void> = [];

  const parentWindow = {
    postMessage: (message: unknown) => postMessages.push(message),
  };
  (globalThis as unknown as Record<string, unknown>).window = {
    __ModuleLoader__: {
      load: (entry: { id: string; factory: (request: (specifier: string) => unknown) => unknown }) => {
        loaded.push(entry);
      },
    },
    parent: parentWindow,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === "message") messageListeners.push(listener);
    },
    removeEventListener: () => undefined,
  };
  (globalThis as unknown as Record<string, unknown>).document = {
    documentElement: { lang: "zh-CN" },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: "" }),
    head: { appendChild: () => undefined },
  };

  await import(pathToFileURL(CLIENT_JS).href);
  const entry = loaded.find((candidate) => candidate.id === "dsh-ui");
  if (!entry) fail("client.js 未通过 __ModuleLoader__.load 注册（id=dsh-ui）");

  const react = stubReact();
  const moduleExports = entry.factory((specifier) => {
    if (specifier === "react") return react;
    if (specifier === "@deepseek-ai/dsh-client-ui-primitives") {
      return {
        IconDownloadOutline16: "download-icon",
        IconRefreshOutline16: "refresh-icon",
      };
    }
    throw new Error(`unexpected require: ${specifier}`);
  }) as { apply: (ctx: unknown) => void; inject: string[] };

  const slots = {
    inject: (slotName: string, callback: () => void) => {
      if (slotName === "settings.general.item") callback();
    },
    register: (
      definition: { name: string; id: string; order?: number },
      component: (props?: Record<string, unknown>) => unknown,
    ) => registrations.push({ ...definition, component }),
  };
  const context = {
    slots,
    locale: { register: () => () => undefined },
    effect: (effect: () => unknown) => effect(),
  };

  console.log("[1] 只注册 Harness 常规设置中的 App 更新行…");
  if (moduleExports.inject.join(",") !== "slots,locale") {
    fail(`Cordis Service 注入声明异常: ${JSON.stringify(moduleExports.inject)}`);
  }
  moduleExports.apply(context);
  if (registrations.length !== 1) fail(`slots.register 调用次数异常: ${registrations.length}`);
  const updateRow = registrations.find((item) => item.name === "settings.general.item");
  if (!updateRow || updateRow.id !== "desktop-app-update" || updateRow.order !== 100) {
    fail("Harness 设置更新行注册异常");
  }

  console.log("[2] 更新行通过版本化 postMessage 发出检查/安装请求…");
  const row = updateRow.component({ t: (key: string) => key });
  const installButton = findElement(row, (element) => element.type === "button");
  if (!installButton) fail("更新行未渲染操作按钮");
  (installButton.props.onClick as (() => void) | undefined)?.();
  const actions = postMessages as Array<{ type?: string; action?: string }>;
  if (!actions.some((message) => message.type === "dsh-desktop:update-request-v1" && message.action === "get-state")) {
    fail("更新行挂载时未请求父窗口状态");
  }
  if (!actions.some((message) => message.type === "dsh-desktop:update-request-v1" && message.action === "install")) {
    fail("发现更新时按钮未请求 install");
  }

  console.log("[3] 桌面父窗口握手前仍展示更新入口…");
  const disconnectedReact = stubReact(false);
  const disconnectedExports = entry.factory((specifier) => {
    if (specifier === "react") return disconnectedReact;
    if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return {};
    throw new Error(`unexpected require: ${specifier}`);
  }) as { apply: (ctx: unknown) => void };
  const registrationCount = registrations.length;
  disconnectedExports.apply(context);
  const disconnectedRow = registrations[registrationCount]?.component({ t: (key: string) => key });
  if (!findElement(disconnectedRow, (element) => element.type === "button")) {
    fail("桌面 iframe 握手前更新行不应静默消失");
  }

  console.log("\n✅ dsh-ui 设置更新行、消息协议和握手前可见性验证通过。");
}

void main();
