export type Translation = {
  [key: string]: string | string[] | Translation | Translation[];
};

export interface FeatureItem {
  title: string;
  desc: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

const zh: Translation = {
  nav: {
    features: "核心特性",
    faq: "常见问题",
    github: "GitHub",
    download: "下载",
  },
  hero: {
    badge: "v0.1.8 · 基于 Tauri 2 · MIT 开源",
    title1: "在本地一键运行",
    title2: "DeepSeek Harness",
    subtitle:
      "安装 DMG，即可在本地运行经过验证的 Harness。数据不出机器，完整 App 更新自动跟随兼容的上游版本。",
    ctaPrimary: "下载安装包",
    ctaSecondary: "查看源码",
    stat1: "0",
    stat1Label: "GitHub Star",
    stat2: "ARM64",
    stat2Label: "macOS",
    stat3: "Node",
    stat3Label: "本机运行时",
    stat4: "100%",
    stat4Label: "本地运行",
    scrollHint: "向下滚动探索",
    imgAlt: "DeepSeek Harness Desktop 主界面预览",
  },
  features: {
    kicker: "Features",
    title: "核心特性",
    subtitle: "把 8.2 万 Star 的 agent 平台，装进一个「下载即用」的桌面应用。",
    items: [
      {
        title: "一键开箱即用",
        desc: "DMG 已内置验证通过的 Harness Runtime，首启离线校验并激活；只需本机安装兼容的 Node.js。",
      },
      {
        title: "统一应用更新",
        desc: "上游 Harness 新版本通过 Compatibility Gate 后生成完整 Desktop Release，设置中只保留一套签名 App 更新。",
      },
      {
        title: "纯本地运行",
        desc: "dsh web 服务运行在 127.0.0.1:3080，profile、会话与设置全部保存在本机，不依赖云端。",
      },
      {
        title: "隐私默认",
        desc: "隔离的 $DSH_HOME，默认关闭遥测（DSH_TELEMETRY_DISABLED=1），数据不出机器。",
      },
      {
        title: "原生轻量",
        desc: "基于 Tauri 2 而非 Electron：更小安装包、更低内存，内嵌系统 WebView2/WebKit 而非自带 Chromium。",
      },
      {
        title: "Apple Silicon",
        desc: "当前开发预览版面向 macOS 11+ Apple Silicon 构建和验证。",
      },
      {
        title: "中英双语",
        desc: "界面支持中文与 English，随时一键切换。",
      },
      {
        title: "主题跟随",
        desc: "原生加载和错误状态自动适配 Harness 的亮色 / 暗色主题。",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "常见问题",
    items: [
      {
        q: "首次启动要下载多少内容？",
        a: "Harness 首次安装不需要下载，验证过的 Runtime 已包含在 App 中；但需要本机安装兼容的 Node.js。",
      },
      {
        q: "3080 端口被占用怎么办？",
        a: "当前预览版固定使用 3080；启动自己的隔离 Harness 服务前会结束已有监听者。",
      },
      {
        q: "为什么启动时会访问 GitHub？",
        a: "Tauri App Updater 会检查签名的 Desktop 更新清单；Harness 不再拥有独立下载源或更新通道。",
      },
      {
        q: "安装后如何更新？",
        a: "打开 Harness 设置 → 常规 → 应用更新。签名的完整 App 更新包含新 Harness Runtime，重启后自动激活。",
      },
      {
        q: "数据存在哪里？",
        a: "macOS 数据位于 ~/Library/Application Support/Deepseek-Harness-Desktop/，App 和 Runtime 更新都会保留 data/dsh。",
      },
    ],
  },
  cta: {
    title: "准备好本地运行 DeepSeek Harness 了吗？",
    desc: "免费 · MIT · 开源。macOS Apple Silicon 开发预览版。",
    button: "前往 GitHub Releases 下载",
    secondary: "Star 支持项目",
  },
  footer: {
    tagline: "DeepSeek Harness 的一键式桌面应用 —— 免环境、纯本地、随上游自愈更新。",
    product: "产品",
    links: {
      features: "核心特性",
      faq: "常见问题",
    },
    project: "项目",
    projectLinks: {
      github: "GitHub 仓库",
      releases: "Releases 下载",
      issues: "Issues / 反馈",
    },
    related: "相关项目",
    relatedLinks: {
      upstream: "deepseek-harness（上游）",
    },
    disclaimer: "仅用于学习、研究、测试。agent 具备本地代码执行能力，请在隔离环境使用。",
    license: "MIT License © deepseek-harness-desktop contributors",
    based: "基于 Tauri 2 构建 · 中英双语",
  },
};

export default zh;
