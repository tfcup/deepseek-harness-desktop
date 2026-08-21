import type { Translation } from "./zh";

const en: Translation = {
  nav: {
    features: "Features",
    faq: "FAQ",
    github: "GitHub",
    download: "Download",
  },
  hero: {
    badge: "v0.1.8 · Built with Tauri 2 · MIT",
    title1: "Run DeepSeek Harness",
    title2: "on your desktop, instantly",
    subtitle:
      "Install the DMG and run the verified Harness locally. Your data stays on the machine, and complete App updates track compatible upstream releases.",
    ctaPrimary: "Download",
    ctaSecondary: "View source",
    stat1: "0",
    stat1Label: "GitHub stars",
    stat2: "ARM64",
    stat2Label: "macOS",
    stat3: "Node",
    stat3Label: "Local runtime",
    stat4: "100%",
    stat4Label: "Local",
    scrollHint: "Scroll to explore",
    imgAlt: "DeepSeek Harness Desktop main UI preview",
  },
  features: {
    kicker: "Features",
    title: "Core features",
    subtitle: "The 82k-star agent platform, packaged into a download-and-run desktop app.",
    items: [
      {
        title: "One-click, out of the box",
        desc: "The DMG includes a verified Harness Runtime. First launch validates and activates it offline; only a compatible local Node.js installation is required.",
      },
      {
        title: "Unified App updates",
        desc: "New upstream Harness versions pass the Compatibility Gate and become complete Desktop Releases. Settings exposes one signed App update flow.",
      },
      {
        title: "100% local",
        desc: "The dsh web service runs on 127.0.0.1:3080. Profiles, sessions and settings all stay on your machine — no cloud dependency.",
      },
      {
        title: "Privacy by default",
        desc: "Isolated $DSH_HOME, telemetry disabled by default (DSH_TELEMETRY_DISABLED=1). Your data never leaves the machine.",
      },
      {
        title: "Native & lightweight",
        desc: "Built on Tauri 2, not Electron: smaller installers, lower memory, using the system WebView2/WebKit instead of bundling Chromium.",
      },
      {
        title: "Apple Silicon",
        desc: "The current developer preview is built and validated for macOS 11+ on Apple Silicon.",
      },
      {
        title: "Bilingual",
        desc: "The UI supports both English and 中文, switchable at any time.",
      },
      {
        title: "Theme-aware",
        desc: "The native loading and error states follow the Harness light/dark theme automatically.",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "Frequently asked questions",
    items: [
      {
        q: "How much needs to be downloaded on first launch?",
        a: "Nothing is downloaded for Harness setup: the verified Runtime is included in the App. A compatible local Node.js installation is required.",
      },
      {
        q: "Port 3080 is taken — what now?",
        a: "The preview currently owns port 3080 and stops an existing listener before starting its isolated Harness service.",
      },
      {
        q: "Why does it reach GitHub on launch?",
        a: "The Tauri App Updater checks the signed Desktop update manifest. Harness itself no longer has a separate download or update channel.",
      },
      {
        q: "How do updates work after install?",
        a: "Open Harness Settings → General → App Update. The signed complete App update includes the newly verified Harness Runtime and activates it after restart.",
      },
      {
        q: "Where is my data stored?",
        a: "On macOS it is stored under ~/Library/Application Support/Deepseek-Harness-Desktop/. App and Runtime updates preserve data/dsh.",
      },
    ],
  },
  cta: {
    title: "Ready to run DeepSeek Harness locally?",
    desc: "Free · MIT · Open source. macOS Apple Silicon preview.",
    button: "Download from GitHub Releases",
    secondary: "Star the project",
  },
  footer: {
    tagline: "The one-click desktop app for DeepSeek Harness — zero setup, fully local, self-healing updates.",
    product: "Product",
    links: {
      features: "Features",
      faq: "FAQ",
    },
    project: "Project",
    projectLinks: {
      github: "GitHub repo",
      releases: "Releases",
      issues: "Issues / Feedback",
    },
    related: "Related",
    relatedLinks: {
      upstream: "deepseek-harness (upstream)",
    },
    disclaimer: "For learning / research / testing only. The agent has local code execution — use it in an isolated environment.",
    license: "MIT License © deepseek-harness-desktop contributors",
    based: "Built with Tauri 2 · Bilingual",
  },
};

export default en;
