// dsh-ui 客户端 bundle（浏览器侧，官方 wire 格式：__ModuleLoader__.load）。
//
// 这个插件只通过 DeepSeek Harness 的公开 slot 扩展界面：
//   - sidebar.footer.action：保留桌面工具入口；
//   - settings.general.item：在 Harness 自带“设置 > 常规”中提供 App 更新入口。
//
// Harness 页面运行在 127.0.0.1 iframe 中，不能直接调用 Tauri API。更新操作通过
// postMessage 发给桌面父窗口；父窗口必须校验 iframe window 和 origin 后才会执行。

window.__ModuleLoader__.load({
  id: "dsh-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = null;
    var primitives = {};
    try {
      React = require("react");
    } catch (error) {
      React = null;
    }
    try {
      primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    } catch (error) {
      primitives = {};
    }

    var REQUEST_TYPE = "dsh-desktop:update-request-v1";
    var STATE_TYPE = "dsh-desktop:update-state-v1";
    var LOCALE_NAMESPACE = "desktop-update";

    var zh = {
      title: "应用更新",
      current: "当前版本",
      latest: "最新版本",
      check: "检查更新",
      install: "下载并安装",
      restart: "立即重启",
      checking: "正在检查更新…",
      upToDate: "已是最新版本",
      available: "发现新版本",
      downloading: "正在下载",
      installing: "正在安装更新…",
      restartRequired: "更新已安装，重启后生效",
      retry: "重试",
    };
    var en = {
      title: "App Update",
      current: "Current version",
      latest: "Latest version",
      check: "Check for Updates",
      install: "Download and Install",
      restart: "Restart Now",
      checking: "Checking for updates…",
      upToDate: "You're up to date",
      available: "Update available",
      downloading: "Downloading",
      installing: "Installing update…",
      restartRequired: "Update installed. Restart to apply it.",
      retry: "Retry",
    };

    /** 注入与 Harness 官方设置行一致的轻量样式，且保证热重载时幂等。 */
    function ensureStyles() {
      if (document.querySelector('style[data-plugin-css="dsh-ui/desktop-update"]')) return;
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-ui";
      tag.dataset.pluginCss = "dsh-ui/desktop-update";
      tag.textContent = [
        ".dsh-desktop-update{display:flex;flex-direction:column;gap:10px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}",
        ".dsh-desktop-update__head{display:flex;align-items:center;justify-content:space-between;gap:16px}",
        ".dsh-desktop-update__title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
        ".dsh-desktop-update__meta{display:grid;grid-template-columns:minmax(100px,auto) minmax(0,1fr);gap:4px 16px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}",
        ".dsh-desktop-update__value{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}",
        ".dsh-desktop-update__status{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}",
        ".dsh-desktop-update__error{color:var(--dsw-alias-label-danger,#d64045)}",
        ".dsh-desktop-update__notes{max-height:88px;overflow:auto;white-space:pre-wrap;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
        ".dsh-desktop-update__progress{height:4px;overflow:hidden;border-radius:2px;background:var(--dsw-alias-bg-module-platform)}",
        ".dsh-desktop-update__bar{height:100%;background:var(--dsw-alias-interactive-primary);transition:width .18s ease}",
        ".dsh-desktop-update__button{display:inline-flex;min-height:32px;align-items:center;justify-content:center;gap:6px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}",
        ".dsh-desktop-update__button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
        ".dsh-desktop-update__button:disabled{cursor:not-allowed;opacity:.55}",
      ].join("");
      document.head.appendChild(tag);
    }

    /** 根据文档语言提供无 locale seat 时的降级翻译。 */
    function fallbackTranslate(key) {
      var dictionary = document.documentElement.lang.toLowerCase().startsWith("zh") ? zh : en;
      return dictionary[key] || key;
    }

    /** 将更新动作发送给 Tauri 父窗口；父窗口会进行严格来源校验。 */
    function requestDesktopUpdate(action) {
      if (window.parent === window) return;
      window.parent.postMessage({ type: REQUEST_TYPE, action: action }, "*");
    }

    /** 为当前状态选择按钮文案、动作和图标。 */
    function actionForState(state, t) {
      if (state.phase === "available") {
        return { label: t("install"), action: "install", Icon: primitives.IconDownloadOutline16 };
      }
      if (state.phase === "restart-required") {
        return { label: t("restart"), action: "relaunch", Icon: primitives.IconRefreshOutline16 };
      }
      if (state.phase === "error") {
        return { label: t("retry"), action: "check", Icon: primitives.IconRefreshOutline16 };
      }
      return { label: t("check"), action: "check", Icon: primitives.IconRefreshOutline16 };
    }

    /** 将状态机阶段转换为用户可读文本。 */
    function statusText(state, t) {
      if (state.phase === "checking") return t("checking");
      if (state.phase === "up-to-date") return t("upToDate");
      if (state.phase === "available") return t("available");
      if (state.phase === "downloading") return t("downloading") + " " + Math.round(state.progress || 0) + "%";
      if (state.phase === "installing") return t("installing");
      if (state.phase === "restart-required") return t("restartRequired");
      if (state.phase === "error") return state.error || t("retry");
      return "";
    }

    /**
     * Harness“设置 > 常规”中的 App 更新行。
     * 未收到可信桌面父窗口握手前不渲染，避免普通浏览器出现不可用的原生操作。
     */
    function DesktopUpdateRow(props) {
      var t = typeof props.t === "function" ? props.t : fallbackTranslate;
      var stateTuple = React.useState({ phase: "idle", connected: false, progress: 0 });
      var state = stateTuple[0];
      var setState = stateTuple[1];

      React.useEffect(function subscribeDesktopState() {
        if (window.parent === window) return undefined;

        /** 只接受直接父窗口发送的版本化更新状态。 */
        function onMessage(event) {
          if (event.source !== window.parent) return;
          var data = event.data;
          if (!data || data.type !== STATE_TYPE || data.desktop !== true) return;
          setState(data);
        }

        window.addEventListener("message", onMessage);
        requestDesktopUpdate("get-state");
        return function unsubscribeDesktopState() {
          window.removeEventListener("message", onMessage);
        };
      }, []);

      if (!state.connected) return null;

      var action = actionForState(state, t);
      var busy = state.phase === "checking" || state.phase === "downloading" || state.phase === "installing";
      var status = statusText(state, t);
      var children = [];

      children.push(React.createElement("div", { className: "dsh-desktop-update__head", key: "head" },
        React.createElement("div", { className: "dsh-desktop-update__title" }, t("title")),
        React.createElement("button", {
          type: "button",
          className: "dsh-desktop-update__button",
          disabled: busy,
          onClick: function handleUpdateAction() { requestDesktopUpdate(action.action); },
        },
        action.Icon ? React.createElement(action.Icon, { size: 16 }) : null,
        action.label)));

      children.push(React.createElement("div", { className: "dsh-desktop-update__meta", key: "meta" },
        React.createElement("span", null, t("current")),
        React.createElement("span", { className: "dsh-desktop-update__value" }, state.currentVersion || "-"),
        state.latestVersion ? React.createElement("span", null, t("latest")) : null,
        state.latestVersion ? React.createElement("span", { className: "dsh-desktop-update__value" }, state.latestVersion) : null));

      if (status) {
        children.push(React.createElement("div", {
          className: "dsh-desktop-update__status" + (state.phase === "error" ? " dsh-desktop-update__error" : ""),
          role: state.phase === "error" ? "alert" : "status",
          key: "status",
        }, status));
      }
      if (state.phase === "downloading") {
        children.push(React.createElement("div", { className: "dsh-desktop-update__progress", key: "progress" },
          React.createElement("div", {
            className: "dsh-desktop-update__bar",
            style: { width: Math.max(0, Math.min(100, state.progress || 0)) + "%" },
          })));
      }
      if (state.notes) {
        children.push(React.createElement("div", { className: "dsh-desktop-update__notes", key: "notes" }, state.notes));
      }

      return React.createElement("div", { className: "dsh-desktop-update" }, children);
    }

    /** 注册插件自己的中英文文案；旧 Harness 缺少 locale 服务时允许降级。 */
    function registerLocale(ctx) {
      var locale = ctx && ctx.get ? ctx.get("locale") : null;
      if (!locale || typeof locale.register !== "function") return;
      if (typeof ctx.effect === "function") {
        ctx.effect(function registerDesktopUpdateLocale() {
          return locale.register(LOCALE_NAMESPACE, { zh: zh, en: en });
        }, "dsh-ui: desktop update dictionaries");
      } else {
        locale.register(LOCALE_NAMESPACE, { zh: zh, en: en });
      }
    }

    /** 注册桌面专用的官方 Slot 扩展，不直接修改 Harness 上游组件。 */
    function apply(ctx) {
      if (!React) return;
      var slots = ctx && (ctx.get ? ctx.get("slots") : null);
      if (!slots || typeof slots.inject !== "function") return;

      ensureStyles();
      registerLocale(ctx);

      slots.inject("sidebar.footer.action", function registerDesktopSettingsAction() {
        slots.register(
          { name: "sidebar.footer.action", id: "dsh-desktop-settings" },
          function DesktopSettingsButton() {
            return React.createElement(
              "button",
              {
                type: "button",
                onClick: function openDesktopSettings() {
                  window.parent.postMessage({ type: "dsh-desktop:open-settings" }, "*");
                },
              },
              "⚙ 桌面设置",
            );
          },
        );
      });

      slots.inject("settings.general.item", function registerDesktopUpdateRow() {
        slots.register(
          {
            name: "settings.general.item",
            id: "desktop-app-update",
            order: 100,
            locale: LOCALE_NAMESPACE,
          },
          DesktopUpdateRow,
        );
      });
    }

    /** Client Plugin 无额外注入阶段。 */
    function inject(_ctx) {}

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
