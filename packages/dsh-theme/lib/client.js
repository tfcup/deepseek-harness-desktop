// dsh-theme 客户端 bundle（浏览器侧，官方 wire 格式：__ModuleLoader__.load({ id, factory })）
//
// 契约（对齐 dsh-client-ui-theme/lib/client.js 实测结构）：
//   1. 顶层调用 window.__ModuleLoader__.load({ id, factory })；
//   2. factory(require) 返回 module.exports，其中 apply(ctx) 是生命周期入口；
//   3. 框架物化时调用 apply(ctx)，ctx 提供 theme / slots / on / get 等客户端服务。
//
// 本包自包含（无 require 依赖）；主题注册走官方扩展点 ctx.theme.register（§2.5），
// 明暗双主题 + matchMedia 自动选择；CSS 兜底注入走官方加载路径的 <style data-plugin>。

window.__ModuleLoader__.load({
  id: "dsh-theme",
  factory: (_require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var DARK_ID = "dsh-desktop-dark";
    var LIGHT_ID = "dsh-desktop-light";
    var PLUGIN_CSS = "style[data-plugin-css='dsh-theme']";

    // 官方别名 token 覆盖（--dsw-alias-*，来自 dsh-client-ui-theme design-platform.css）
    var DARK_TOKENS = {
      "--dsw-alias-bg-base": "#0b0e14",
      "--dsw-alias-bg-layer-1": "#10151f",
      "--dsw-alias-bg-layer-2": "#161c29",
      "--dsw-alias-bg-layer-3": "#1d2434",
      "--dsw-alias-border-l1": "#1e2636",
      "--dsw-alias-border-l2": "#263047",
      "--dsw-alias-brand-primary": "#4f7cff",
      "--dsw-alias-brand-text": "#e8ecf4"
    };

    var LIGHT_TOKENS = {
      "--dsw-alias-bg-base": "#f5f7fa",
      "--dsw-alias-bg-layer-1": "#ffffff",
      "--dsw-alias-bg-layer-2": "#eef1f6",
      "--dsw-alias-bg-layer-3": "#e4e9f1",
      "--dsw-alias-border-l1": "#d8dee8",
      "--dsw-alias-border-l2": "#c3ccda",
      "--dsw-alias-brand-primary": "#4f7cff",
      "--dsw-alias-brand-text": "#1a2233"
    };

    // 兜底 CSS（超出 token 层的布局微调；幂等，避免 HMR 重复注入）
    function injectCss(css) {
      if (typeof document === "undefined") return;
      if (document.querySelector(PLUGIN_CSS)) return;
      var style = document.createElement("style");
      style.setAttribute("data-plugin", "dsh-theme");
      style.setAttribute("data-plugin-css", "dsh-theme");
      style.textContent = css;
      document.head.appendChild(style);
    }

    function themeService(ctx) {
      // 只走 ctx.get：Cordis 严格键校验下，未在 inject 声明的属性直接访问会抛
      // "cannot get property without inject"。取不到时返回 null，由 apply 跳过
      // 主题注册（降级不报错），绝不 fallback 到 ctx.theme。
      return ctx && typeof ctx.get === "function" ? ctx.get("theme") : null;
    }

    function apply(ctx) {
      // 主题注册（官方扩展点：Third-party themes are an extension point）
      var theme = themeService(ctx);
      if (theme && typeof theme.register === "function") {
        try {
          theme.register({ id: DARK_ID, colorScheme: "dark", tokens: DARK_TOKENS });
          theme.register({ id: LIGHT_ID, colorScheme: "light", tokens: LIGHT_TOKENS });
        } catch (e) {
          // 重复注册（HMR/重挂载）抛错，忽略即可（幂等）
        }
        // 自动选择：跟随系统（无 matchMedia 时保持官方默认，不强制）
        if (typeof matchMedia !== "undefined" && typeof theme.setTheme === "function") {
          var dark = matchMedia("(prefers-color-scheme: dark)").matches;
          theme.setTheme(dark ? DARK_ID : LIGHT_ID);
        }
      }
      // 兜底 CSS 注入（官方加载路径的 <style data-plugin> 标签）
      injectCss(
        "::-webkit-scrollbar{width:8px}" +
          "::-webkit-scrollbar-thumb{background:rgba(127,140,168,.35);border-radius:4px}"
      );
    }

    // 声明注入 theme 服务：Cordis 会等官方 ThemeRuntime 就绪后再 apply，消除
    // 加载时序竞态（此前无声明时，官方主题服务注册晚于本插件即抛
    // "cannot get property 'theme' without inject"）。对齐官方 dsh-client-ui-theme
    // 的 exports.inject = [...] 数组形式。
    var inject = ["theme"];

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
