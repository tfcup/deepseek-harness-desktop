//! dsh-ui 客户端插件行为测试（无浏览器，stub 环境）。
//!
//! 验证 Harness 字体/更新设置行通过官方 slot 注册，并且只发送版本化 postMessage
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
  let forcedStates: unknown[] | null = null;
  let forcedIndex = 0;
  return {
    createElement: (type: unknown, props: unknown, ...children: unknown[]): StubElement => ({
      kind: "element",
      type,
      props: (props ?? {}) as Record<string, unknown>,
      children,
    }),
    useState: (initial: unknown) => {
      if (forcedStates) return [forcedStates[forcedIndex++], () => undefined];
      if (initial && typeof initial === "object" && "connected" in initial && "phase" in initial) {
        return [{
          connected,
          desktop: true,
          phase: "available",
          currentVersion: "0.1.13",
          latestVersion: "0.1.14",
          progress: 0,
        }, () => undefined];
      }
      return [typeof initial === "function" ? (initial as () => unknown)() : initial, () => undefined];
    },
    useEffect: (effect: () => void | (() => void)) => effect(),
    /** 为单个无 renderer 的组件调用提供确定的 hook 状态。 */
    forceStates: (states: unknown[] | null) => {
      forcedStates = states;
      forcedIndex = 0;
    },
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

/** 收集元素树中所有匹配节点，用于验证搜索后的字体选项集合。 */
function findElements(value: unknown, predicate: (element: StubElement) => boolean): StubElement[] {
  const matches: StubElement[] = [];
  if (Array.isArray(value)) {
    for (const child of value) matches.push(...findElements(child, predicate));
    return matches;
  }
  if (!value || typeof value !== "object" || (value as StubElement).kind !== "element") return matches;
  const element = value as StubElement;
  if (predicate(element)) matches.push(element);
  for (const child of element.children) matches.push(...findElements(child, predicate));
  return matches;
}

/** 提取 stub React 子树中的可见文本，避免元素包装影响选项断言。 */
function visibleText(value: unknown): string {
  if (Array.isArray(value)) return value.map(visibleText).join("");
  if (!value || typeof value !== "object") return value == null ? "" : String(value);
  if ((value as StubElement).kind !== "element") return "";
  return (value as StubElement).children.map(visibleText).join("");
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
  const styleValues = new Map<string, string>();
  const bodyStyleValues = new Map<string, string>();
  const styleElements: Array<{ dataset: Record<string, string>; textContent: string }> = [];
  const rootAttributes = new Set<string>();
  const settingsWrites: Array<{ field: string; value: unknown }> = [];
  const constructedFontFaces: Array<{ family: string; source: string }> = [];
  const activeFontFaces = new Set<StubFontFace>();

  /** 模拟浏览器 FontFace API，并记录插件实际加载的本机 face。 */
  class StubFontFace {
    family: string;
    source: string;

    constructor(family: string, source: string) {
      this.family = family;
      this.source = source;
      constructedFontFaces.push({ family, source });
    }

    /** 本机字体测试无需真实排版，直接返回已加载实例。 */
    load(): Promise<StubFontFace> {
      return Promise.resolve(this);
    }
  }

  (globalThis as unknown as Record<string, unknown>).FontFace = StubFontFace;

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
    documentElement: {
      lang: "zh-CN",
      style: {
        setProperty: (name: string, value: string) => styleValues.set(name, value),
        removeProperty: (name: string) => styleValues.delete(name),
      },
      setAttribute: (name: string) => rootAttributes.add(name),
      removeAttribute: (name: string) => rootAttributes.delete(name),
    },
    // Harness 官方排版 token 挂在 body，测试也必须保留这个级联层级。
    body: {
      style: {
        setProperty: (name: string, value: string) => bodyStyleValues.set(name, value),
        removeProperty: (name: string) => bodyStyleValues.delete(name),
      },
    },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: "" }),
    head: {
      appendChild: (element: { dataset: Record<string, string>; textContent: string }) => {
        styleElements.push(element);
      },
    },
    fonts: {
      add: (fontFace: StubFontFace) => activeFontFaces.add(fontFace),
      delete: (fontFace: StubFontFace) => activeFontFaces.delete(fontFace),
    },
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
    settingsScope: {
      bind: () => ({
        getSnapshot: () => ({
          status: "ready",
          writable: true,
          value: {
            uiFamily: "PingFang SC",
            uiPostscriptName: "PingFangSC-Medium",
            uiWeight: 500,
            uiSize: 18,
            codeFamily: "JetBrains Mono",
            codePostscriptName: "JetBrainsMono-Regular",
            codeWeight: 400,
            codeSize: 15,
          },
        }),
        subscribe: () => () => undefined,
        set: (field: string, value: unknown) => {
          settingsWrites.push({ field, value });
          return Promise.resolve();
        },
      }),
    },
  };

  console.log("[1] 注册 Harness 常规设置中的字体与 App 更新行…");
  if (moduleExports.inject.join(",") !== "slots,locale,connection,remote,settingsScope") {
    fail(`Cordis Service 注入声明异常: ${JSON.stringify(moduleExports.inject)}`);
  }
  moduleExports.apply(context);
  // FontFace.load() 是异步接口；等待保存的 UI/代码 face 加入 document.fonts。
  await Promise.resolve();
  await Promise.resolve();
  if (registrations.length !== 2) fail(`slots.register 调用次数异常: ${registrations.length}`);
  const fontRow = registrations.find((item) => item.id === "desktop-fonts");
  const updateRow = registrations.find((item) => item.id === "desktop-app-update");
  if (!fontRow || fontRow.order !== 20) fail("Harness 字体设置行注册异常");
  if (!updateRow || updateRow.id !== "desktop-app-update" || updateRow.order !== 100) {
    fail("Harness 设置更新行注册异常");
  }

  console.log("[2] 持久化字体在设置页打开前应用到 Harness 官方变量…");
  if (!styleValues.get("--dsw-font-family")?.includes("DSH Desktop selected UI PingFangSC-Medium")) {
    fail("UI 虚拟字体家族没有应用到 --dsw-font-family");
  }
  if (!styleValues.get("--ds-font-family-code")?.includes("DSH Desktop selected Code JetBrainsMono-Regular")) {
    fail("编程虚拟字体家族没有应用到 --ds-font-family-code");
  }
  if (!bodyStyleValues.get("--dsw-font-family")?.includes("DSH Desktop selected UI PingFangSC-Medium") ||
      !bodyStyleValues.get("--ds-font-family-code")?.includes("DSH Desktop selected Code JetBrainsMono-Regular")) {
    fail("字体家族没有同时应用到 html 和 body");
  }
  if (styleValues.get("--dsw-font-markdown-base-font-size") !== "18px" ||
      styleValues.get("--dsw-font-markdown-base") !== "18px/28px var(--dsw-font-family)" ||
      bodyStyleValues.get("--dsw-font-markdown-base-font-size") !== "18px") {
    fail("界面字号没有同时应用到 Markdown 正文的拆分和 shorthand token");
  }
  if (styleValues.get("--dsw-font-s-14-font-size") !== "17px" ||
      styleValues.get("--dsw-font-xs-13-font-size") !== "15px") {
    fail("界面语义字号没有按 14px 基准表等比缩放");
  }
  if (styleValues.get("--dsw-font-markdown-code-block-font-size") !== "15px" ||
      styleValues.get("--dsw-font-markdown-code-font-size") !== "16px") {
    fail("编程字号没有保持代码块与行内代码的现有层级");
  }
  if (!constructedFontFaces.some((face) => face.source.includes("PingFangSC-Medium")) ||
      !constructedFontFaces.some((face) => face.source.includes("JetBrainsMono-Regular"))) {
    fail("字体目录返回前没有用已保存 face 建立虚拟字体家族");
  }
  const pluginStyle = styleElements.find((element) =>
    element.dataset.pluginCss === "dsh-ui/desktop-update");
  if (pluginStyle?.textContent.includes("--dsh-desktop-ui-font-weight") ||
      pluginStyle?.textContent.includes("--dsh-desktop-code-font-weight")) {
    fail("具体 face 模式不应再全局覆盖组件语义字重");
  }
  const fontSlot = fontRow.component({ t: (key: string) => key }) as StubElement;
  if (typeof fontSlot.type !== "function") fail("字体设置 slot 未渲染 React 组件");
  const fontTree = (fontSlot.type as (props: Record<string, unknown>) => unknown)(fontSlot.props);
  const fontRequests = postMessages as Array<{ type?: string; action?: string }>;
  if (!fontRequests.some((message) => message.type === "dsh-desktop:font-request-v1" && message.action === "list")) {
    fail("字体设置行挂载时未请求本机字体目录");
  }

  const families = [
    {
      family: "Arial",
      monospace: false,
      faces: [{ postscriptName: "ArialMT", fullName: "Arial Regular", weight: 400, weightLabel: "Regular", style: "normal" }],
    },
    {
      family: "PingFang SC",
      monospace: false,
      faces: [
        { postscriptName: "PingFangSC-Regular", fullName: "PingFang SC Regular", weight: 400, weightLabel: "Regular", style: "normal" },
        { postscriptName: "PingFangSC-Medium", fullName: "PingFang SC Medium", weight: 500, weightLabel: "Medium", style: "normal" },
        { postscriptName: "PingFangSC-MediumItalic", fullName: "PingFang SC Medium Italic", weight: 500, weightLabel: "Medium Italic", style: "italic" },
      ],
    },
  ];
  for (const listener of messageListeners) {
    listener({
      source: parentWindow,
      data: { type: "dsh-desktop:font-state-v1", desktop: true, phase: "ready", families },
    });
  }
  await Promise.resolve();
  await Promise.resolve();
  const uiFontFaces = constructedFontFaces.filter((face) => face.family.startsWith("DSH Desktop selected UI "));
  if (!uiFontFaces.some((face) =>
    face.family.endsWith("PingFangSC-Medium") && face.source.includes("PingFang SC Medium"))) {
    fail("字体目录就绪后没有按 PostScript 名和完整名称加载所选 UI face");
  }
  if (uiFontFaces.some((face) =>
    face.source.includes("PingFangSC-Regular") || face.source.includes("PingFangSC-MediumItalic"))) {
    fail("UI 虚拟字体不应加载同家族中未选中的 face");
  }
  const uiControls = findElement(fontTree, (element) =>
    typeof element.type === "function" && element.props.kind === "ui");
  if (!uiControls || typeof uiControls.type !== "function") fail("UI 字体控件缺失");
  const controlsTree = (uiControls.type as (props: Record<string, unknown>) => unknown)({
    ...uiControls.props,
    families,
  });
  const weightSelect = findElement(controlsTree, (element) => element.type === "select");
  const weightLabels = findElements(weightSelect, (element) => element.type === "option")
    .map(visibleText);
  if (!weightLabels.includes("Medium") || !weightLabels.includes("Medium Italic")) {
    fail(`字重菜单未使用字体真实成员: ${weightLabels.join(", ")}`);
  }
  (weightSelect?.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: "PingFangSC-MediumItalic" },
  });
  if (settingsWrites.some((write) => write.field.startsWith("code")) ||
      !settingsWrites.some((write) => write.field === "uiPostscriptName" && write.value === "PingFangSC-MediumItalic")) {
    fail("UI 字体选择没有独立保存精确 PostScript face");
  }

  const familyPicker = findElement(controlsTree, (element) =>
    typeof element.type === "function" && element.props.kind === "ui");
  if (!familyPicker || typeof familyPicker.type !== "function") fail("字体家族菜单缺失");
  react.forceStates([true, "ping"]);
  const searchTree = (familyPicker.type as (props: Record<string, unknown>) => unknown)(familyPicker.props);
  react.forceStates(null);
  const searchedFamilies = findElements(searchTree, (element) => element.props.role === "option")
    .map(visibleText);
  if (!searchedFamilies.some((label) => label.includes("PingFang SC")) || searchedFamilies.some((label) => label.includes("Arial"))) {
    fail(`字体搜索结果异常: ${searchedFamilies.join(", ")}`);
  }
  react.forceStates([true, ""]);
  const fullMenuTree = (familyPicker.type as (props: Record<string, unknown>) => unknown)(familyPicker.props);
  react.forceStates(null);
  const refreshButton = findElement(fullMenuTree, (element) => element.props["aria-label"] === "refreshFonts");
  (refreshButton?.props.onClick as (() => void) | undefined)?.();
  if (!fontRequests.some((message) => message.type === "dsh-desktop:font-request-v1" && message.action === "refresh") ||
      settingsWrites.length !== 3) {
    fail("重新扫描字体应只发 refresh 请求，不能覆盖已保存选择");
  }

  console.log("[3] UI/编程字号独立保存，且不设产品上限…");
  const uiSizeControl = findElement(fontTree, (element) =>
    typeof element.type === "function" && element.props.label === "uiFontSize");
  if (!uiSizeControl || typeof uiSizeControl.type !== "function") fail("界面字号控件缺失");
  react.forceStates(["37"]);
  const uiSizeTree = (uiSizeControl.type as (props: Record<string, unknown>) => unknown)(uiSizeControl.props);
  react.forceStates(null);
  const uiSizeInput = findElement(uiSizeTree, (element) => element.type === "input");
  (uiSizeInput?.props.onBlur as (() => void) | undefined)?.();
  if (!settingsWrites.some((write) => write.field === "uiSize" && write.value === 37) ||
      styleValues.get("--dsw-font-markdown-base-font-size") !== "37px" ||
      styleValues.get("--dsw-font-markdown-code-block-font-size") !== "15px") {
    fail("界面字号应允许超过预设范围，并且不影响独立的编程字号");
  }
  const writesAfterValidSize = settingsWrites.length;
  react.forceStates(["-2"]);
  const invalidSizeTree = (uiSizeControl.type as (props: Record<string, unknown>) => unknown)(uiSizeControl.props);
  react.forceStates(null);
  const invalidSizeInput = findElement(invalidSizeTree, (element) => element.type === "input");
  (invalidSizeInput?.props.onBlur as (() => void) | undefined)?.();
  if (settingsWrites.length !== writesAfterValidSize) fail("非正字号不应写入设置");

  const systemOption = findElements(fullMenuTree, (element) => element.props.role === "option")
    .find((option) => visibleText(option) === "systemDefault");
  if (!systemOption) fail("字体家族菜单缺少系统默认选项");
  (systemOption.props.onClick as () => void)();
  await Promise.resolve();
  await Promise.resolve();
  if (styleValues.has("--dsw-font-family") || !styleValues.has("--ds-font-family-code")) {
    fail("恢复 UI 系统默认时不应清除独立的编程字体覆盖");
  }
  if (bodyStyleValues.has("--dsw-font-family") || !bodyStyleValues.has("--ds-font-family-code")) {
    fail("恢复 UI 系统默认时 html/body 字体状态不一致");
  }
  if ([...activeFontFaces].some((face) => face.family.startsWith("DSH Desktop selected UI ")) ||
      ![...activeFontFaces].some((face) => face.family.startsWith("DSH Desktop selected Code "))) {
    fail("恢复 UI 系统默认时只应卸载 UI 虚拟字体");
  }

  console.log("[4] 更新行通过版本化 postMessage 发出检查/安装请求…");
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

  console.log("[5] 桌面父窗口握手前仍展示更新入口…");
  const disconnectedReact = stubReact(false);
  const disconnectedExports = entry.factory((specifier) => {
    if (specifier === "react") return disconnectedReact;
    if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return {};
    throw new Error(`unexpected require: ${specifier}`);
  }) as { apply: (ctx: unknown) => void };
  const registrationCount = registrations.length;
  disconnectedExports.apply(context);
  const disconnectedRegistration = registrations
    .slice(registrationCount)
    .find((item) => item.id === "desktop-app-update");
  const disconnectedRow = disconnectedRegistration?.component({ t: (key: string) => key });
  if (!findElement(disconnectedRow, (element) => element.type === "button")) {
    fail("桌面 iframe 握手前更新行不应静默消失");
  }

  if (settingsWrites.length !== 7 || settingsWrites.some((write) => write.field.startsWith("code"))) {
    fail(`UI 字体和字号操作应只写入 UI 组字段: ${JSON.stringify(settingsWrites)}`);
  }
  console.log("\n✅ dsh-ui 字体/更新设置行、消息协议和持久化字体应用验证通过。");
}

void main();
