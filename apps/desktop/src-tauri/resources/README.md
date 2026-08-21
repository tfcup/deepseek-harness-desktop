# Resources

This directory is bundled into the installer as `resources/**`.

Each Desktop Release embeds one validated Runtime payload in `baseline/`:

- `runtime.zip` - pinned Harness and the Desktop Extension Pack
- `manifest.json` - exact Runtime, Harness, platform, and architecture metadata
- `runtime.zip.sha256` - integrity sidecar checked before extraction

At startup the App installs a newer bundled Runtime into
`~/Library/Application Support/Deepseek-Harness-Desktop/runtime/versions/`, keeping only the current
and previous versions for automatic rollback. Harness user data remains isolated under `data/dsh/`.

Node.js is not bundled. A compatible local Node.js installation is still required. An incomplete or
invalid baseline is a packaging error and never falls back to an external download source.
