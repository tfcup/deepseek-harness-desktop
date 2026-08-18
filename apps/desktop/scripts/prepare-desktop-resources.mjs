import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(DESKTOP_DIR, "..", "..");
const SOURCE = join(REPO_ROOT, "packages", "dsh-ui");
const DESTINATION = join(
  DESKTOP_DIR,
  "src-tauri",
  "resources",
  "desktop-extensions",
  "dsh-ui",
);

/**
 * 将 App 所有的 dsh-ui 桥接扩展放进 Tauri resources。
 * 这样覆盖安装 App 时可以刷新 Harness 设置入口，而不依赖用户同时更新 Runtime。
 */
function prepareDesktopResources() {
  if (!existsSync(join(SOURCE, "package.json"))) {
    throw new Error(`dsh-ui source is missing: ${SOURCE}`);
  }
  rmSync(DESTINATION, { recursive: true, force: true });
  mkdirSync(dirname(DESTINATION), { recursive: true });
  cpSync(SOURCE, DESTINATION, { recursive: true });
  console.log(`[desktop-resources] dsh-ui -> ${DESTINATION}`);
}

prepareDesktopResources();
