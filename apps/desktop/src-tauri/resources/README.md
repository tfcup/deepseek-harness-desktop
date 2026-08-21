# Resources

This directory is bundled into the installer as `resources/**`.

At runtime, the application seeds / downloads everything it needs into the OS
user-data directory (the Tauri app-data dir for identifier
`Deepseek-Harness-Desktop` (custom-named, not the bundle id), i.e.
`~/Library/Application Support/Deepseek-Harness-Desktop/`):

- （§15 修订：Node 不内置、不下载——直接使用本机 Node，缺失即报错）
- `runtime/versions/<v>/` — versioned Harness Runtime（基线随 DMG 内置或经 Runtime 更新安装）
- `data/dsh/` — the isolated `$DSH_HOME` used by the running `dsh` process
- `logs/` — application and `dsh` service logs
- `.store.dat` — desktop settings (port, auto-start, language, etc.)

> 方案 B（推荐分发形态）：CI 构建期把基线 Node 与 Baseline Runtime zip 放入
> `resources/baseline/`，应用首启从 bundle 资源 seed，离线开箱即用。
> 开发模式（tauri dev）无 baseline 资源时走原有下载流程。

No manual Node.js or pnpm installation is required.
