// dsh-ui 客户端 bundle（浏览器侧，官方 wire 格式：__ModuleLoader__.load）。
//
// 这个插件只通过 DeepSeek Harness 的公开 slot 扩展界面：
//   - settings.general.item：提供本机字体选择和唯一的 App 更新入口。
//
// Harness 页面运行在 127.0.0.1 iframe 中，不能直接调用 Tauri API。更新与字体请求
// 通过 postMessage 发给桌面父窗口；父窗口必须校验 iframe window 和 origin 后才会执行。

window.__ModuleLoader__.load({
  id: "dsh-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // React 和 primitives 都是 Harness Web 启动器提供的静态模块。依赖缺失时应让
    // Client Plugin 明确启动失败，而不是静默隐藏更新入口并让 Compatibility Gate 误判。
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    var REQUEST_TYPE = "dsh-desktop:update-request-v1";
    var STATE_TYPE = "dsh-desktop:update-state-v1";
    var FONT_REQUEST_TYPE = "dsh-desktop:font-request-v1";
    var FONT_STATE_TYPE = "dsh-desktop:font-state-v1";
    var FONT_SETTINGS_NAMESPACE = "desktop-fonts";
    var UI_FONT_ALIAS_PREFIX = "DSH Desktop selected UI ";
    var CODE_FONT_ALIAS_PREFIX = "DSH Desktop selected Code ";
    var availableFontFamilies = [];
    var activeFontSettings = null;
    var loadedFontFaces = { ui: null, code: null };
    var fontFaceLoadRevision = { ui: 0, code: 0 };
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
      fontTitle: "字体",
      uiFont: "界面字体",
      codeFont: "编程字体",
      uiFontSize: "界面字号",
      codeFontSize: "编程字号",
      systemDefault: "系统默认",
      searchFonts: "搜索字体",
      refreshFonts: "重新扫描本机字体",
      loadingFonts: "正在读取本机字体…",
      noFonts: "没有匹配的字体",
      unavailableFont: "已选字体当前不可用，已回退到系统字体",
      monospace: "等宽",
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
      fontTitle: "Fonts",
      uiFont: "Interface Font",
      codeFont: "Code Font",
      uiFontSize: "Interface Size",
      codeFontSize: "Code Size",
      systemDefault: "System Default",
      searchFonts: "Search fonts",
      refreshFonts: "Rescan local fonts",
      loadingFonts: "Reading local fonts…",
      noFonts: "No matching fonts",
      unavailableFont: "The selected font is unavailable; using the system fallback",
      monospace: "Mono",
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
        ".dsh-desktop-update__title{color:var(--dsw-alias-label-primary);font-size:var(--dsw-font-s-14-font-size,14px);font-weight:400;line-height:var(--dsw-font-s-14-line-height,22px)}",
        ".dsh-desktop-update__meta{display:grid;grid-template-columns:minmax(100px,auto) minmax(0,1fr);gap:4px 16px;color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xs-13-font-size,13px);line-height:var(--dsw-font-xs-13-line-height,20px)}",
        ".dsh-desktop-update__value{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}",
        ".dsh-desktop-update__status{color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xs-13-font-size,13px);line-height:var(--dsw-font-xs-13-line-height,20px)}",
        ".dsh-desktop-update__error{color:var(--dsw-alias-label-danger,#d64045)}",
        ".dsh-desktop-update__notes{max-height:88px;overflow:auto;white-space:pre-wrap;color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px)}",
        ".dsh-desktop-update__progress{height:4px;overflow:hidden;border-radius:2px;background:var(--dsw-alias-bg-module-platform)}",
        ".dsh-desktop-update__bar{height:100%;background:var(--dsw-alias-interactive-primary);transition:width .18s ease}",
        ".dsh-desktop-update__button{display:inline-flex;min-height:32px;align-items:center;justify-content:center;gap:6px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsw-font-xs-13-font-size,13px);line-height:var(--dsw-font-xs-13-line-height,20px);cursor:pointer}",
        ".dsh-desktop-update__button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
        ".dsh-desktop-update__button:disabled{cursor:not-allowed;opacity:.55}",
        ".dsh-desktop-fonts{display:flex;flex-direction:column;gap:14px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}",
        ".dsh-desktop-fonts__title{color:var(--dsw-alias-label-primary);font-size:var(--dsw-font-s-14-font-size,14px);font-weight:400;line-height:var(--dsw-font-s-14-line-height,22px)}",
        ".dsh-desktop-fonts__row{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,2.3fr);align-items:center;gap:16px}",
        ".dsh-desktop-fonts__label{color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xs-13-font-size,13px);line-height:var(--dsw-font-xs-13-line-height,20px)}",
        ".dsh-desktop-fonts__controls{display:grid;grid-template-columns:minmax(150px,1fr) minmax(116px,.48fr);gap:8px;min-width:0}",
        ".dsh-desktop-fonts__size-controls{display:flex;justify-content:flex-end}",
        ".dsh-font-size-input{display:flex;width:116px;height:36px;align-items:center;border:1px solid transparent;border-radius:18px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);overflow:hidden}",
        ".dsh-font-size-input:focus-within{border-color:var(--dsw-alias-state-business-primary)}",
        ".dsh-font-size-input input{box-sizing:border-box;min-width:0;height:100%;flex:1;border:0;background:transparent;color:inherit;font:inherit;font-size:var(--dsw-font-s-14-font-size,14px);line-height:var(--dsw-font-s-14-line-height,22px);padding:0 4px 0 13px;outline:none}",
        ".dsh-font-size-input__unit{flex:none;padding-right:13px;color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xs-13-font-size,13px)}",
        ".dsh-font-picker{position:relative;min-width:0}",
        ".dsh-font-picker__trigger,.dsh-font-picker__weight{box-sizing:border-box;width:100%;height:36px;border:1px solid transparent;border-radius:18px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsw-font-s-14-font-size,14px);line-height:var(--dsw-font-s-14-line-height,22px);cursor:pointer}",
        ".dsh-font-picker__trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 13px;text-align:left}",
        ".dsh-font-picker__trigger:hover,.dsh-font-picker__weight:hover{background:var(--dsw-alias-interactive-bg-hover)}",
        ".dsh-font-picker__trigger:disabled,.dsh-font-picker__weight:disabled{cursor:not-allowed;opacity:.55}",
        ".dsh-font-picker__name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".dsh-font-picker__chevron{flex:none;color:var(--dsw-alias-label-secondary);font-size:16px}",
        ".dsh-font-picker__weight{appearance:none;padding:0 30px 0 13px;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 16px) 15px,calc(100% - 11px) 15px;background-size:5px 5px;background-repeat:no-repeat}",
        ".dsh-font-picker__menu{position:absolute;z-index:80;top:calc(100% + 6px);left:0;width:max(100%,260px);overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-shadow-lv3);padding:6px}",
        ".dsh-font-picker__search-row{display:flex;align-items:center;gap:6px;padding-bottom:6px}",
        ".dsh-font-picker__search{box-sizing:border-box;min-width:0;height:32px;flex:1;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsw-font-xs-13-font-size,13px);padding:0 9px;outline:none}",
        ".dsh-font-picker__search:focus{border-color:var(--dsw-alias-state-business-primary)}",
        ".dsh-font-picker__refresh{width:32px;height:32px;flex:none;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:17px;cursor:pointer}",
        ".dsh-font-picker__refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
        ".dsh-font-picker__list{max-height:260px;overflow-y:auto}",
        ".dsh-font-picker__option{display:flex;width:100%;min-height:34px;align-items:center;justify-content:space-between;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);padding:6px 8px;text-align:left;font-size:var(--dsw-font-xs-13-font-size,13px);cursor:pointer}",
        ".dsh-font-picker__option:hover,.dsh-font-picker__option[aria-selected='true']{background:var(--dsw-alias-interactive-bg-hover)}",
        ".dsh-font-picker__badge{flex:none;border-radius:4px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);padding:1px 5px;font-size:var(--dsh-desktop-font-badge-size,10px);line-height:var(--dsh-desktop-font-badge-line-height,16px)}",
        ".dsh-font-picker__empty,.dsh-desktop-fonts__status{color:var(--dsw-alias-label-tertiary);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px)}",
        ".dsh-font-picker__empty{padding:10px 8px}",
        ".dsh-desktop-fonts__warning{color:var(--dsw-alias-state-warn-primary)}",
        "@media(max-width:720px){.dsh-desktop-fonts__row{grid-template-columns:1fr}.dsh-desktop-fonts__controls{grid-template-columns:minmax(0,1fr) minmax(108px,.48fr)}}",
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

    /** 请求父窗口返回本机字体目录；refresh=true 时让原生层绕过进程缓存。 */
    function requestFontCatalog(refresh) {
      if (window.parent === window) return;
      window.parent.postMessage({ type: FONT_REQUEST_TYPE, action: refresh ? "refresh" : "list" }, "*");
    }

    /** 将可能损坏的 settings 值收敛为客户端可安全使用的字体配置。 */
    function normalizeFontSettings(value) {
      var source = value && typeof value === "object" ? value : {};
      function text(field, fallback) {
        return typeof source[field] === "string" && source[field].length <= 200 ? source[field] : fallback;
      }
      function weight(field) {
        var candidate = Number(source[field]);
        return Number.isFinite(candidate) ? Math.max(1, Math.min(1000, Math.round(candidate))) : 400;
      }
      // 字号不设产品上的大小范围，仅拒绝 CSS 无法使用的非正数或非有限值。
      function size(field, fallback) {
        var candidate = Number(source[field]);
        return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
      }
      return {
        uiFamily: text("uiFamily", "system"),
        uiPostscriptName: text("uiPostscriptName", ""),
        uiWeight: weight("uiWeight"),
        uiSize: size("uiSize", 14),
        codeFamily: text("codeFamily", "system"),
        codePostscriptName: text("codePostscriptName", ""),
        codeWeight: weight("codeWeight"),
        codeSize: size("codeSize", 13),
      };
    }

    /** 生成只含受控字体名称和固定 fallback 的 CSS font-family 值。 */
    function fontStack(selection, code) {
      var fallback = code
        ? '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, Menlo, monospace'
        : '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
      var names = [];
      if (selection.postscriptName) names.push(JSON.stringify(selection.postscriptName));
      if (selection.family && selection.family !== "system") names.push(JSON.stringify(selection.family));
      names.push(fallback);
      return names.join(", ");
    }

    /** 为所选具体 face 生成独立别名，避免 CSS 字重重新匹配到同家族的其他成员。 */
    function selectedFontAlias(selection, code) {
      var prefix = code ? CODE_FONT_ALIAS_PREFIX : UI_FONT_ALIAS_PREFIX;
      return prefix + selection.postscriptName;
    }

    /** 返回只用于实际界面的虚拟字体栈；字体选择器预览仍直接使用具体 face。 */
    function virtualFontStack(selection, code) {
      var fallback = code
        ? '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, Menlo, monospace'
        : '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
      var names = [JSON.stringify(selectedFontAlias(selection, code))];
      if (selection.family && selection.family !== "system") names.push(JSON.stringify(selection.family));
      names.push(fallback);
      return names.join(", ");
    }

    /** 从字体目录取得所选 face 的完整名称；目录未就绪时仍可使用已保存的 PostScript 名。 */
    function selectedFaceInfo(selection) {
      var family = availableFontFamilies.find(function findFamily(candidate) {
        return candidate.family === selection.family;
      });
      var face = family && Array.isArray(family.faces)
        ? family.faces.find(function findFace(candidate) {
          return candidate.postscriptName === selection.postscriptName;
        })
        : null;
      if (face) return face;
      if (!selection.postscriptName) return null;
      return {
        postscriptName: selection.postscriptName,
        fullName: "",
      };
    }

    /** 从 document.fonts 移除上一项选择，保证切换时只保留当前 UI/代码 face。 */
    function removeLoadedFontFace(kind) {
      var loaded = loadedFontFaces[kind];
      if (loaded && document.fonts && typeof document.fonts.delete === "function") {
        document.fonts.delete(loaded);
      }
      loadedFontFaces[kind] = null;
    }

    /**
     * 仿照 Codex Desktop，仅把用户选中的具体 face 注册成虚拟字体。
     * 不声明 CSS weight/style，避免组件的 400/500/600 重新选中同家族的其他真实成员。
     */
    function loadSelectedFontFace(kind, selection) {
      var revision = ++fontFaceLoadRevision[kind];
      removeLoadedFontFace(kind);
      if (selection.family === "system" || !selection.postscriptName) return;
      if (typeof FontFace !== "function" || !document.fonts || typeof document.fonts.add !== "function") return;

      var face = selectedFaceInfo(selection);
      if (!face) return;
      var localNames = [face.postscriptName];
      if (face.fullName && face.fullName !== face.postscriptName) localNames.push(face.fullName);
      var source = localNames.map(function localSource(name) {
        return "local(" + JSON.stringify(name) + ")";
      }).join(", ");
      var loading;
      try {
        loading = new FontFace(selectedFontAlias(selection, kind === "code"), source).load();
      } catch (_) {
        return;
      }
      loading.then(function activateLoadedFace(loaded) {
        // 异步加载完成前可能已切换字体；过期结果不能重新覆盖新选择。
        if (revision !== fontFaceLoadRevision[kind]) return;
        document.fonts.add(loaded);
        loadedFontFaces[kind] = loaded;
      }).catch(function ignoreUnavailableLocalFace() {
        // CSS 字体栈会自然落到保存的家族名和系统字体，无需额外错误状态。
      });
    }

    /** 重新加载当前两项精确 face；只维护当前选择，不建立字体缓存。 */
    function reloadSelectedFontFaces(settings) {
      loadSelectedFontFace("ui", selectionFromSettings(settings, "ui"));
      loadSelectedFontFace("code", selectionFromSettings(settings, "code"));
    }

    /** 保存最新字体目录并重新加载当前选择，以便同时使用 PostScript 名和完整字体名。 */
    function updateAvailableFontFamilies(families) {
      if (!Array.isArray(families)) return;
      availableFontFamilies = families;
      if (activeFontSettings) reloadSelectedFontFaces(activeFontSettings);
    }

    /**
     * 将用户字号映射到 Harness 官方语义 token。同时覆盖 shorthand 和拆分字段，
     * 是因为不同官方组件会读取两种形态；不使用 DOM 选择器则可避免绑定上游压缩类名。
     */
    function applyFontSizeTokens(root, uiSize, codeSize) {
      var baseUiSize = 14;
      var uiScale = uiSize / baseUiSize;

      /**
       * 像 Codex Desktop 一样从 14px 基准表等比缩放并取整，避免小字号使用固定减法后
       * 层级差迅速扩大。用户输入本身不限范围，只保护派生 token 不变成非正数。
       */
      function scaledUiSize(baseSize) {
        // 正文 token 必须与用户输入完全一致；只对其他层级做 Codex 风格的像素取整。
        if (baseSize === baseUiSize) return uiSize;
        return Math.max(1, Math.round(baseSize * uiScale));
      }

      /** 代码字号保持独立；派生的行内/小型代码只做最低 CSS 有效性保护。 */
      function derivedCodeSize(offset) {
        return Math.max(1, codeSize + offset);
      }

      /** 写入一个 UI 语义 token，保留它原有的字重和斜体层级。 */
      function setUiToken(name, size, lineHeight, weight, style) {
        var prefix = "--dsw-font-" + name;
        var shorthand = (style === "italic" ? "italic " : "") +
          (weight === 400 ? "" : weight + " ") +
          size + "px/" + lineHeight + "px var(--dsw-font-family)";
        root.style.setProperty(prefix, shorthand);
        root.style.setProperty(prefix + "-font-size", size + "px");
        root.style.setProperty(prefix + "-line-height", lineHeight + "px");
      }

      /** 写入一个编程语义 token，代码区域始终使用独立的编程字体家族。 */
      function setCodeToken(name, size, lineHeight) {
        var prefix = "--dsw-font-" + name;
        root.style.setProperty(prefix, size + "px/" + lineHeight + "px var(--ds-font-family-code)");
        root.style.setProperty(prefix + "-font-size", size + "px");
        root.style.setProperty(prefix + "-line-height", lineHeight + "px");
      }

      // 基准表的前两个数字分别是 14px UI 下的字号和行高。字重/斜体仍保留 Harness 语义。
      var uiTokens = [
        ["markdown-h1", 24, 30, 700, "normal"],
        ["markdown-h2", 20, 25, 700, "normal"],
        ["markdown-h3", 18, 23, 700, "normal"],
        ["markdown-h4", 14, 22, 600, "normal"],
        ["markdown-base", 14, 22, 400, "normal"],
        ["markdown-base-strong", 14, 22, 600, "normal"],
        ["markdown-base-italic", 14, 22, 400, "italic"],
        ["markdown-base-strong-italic", 14, 22, 600, "italic"],
        ["markdown-table", 13, 21, 400, "normal"],
        ["markdown-table-head", 13, 21, 500, "normal"],
        ["markdown-small", 12, 20, 400, "normal"],
        ["markdown-small-strong", 12, 20, 600, "normal"],
        ["markdown-small-italic", 12, 20, 400, "italic"],
        ["markdown-small-strong-italic", 12, 20, 600, "italic"],
        ["xl-24", 24, 32, 600, "normal"],
        ["l-20", 20, 28, 500, "normal"],
        ["m-18", 18, 26, 500, "normal"],
        ["base-16", 14, 22, 400, "normal"],
        ["base-strong-16", 14, 22, 500, "normal"],
        ["s-14", 13, 20, 400, "normal"],
        ["s-strong-14", 13, 20, 500, "normal"],
        ["xs-13", 12, 18, 400, "normal"],
        ["xs-strong-13", 12, 18, 500, "normal"],
        ["xxs-12", 11, 16, 400, "normal"],
        ["xxs-strong-12", 11, 16, 500, "normal"],
        ["xxxs-11", 10, 14, 400, "normal"],
        ["xxxs-strong-11", 10, 14, 500, "normal"],
      ];
      uiTokens.forEach(function applyUiToken(token) {
        setUiToken(token[0], scaledUiSize(token[1]), scaledUiSize(token[2]), token[3], token[4]);
      });

      var inlineCodeSize = derivedCodeSize(1);
      var blockCodeSize = derivedCodeSize(0);
      var smallCodeSize = derivedCodeSize(-1);
      setCodeToken("markdown-code", inlineCodeSize, derivedCodeSize(9));
      setCodeToken("markdown-code-block", blockCodeSize, derivedCodeSize(9));
      setCodeToken("markdown-code-block-small", smallCodeSize, derivedCodeSize(5));

      // 徽标没有对应的官方 token，仅供桌面扩展自身的“等宽”标识跟随界面字号。
      var badgeSize = scaledUiSize(10);
      root.style.setProperty("--dsh-desktop-font-badge-size", badgeSize + "px");
      root.style.setProperty("--dsh-desktop-font-badge-line-height", scaledUiSize(14) + "px");
    }

    /** 将持久化配置映射到 Harness 官方字体和字号变量。 */
    function applyFontSettings(settings) {
      var root = document.documentElement;
      if (!root || !root.style) return;
      var normalized = normalizeFontSettings(settings);
      activeFontSettings = normalized;
      var ui = {
        family: normalized.uiFamily,
        postscriptName: normalized.uiPostscriptName,
        weight: normalized.uiWeight,
      };
      var code = {
        family: normalized.codeFamily,
        postscriptName: normalized.codePostscriptName,
        weight: normalized.codeWeight,
      };
      reloadSelectedFontFaces(normalized);

      var typographyRoots = [root];
      if (document.body && document.body.style && document.body !== root) typographyRoots.push(document.body);
      typographyRoots.forEach(function applyGlobalTypography(target) {
        // 同时写入 html/body：覆盖官方 body token，也让挂在根节点的浮层和对话框继承同一配置。
        if (ui.family === "system") target.style.removeProperty("--dsw-font-family");
        else target.style.setProperty("--dsw-font-family", virtualFontStack(ui, false));
        if (code.family === "system") target.style.removeProperty("--ds-font-family-code");
        else target.style.setProperty("--ds-font-family-code", virtualFontStack(code, true));
        applyFontSizeTokens(target, normalized.uiSize, normalized.codeSize);
      });
    }

    /** 读取 UI 或代码字体选择，避免两组控件交叉覆盖。 */
    function selectionFromSettings(settings, kind) {
      var prefix = kind === "code" ? "code" : "ui";
      return {
        family: settings[prefix + "Family"],
        postscriptName: settings[prefix + "PostscriptName"],
        weight: settings[prefix + "Weight"],
      };
    }

    /** 生成只替换目标字体组的新 settings 快照。 */
    function withSelection(settings, kind, selection) {
      var next = Object.assign({}, settings);
      var prefix = kind === "code" ? "code" : "ui";
      next[prefix + "Family"] = selection.family;
      next[prefix + "PostscriptName"] = selection.postscriptName;
      next[prefix + "Weight"] = selection.weight;
      return next;
    }

    /** 把一组字体选择写入官方 settingsScope；控制器自身负责串行和 revision 冲突恢复。 */
    function persistSelection(scope, kind, selection) {
      var prefix = kind === "code" ? "code" : "ui";
      scope.set(prefix + "Family", selection.family);
      scope.set(prefix + "PostscriptName", selection.postscriptName);
      scope.set(prefix + "Weight", selection.weight);
    }

    /** 为家族选择默认 face：优先常规 400，再选择最接近 400 的非斜体成员。 */
    function defaultFace(family) {
      if (!family || !Array.isArray(family.faces) || family.faces.length === 0) return null;
      return family.faces.slice().sort(function compareFaces(left, right) {
        var leftStyle = left.style === "normal" ? 0 : 1;
        var rightStyle = right.style === "normal" ? 0 : 1;
        return leftStyle - rightStyle || Math.abs(left.weight - 400) - Math.abs(right.weight - 400);
      })[0];
    }

    /** 可搜索字体家族菜单；编程字体只改变排序，不隐藏非等宽字体。 */
    function FontFamilyPicker(props) {
      var openTuple = React.useState(false);
      var open = openTuple[0];
      var setOpen = openTuple[1];
      var queryTuple = React.useState("");
      var query = queryTuple[0];
      var setQuery = queryTuple[1];
      var normalizedQuery = query.trim().toLocaleLowerCase();
      var families = (props.families || []).slice().sort(function sortFamilies(left, right) {
        if (props.kind === "code" && left.monospace !== right.monospace) return left.monospace ? -1 : 1;
        return left.family.localeCompare(right.family);
      }).filter(function filterFamily(family) {
        if (!normalizedQuery) return true;
        if (family.family.toLocaleLowerCase().includes(normalizedQuery)) return true;
        return family.faces.some(function matchesFace(face) {
          return face.postscriptName.toLocaleLowerCase().includes(normalizedQuery) ||
            face.fullName.toLocaleLowerCase().includes(normalizedQuery);
        });
      });
      var currentFamily = props.selection.family === "system"
        ? null
        : (props.families || []).find(function findFamily(family) {
          return family.family === props.selection.family;
        });
      var preview = props.selection.family === "system"
        ? undefined
        : { fontFamily: fontStack(props.selection, props.kind === "code") };

      var menu = null;
      if (open) {
        var options = [React.createElement("button", {
          type: "button",
          role: "option",
          className: "dsh-font-picker__option",
          "aria-selected": props.selection.family === "system",
          key: "system",
          onClick: function selectSystem() {
            props.onSelect({ family: "system", postscriptName: "", weight: 400 });
            setOpen(false);
          },
        }, props.t("systemDefault"))];
        families.forEach(function addFamily(family) {
          var face = defaultFace(family);
          if (!face) return;
          options.push(React.createElement("button", {
            type: "button",
            role: "option",
            className: "dsh-font-picker__option",
            "aria-selected": props.selection.family === family.family,
            key: family.family,
            style: { fontFamily: fontStack({ family: family.family, postscriptName: face.postscriptName }, props.kind === "code") },
            onClick: function selectFamily() {
              props.onSelect({ family: family.family, postscriptName: face.postscriptName, weight: face.weight });
              setOpen(false);
            },
          },
          React.createElement("span", { className: "dsh-font-picker__name" }, family.family),
          family.monospace ? React.createElement("span", { className: "dsh-font-picker__badge" }, props.t("monospace")) : null));
        });
        menu = React.createElement("div", {
          className: "dsh-font-picker__menu",
          role: "dialog",
          onKeyDown: function closeOnEscape(event) {
            if (event.key === "Escape") setOpen(false);
          },
        },
          React.createElement("div", { className: "dsh-font-picker__search-row" },
            React.createElement("input", {
              type: "search",
              className: "dsh-font-picker__search",
              value: query,
              autoFocus: true,
              placeholder: props.t("searchFonts"),
              onChange: function updateQuery(event) { setQuery(event.target.value); },
            }),
            React.createElement("button", {
              type: "button",
              className: "dsh-font-picker__refresh",
              title: props.t("refreshFonts"),
              "aria-label": props.t("refreshFonts"),
              onClick: function refreshFonts() { requestFontCatalog(true); },
            }, React.createElement(primitives.IconRefreshOutline16))),
          React.createElement("div", { className: "dsh-font-picker__list", role: "listbox" },
            options.length > 1 || !normalizedQuery
              ? options
              : React.createElement("div", { className: "dsh-font-picker__empty" }, props.t("noFonts"))));
      }

      return React.createElement("div", { className: "dsh-font-picker" },
        React.createElement("button", {
          type: "button",
          className: "dsh-font-picker__trigger",
          disabled: props.disabled,
          "aria-expanded": open,
          onClick: function toggleMenu() { setOpen(!open); },
          style: preview,
        },
        React.createElement("span", { className: "dsh-font-picker__name" },
          props.selection.family === "system" ? props.t("systemDefault") : props.selection.family),
        React.createElement("span", { className: "dsh-font-picker__chevron", "aria-hidden": true }, "⌄")),
        menu);
    }

    /** 一组“家族 + 实际 face”控件；右侧只列出当前家族真实存在的成员。 */
    function FontSelectionControls(props) {
      var family = props.selection.family === "system" ? null : props.families.find(function findFamily(candidate) {
        return candidate.family === props.selection.family;
      });
      var faces = family ? family.faces : [];
      var selectedFace = faces.find(function findFace(face) {
        return face.postscriptName === props.selection.postscriptName;
      });
      return React.createElement("div", { className: "dsh-desktop-fonts__controls" },
        React.createElement(FontFamilyPicker, props),
        React.createElement("select", {
          className: "dsh-font-picker__weight",
          value: selectedFace ? selectedFace.postscriptName : "",
          disabled: props.disabled || !family,
          onChange: function selectFace(event) {
            var face = faces.find(function matchesFace(candidate) { return candidate.postscriptName === event.target.value; });
            if (face) props.onSelect({ family: family.family, postscriptName: face.postscriptName, weight: face.weight });
          },
        },
        family
          ? faces.map(function faceOption(face) {
            return React.createElement("option", { value: face.postscriptName, key: face.postscriptName }, face.weightLabel);
          })
          : React.createElement("option", { value: "" }, props.t("systemDefault"))));
    }

    /** Codex 风格的字号输入：Enter 或失焦提交，非正数恢复上一个有效值。 */
    function FontSizeInput(props) {
      var inputTuple = React.useState(String(props.value));
      var inputValue = inputTuple[0];
      var setInputValue = inputTuple[1];

      React.useEffect(function syncExternalFontSize() {
        setInputValue(String(props.value));
      }, [props.value]);

      /** 不限制产品范围，但不将 NaN、无穷值或非正数写入 CSS 与用户配置。 */
      function commitInput() {
        var candidate = Number(inputValue);
        if (!Number.isFinite(candidate) || candidate <= 0) {
          setInputValue(String(props.value));
          return;
        }
        setInputValue(String(candidate));
        if (candidate !== props.value) props.onCommit(candidate);
      }

      return React.createElement("div", { className: "dsh-font-size-input" },
        React.createElement("input", {
          type: "number",
          step: "any",
          value: inputValue,
          disabled: props.disabled,
          "aria-label": props.label,
          onChange: function updateInput(event) { setInputValue(event.target.value); },
          onBlur: commitInput,
          onKeyDown: function handleInputKey(event) {
            if (event.key === "Enter") {
              event.preventDefault();
              commitInput();
            } else if (event.key === "Escape") {
              setInputValue(String(props.value));
            }
          },
        }),
        React.createElement("span", { className: "dsh-font-size-input__unit", "aria-hidden": true }, "px"));
    }

    /** Harness 常规设置中的 UI/编程字体、字重与字号设置。 */
    function DesktopFontRow(props) {
      var t = typeof props.t === "function" ? props.t : fallbackTranslate;
      var snapshotTuple = React.useState(props.scope.getSnapshot());
      var snapshot = snapshotTuple[0];
      var setSnapshot = snapshotTuple[1];
      var draftTuple = React.useState(null);
      var draft = draftTuple[0];
      var setDraft = draftTuple[1];
      var catalogTuple = React.useState({ phase: "idle", families: [], error: "" });
      var catalog = catalogTuple[0];
      var setCatalog = catalogTuple[1];

      React.useEffect(function subscribeFontSettings() {
        return props.scope.subscribe(function updateFontSnapshot() {
          var next = props.scope.getSnapshot();
          setSnapshot(next);
          if (next.status === "ready") {
            setDraft(null);
            applyFontSettings(next.value);
          }
        });
      }, [props.scope]);

      React.useEffect(function subscribeFontCatalog() {
        if (window.parent === window) return undefined;
        /** 只接受直接父窗口返回的只读字体目录。 */
        function onMessage(event) {
          if (event.source !== window.parent) return;
          var data = event.data;
          if (!data || data.type !== FONT_STATE_TYPE || data.desktop !== true) return;
          var families = Array.isArray(data.families) ? data.families : [];
          if (data.phase === "ready") updateAvailableFontFamilies(families);
          setCatalog({ phase: data.phase, families: families, error: data.error || "" });
        }
        window.addEventListener("message", onMessage);
        requestFontCatalog(false);
        return function unsubscribeFontCatalog() { window.removeEventListener("message", onMessage); };
      }, []);

      var settings = draft || normalizeFontSettings(snapshot.value);
      var settingsDisabled = snapshot.status !== "ready" || snapshot.writable !== true;
      var fontPickerDisabled = settingsDisabled || catalog.phase === "loading";
      /** 更新一组字体 face，并在 settings provider 确认前先即时预览。 */
      function select(kind, selection) {
        var next = withSelection(settings, kind, selection);
        setDraft(next);
        applyFontSettings(next);
        persistSelection(props.scope, kind, selection);
      }
      /** UI 与编程字号分字段写入，避免改动另一组字体配置。 */
      function selectSize(kind, value) {
        var field = kind === "code" ? "codeSize" : "uiSize";
        var next = Object.assign({}, settings);
        next[field] = value;
        setDraft(next);
        applyFontSettings(next);
        props.scope.set(field, value);
      }
      var uiSelection = selectionFromSettings(settings, "ui");
      var codeSelection = selectionFromSettings(settings, "code");
      var missing = catalog.phase === "ready" && [uiSelection, codeSelection].some(function missingSelection(selection) {
        if (selection.family === "system") return false;
        var family = catalog.families.find(function findFamily(candidate) { return candidate.family === selection.family; });
        return !family || !family.faces.some(function findFace(face) { return face.postscriptName === selection.postscriptName; });
      });

      var status = null;
      if (catalog.phase === "loading" || catalog.phase === "idle") status = t("loadingFonts");
      else if (catalog.phase === "error") status = catalog.error;
      else if (missing) status = t("unavailableFont");

      return React.createElement("div", { className: "dsh-desktop-fonts" },
        React.createElement("div", { className: "dsh-desktop-fonts__title" }, t("fontTitle")),
        React.createElement("div", { className: "dsh-desktop-fonts__row" },
          React.createElement("div", { className: "dsh-desktop-fonts__label" }, t("uiFont")),
          React.createElement(FontSelectionControls, {
            kind: "ui", t: t, families: catalog.families, selection: uiSelection, disabled: fontPickerDisabled,
            onSelect: function selectUi(selection) { select("ui", selection); },
          })),
        React.createElement("div", { className: "dsh-desktop-fonts__row" },
          React.createElement("div", { className: "dsh-desktop-fonts__label" }, t("uiFontSize")),
          React.createElement("div", { className: "dsh-desktop-fonts__size-controls" },
            React.createElement(FontSizeInput, {
              value: settings.uiSize,
              label: t("uiFontSize"),
              disabled: settingsDisabled,
              onCommit: function selectUiSize(value) { selectSize("ui", value); },
            }))),
        React.createElement("div", { className: "dsh-desktop-fonts__row" },
          React.createElement("div", { className: "dsh-desktop-fonts__label" }, t("codeFont")),
          React.createElement(FontSelectionControls, {
            kind: "code", t: t, families: catalog.families, selection: codeSelection, disabled: fontPickerDisabled,
            onSelect: function selectCode(selection) { select("code", selection); },
          })),
        React.createElement("div", { className: "dsh-desktop-fonts__row" },
          React.createElement("div", { className: "dsh-desktop-fonts__label" }, t("codeFontSize")),
          React.createElement("div", { className: "dsh-desktop-fonts__size-controls" },
            React.createElement(FontSizeInput, {
              value: settings.codeSize,
              label: t("codeFontSize"),
              disabled: settingsDisabled,
              onCommit: function selectCodeSize(value) { selectSize("code", value); },
            }))),
        status ? React.createElement("div", {
          className: "dsh-desktop-fonts__status" + (missing || catalog.phase === "error" ? " dsh-desktop-fonts__warning" : ""),
          role: catalog.phase === "error" ? "alert" : "status",
        }, status) : null);
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
     * 普通浏览器顶层访问时不渲染；桌面 iframe 中立即展示，避免父窗口握手异常时
     * 整个更新入口静默消失。所有原生操作仍由父窗口校验消息来源后执行。
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

      if (window.parent === window) return null;

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
      var locale = ctx && ctx.locale;
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
      var slots = ctx && ctx.slots;
      if (!slots || typeof slots.inject !== "function") return;

      ensureStyles();
      registerLocale(ctx);
      var fontScope = ctx.settingsScope.bind({ namespace: FONT_SETTINGS_NAMESPACE });

      /** 设置页尚未打开时也持续应用持久化字体，确保整个 Harness 启动后立即一致。 */
      function syncFontSettings() {
        var snapshot = fontScope.getSnapshot();
        if (snapshot.status === "ready") applyFontSettings(snapshot.value);
      }
      syncFontSettings();
      if (typeof ctx.effect === "function") {
        ctx.effect(function subscribePersistentFonts() {
          return fontScope.subscribe(syncFontSettings);
        }, "dsh-ui: desktop font settings");
        ctx.effect(function subscribeNativeFontCatalog() {
          if (window.parent === window) return undefined;
          /** 设置页未打开时也接收字体目录，以便补齐所选家族的全部真实 face。 */
          function onFontCatalogMessage(event) {
            if (event.source !== window.parent) return;
            var data = event.data;
            if (!data || data.type !== FONT_STATE_TYPE || data.desktop !== true || data.phase !== "ready") return;
            updateAvailableFontFamilies(data.families);
          }
          window.addEventListener("message", onFontCatalogMessage);
          requestFontCatalog(false);
          return function unsubscribeNativeFontCatalog() {
            window.removeEventListener("message", onFontCatalogMessage);
          };
        }, "dsh-ui: selected font faces");
      }

      slots.inject("settings.general.item", function registerDesktopUpdateRow() {
        slots.register(
          {
            name: "settings.general.item",
            id: "desktop-fonts",
            order: 20,
            locale: LOCALE_NAMESPACE,
          },
          function DesktopFontSlot(props) {
            return React.createElement(DesktopFontRow, Object.assign({}, props, { scope: fontScope }));
          },
        );
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

    // `package.json#dsh.client.inject` 声明插件加载顺序；这里声明的则是 Cordis
    // Service 依赖。必须显式注入后才能通过 ctx.slots / ctx.locale 使用官方服务。
    var inject = ["slots", "locale", "connection", "remote", "settingsScope"];

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
