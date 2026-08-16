// dsh-ui 客户端 bundle（浏览器侧，官方 wire 格式：__ModuleLoader__.load({ id, factory })）
//
// 契约（SKILL.md "Register Client UI" 实测规范）：
//   - 用 ctx.get('slots') 获取 slot 服务（无则跳过，不阻塞）；
//   - slots.inject('slot.name', cb) 等待官方 slot 声明后再注册；
//   - slots.register({ name, id }, Component) —— Component 是 React 组件
//     （React 经 loader 提供，与官方 bundle require("react") 同路径）。
//
// 首个 UI：向官方 slot `sidebar.footer.action`（侧边栏小动作）注入"桌面设置"按钮，
// 点击向父窗口（桌面外壳）postMessage，外壳侧后续监听（Phase 5 UI 集成）。

window.__ModuleLoader__.load({
  id: "dsh-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // React 经 loader 提供（与官方 bundle 相同模式）；不可用时优雅降级（不注册 UI）
    var React = null;
    try {
      React = require("react");
    } catch (e) {
      React = null;
    }

    function apply(ctx) {
      if (!React) return;
      var slots = ctx && (ctx.get ? ctx.get("slots") : null);
      if (!slots || typeof slots.inject !== "function") return;

      slots.inject("sidebar.footer.action", function () {
        slots.register(
          { name: "sidebar.footer.action", id: "dsh-desktop-settings" },
          function DesktopSettingsButton() {
            return React.createElement(
              "button",
              {
                type: "button",
                onClick: function () {
                  try {
                    window.parent.postMessage(
                      { type: "dsh-desktop:open-settings" },
                      "*"
                    );
                  } catch (e) {
                    // 跨源/不可用时忽略
                  }
                },
              },
              "⚙ 桌面设置"
            );
          }
        );
      });
    }

    function inject(_ctx) {}

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
