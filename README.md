<p align="center">
  <a href="https://github.com/tfcup/deepseek-harness-desktop">
    <img src="apps/desktop/public/favicon.svg" width="120" alt="DeepSeek Harness Desktop" />
  </a>
</p>

<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  <em>A native macOS desktop app for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> — run the full agent platform locally, track official updates automatically, and customize the UI/theme/tools without touching any official source.</em>
</p>

<p align="center">
  <a href="https://github.com/tfcup/deepseek-harness-desktop/releases/latest">
    <img src="https://img.shields.io/badge/version-0.1.13-4D6BFE?style=flat-square" alt="version 0.1.13" />
    <img src="https://img.shields.io/github/v/release/tfcup/deepseek-harness-desktop?style=flat-square&label=latest%20release" alt="latest release" />
    <img src="https://img.shields.io/github/downloads/tfcup/deepseek-harness-desktop/total?style=flat-square" alt="downloads" />
  </a>
  <img src="https://img.shields.io/badge/macOS%20ARM64-black?style=flat-square&logo=apple&logoColor=white" alt="macOS ARM64 only" />
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT license" />
</p>

<p align="center">
  <a href="https://github.com/tfcup/deepseek-harness-desktop/releases/latest"><strong>⬇ Download the latest DMG</strong></a>
</p>

<p align="center">
  <samp>
    <strong>English</strong> ·
    <a href="./README.zh.md">中文</a>
  </samp>
</p>

> **Status: developer preview.** The upstream `dsh` is still iterating rapidly with compatibility-breaking changes; this project tracks it closely via an automated pipeline.

## Features

- **One-click local run** — The DMG bundles a prebuilt Baseline Runtime (Harness + Extension Pack); on first launch it is seeded offline and starts with zero downloads. Just have Node.js on your machine.
- **Automatic upstream tracking** — A scheduled pipeline checks the official `@deepseek-ai/dsh` release every hour, builds and verifies a versioned Runtime, and publishes it to the `dev` channel. In-app Runtime updates install it with SHA-256 verification and one-click rollback.
- **Customize without modifying upstream** — An Extension Pack (theme / UI / tools / integrations) is injected through the official extension mechanisms (`ctx.theme.register`, `ctx.slots`, `ctx.tools.register`, ...). No official file is ever patched.
- **Data isolation** — A dedicated data directory (`~/Library/Application Support/deepseek-harness-desktop/`) keeps app data separate from a CLI `dsh`'s `~/.dsh`. The app also re-launches its own isolated instance whenever it finds any listener on port 3080 — an external CLI dsh is stopped first, never adopted.
- **Lightweight & native** — A Tauri 2 shell (system WebKit, not bundled Chromium): standard macOS titlebar with traffic lights, theme-colored titlebar, System theme sync, double-click to maximize.

> **Why Tauri and not Electron?** The same features run lighter: a smaller installer and lower idle RAM, with native window controls that stay snappy — important for a local agent host you may keep open all day. The embedded system WebKit also shrinks the install footprint.

## Preview

![DeepSeek Harness Desktop](docs/preview.png)

## Quick Start

1. Download the latest `DeepseekDesktop_<version>_arm64.dmg` from the [Releases](https://github.com/tfcup/deepseek-harness-desktop/releases/latest) page.
2. Open the DMG and drag the app into Applications.
3. **First launch**: the app is distributed **unsigned** (ad-hoc signed, no Apple Developer signing), so macOS Gatekeeper will block it the first time:
   - If you see **"is damaged and can't be opened"** — the file is **not** actually damaged; that misleading message appears when an ad-hoc-signed app carries the download quarantine attribute. Clear it once in Terminal, then open:
     ```bash
     xattr -dr com.apple.quarantine "/Applications/Deepseek Harness Desktop.app"
     ```
   - Alternatively, **Right-click** the app → **Open** → **Open** (once) also works for the plain "unverified developer" warning.
4. The app seeds the bundled Baseline Runtime and starts **offline** — the embedded Harness UI opens at `http://127.0.0.1:3080`.

> Everything runs locally. Runtime (Harness + Extension Pack) updates use the configured channel. Desktop App updates are available in Harness **Settings → General → App Update** and are verified with the pinned Tauri updater key. Apple Developer ID signing/notarization is configured separately for public distribution.

### Requirements

- macOS 11+ (**Apple Silicon / arm64 only**)
- **Node.js v22.15+ / v23.8+ / v24+ installed on your machine** — no Rust, pnpm or Docker required

The app **uses the Node.js installed on your machine** (resolved via PATH, the login shell, Homebrew or nvm). If Node.js is missing or incompatible, the app shows a clear error and does **not** download or bundle its own runtime.

## Updates

Two independent update paths (see also `updater/README.md`):

| | Runtime update (Harness kernel) | Desktop update (the app itself) |
|---|---|---|
| What updates | The `dsh` engine inside the app — versioned, atomic, rollback-able | The whole app |
| How it works | In-app: set the **update-source URL** (sidebar → Runtime) to a channel manifest (`dev` / `beta` / `stable` or any custom URL), then check → download → install | **Disabled** in this unsigned distribution (requires Apple signing) |
| Pipeline | `upstream-watch` (hourly) detects a new official release → `runtime-build` builds + verifies (Compatibility Gate) → publishes to the `dev` channel; `beta` / `stable` are promoted manually | tag `v*` → `desktop-release` builds the DMG on CI and publishes a GitHub Release |

Current channel state (in `updater/channels/`): `dev.json` points to runtime `2026.08.16.1` (dsh `0.1.0-rc.6`); `beta.json` / `stable.json` are empty until promoted.

## How It Works

```text
┌──────────────────────────────────────────────────────────────┐
│ App shell — Tauri 2 + React (native titlebar, System theme)  │
│   boot(): baseline seed → start service → iframe → web UI    │
│   SidebarPanel: service / runtime update / logs / settings   │
└──────────────────────┬───────────────────────────────────────┘
                       │ invoke commands (bridge/cmd.rs, ~30)
┌──────────────────────┴───────────────────────────────────────┐
│ Rust backend                                                 │
│   process/    dsh lifecycle: unconditional rebuild — any     │
│               LISTENer on :3080 (incl. external CLI dsh) is  │
│               stopped first, own instance launched with an   │
│               isolated $DSH_HOME (lsof -sTCP:LISTEN only)    │
│   runtime/    versioned installs (versions/<v> + current/    │
│               previous), baseline seed, update / rollback    │
│   config/     local Node resolution, settings, theme, i18n   │
│   service/    scheduler + health checks, download engine     │
└──────┬───────────────────────────────┬───────────────────────┘
       │                               │
  packages/ (Extension Pack)      runtime/versions/<v>/
  theme · ui · tools ·            (built by the CI pipeline,
  integrations — injected via     bundled in the DMG as
  official extension points       baseline, updated in-app)
       └──────────────┬──────────────┘
                      ▼
   node dsh --profile web --host 127.0.0.1 --port 3080
                      │  DSH_HOME=<app-data>/data/dsh
                      ▼
         http://127.0.0.1:3080/  ← embedded Harness UI
```

- The Harness kernel comes from the official npm package `@deepseek-ai/dsh` (a prebuilt-bundle fallback source is kept at [deepseek-harness-pkg](https://github.com/hairyf/deepseek-harness-pkg)).
- Runtime snapshots are versioned (`YYYY.MM.DD.N`), verified by a Compatibility Gate before release, and installable with SHA-256 checks and rollback.
- Full architecture notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the original design: [docs/deepseek-harness-desktop-macos-arm64-design.md](docs/deepseek-harness-desktop-macos-arm64-design.md).

## Data Directory

A custom-named folder under Application Support (like Chrome/VS Code, not the bundle id):

- macOS: `~/Library/Application Support/deepseek-harness-desktop/`

It contains:

- `runtime/versions/<v>/` — versioned Harness Runtime (current / previous)
- `data/dsh/` — Harness user data (`$DSH_HOME`: profiles, sessions, settings), isolated from a CLI dsh's `~/.dsh`
- `logs/` — app and dsh service logs
- `.store.dat` — desktop settings (port, auto-start, language)

## Development

### Prerequisites

- Node.js 20+
- Rust (stable)
- pnpm 11 (`corepack enable`), or use `corepack pnpm`
- macOS Xcode Command Line Tools

### Run in dev mode

```bash
git clone https://github.com/tfcup/deepseek-harness-desktop.git
cd deepseek-harness-desktop
corepack pnpm install
corepack pnpm tauri dev
```

### Build the DMG locally

```bash
# one-time: prepare the baseline runtime zip (needs network + npm)
bash scripts/prepare-baseline.sh

cd apps/desktop
export PATH="$HOME/.cargo/bin:/tmp/pnpm-shim:$PATH"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$PWD/../../updater/keys/desktop-updater.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="dev-only-key-do-not-use-in-prod"
corepack pnpm tauri build --target aarch64-apple-darwin
# → bundle/dmg/*.dmg + bundle/macos/*.app.tar.gz + *.sig
```

> The signing key is required because `tauri-plugin-updater` is enabled in `tauri.conf.json`; the dev key above is gitignored. If a previous build's DMG is still mounted, `hdiutil detach "/Volumes/Deepseek Harness Desktop"` first.

### Release via CI (recommended)

You do **not** need a local toolchain — the CI builds the DMG and signed Updater artifacts for you. Run `desktop-release` manually and leave `version` empty to increment the latest `vX.Y.Z` tag's patch number, or enter an explicit version.

```bash
git add -A && git commit -m "..."
git push origin main                         # runs desktop-test (quality gate)
# GitHub Actions → desktop-release → Run workflow → version 留空（自动 +1）
# 也可继续推送显式 vX.Y.Z tag 触发发布
```

The workflow applies its resolved version as a Tauri build override, and uses the same value for the DMG name, updater manifest, tag and GitHub Release. Runtime tags such as `runtime-*` are ignored by automatic version selection.

## FAQ

- **Port 3080 is already in use?** The app stops whatever is listening on 3080 (LISTEN sockets only — it never touches processes that merely hold connections, e.g. a browser) and starts its own isolated instance. Change the port in the sidebar settings if you prefer.
- **The app says "is damaged and can't be opened"?** The file is not damaged — this is Gatekeeper's message for an ad-hoc-signed app carrying the download quarantine attribute. Clear it once and reopen: `xattr -dr com.apple.quarantine "/Applications/Deepseek Harness Desktop.app"` (re-run after installing a new version).
- **Will the app touch my CLI `dsh` data?** No. It uses its own data directory and its own `$DSH_HOME`; a running CLI dsh on 3080 is stopped rather than adopted.
- **What happens during the first launch?** The bundled Baseline Runtime is seeded offline, extensions are installed, the service starts, and the Harness UI loads. The sidebar shows live install/service logs.
- **Node.js not found?** Install Node.js v22.15+ / v23.8+ / v24+ (Homebrew: `brew install node`, or via nvm) and relaunch. The app does not download Node.
- **How do Runtime updates work?** Set the update-source URL in the sidebar to a channel manifest (`https://raw.githubusercontent.com/tfcup/deepseek-harness-desktop/main/updater/channels/dev.json` for the dev channel), then check → install (SHA-256 verified) → roll back if needed.
- **How do I get a new app version?** Use **Settings → General → App Update**. The DMG remains available on the Releases page for first install or manual recovery.

## Security Notes

- This project is for personal learning, research, and testing only — please do not use it commercially.
- `dsh` is an agent harness with **local code execution capability**. Run it only in a trusted, isolated environment, and never import untrusted configurations or plugins from unknown sources.
- The developers are not liable for any data loss or security issues arising from the use of this project.

## Documentation

- [Design document](docs/deepseek-harness-desktop-macos-arm64-design.md) — full architecture and decisions (Chinese)
- [Architecture](docs/ARCHITECTURE.md) — implementation notes
- [Execution plan](docs/EXECUTION-PLAN.md) — phased plan with progress (Chinese)
- [Plugin API research](docs/DSH-PLUGIN-API.md) — official extension points (Chinese)
- [Package contract](docs/PKG-CONTRACT.md) — release artifact contract
- [Promotion](docs/PROMOTION.md) — channel promotion guide

## Related Projects

| Project | Purpose |
| --- | --- |
| [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | The upstream `dsh` (CLI + web UI + plugin architecture) |
| [deepseek-harness-pkg](https://github.com/hairyf/deepseek-harness-pkg) | Prebuilt Harness bundle fallback source |
| [n8n-desktop](https://github.com/tangtao646/n8n-desktop) | Reference implementation for one-click local desktop apps |

## Acknowledgements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the upstream project
- [n8n-desktop](https://github.com/tangtao646/n8n-desktop) — reference implementation
- [Tauri](https://tauri.app/) — the desktop framework

## License

[MIT](./LICENSE) © deepseek-harness-desktop contributors
