//! 解析 Desktop Release 版本：手动值优先；留空时递增最新 vX.Y.Z tag 的补丁位。
//!
//! 用法：node updater/scripts/resolve-desktop-version.mjs [0.2.0|v0.2.0] [--allow-existing]
//! 无参数时示例：v0.1.13 -> 0.1.14。runtime-* 等非桌面 tag 会被忽略。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSION_PATTERN = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/;

/** 解析严格的三段式版本号，拒绝预发布和非数字版本。 */
function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 按 major/minor/patch 数值顺序比较版本。 */
function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** 将数值版本格式化为 Tauri 和 GitHub Release 共用的无 v 版本号。 */
function formatVersion(version) {
  return version.join(".");
}

/** 读取仓库内 Tauri 版本，作为尚无桌面 tag 时的起始版本。 */
function readConfiguredVersion() {
  const configPath = join(REPO_ROOT, "apps", "desktop", "src-tauri", "tauri.conf.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const parsed = parseVersion(String(config.version ?? ""));
  if (!parsed) throw new Error(`tauri.conf.json version is invalid: ${config.version}`);
  return parsed;
}

/** 从 Git tag 中寻找最高的正式桌面版本，自动排除 runtime-* 等其他通道。 */
function latestDesktopTag() {
  const output = execFileSync("git", ["tag", "--list", "v*"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const versions = output
    .split(/\r?\n/)
    .map((tag) => parseVersion(tag))
    .filter((version) => version !== null)
    .sort(compareVersions);
  return versions.at(-1) ?? null;
}

/** 解析最终构建版本，并把诊断写入 stderr，保证 stdout 只输出版本号。 */
function resolveVersion(requested, allowExisting) {
  if (requested.trim()) {
    const parsed = parseVersion(requested);
    if (!parsed) throw new Error(`invalid version '${requested}', expected X.Y.Z or vX.Y.Z`);
    const latest = latestDesktopTag();
    if (latest && !allowExisting && compareVersions(parsed, latest) <= 0) {
      throw new Error(
        `version ${formatVersion(parsed)} must be newer than existing v${formatVersion(latest)}`,
      );
    }
    console.error(`[desktop-version] manual=${formatVersion(parsed)}`);
    return parsed;
  }

  const latest = latestDesktopTag();
  if (latest) {
    const next = [latest[0], latest[1], latest[2] + 1];
    console.error(`[desktop-version] latest=v${formatVersion(latest)} next=${formatVersion(next)}`);
    return next;
  }

  const configured = readConfiguredVersion();
  console.error(`[desktop-version] no desktop tag, fallback=${formatVersion(configured)}`);
  return configured;
}

try {
  const allowExisting = process.argv.includes("--allow-existing");
  process.stdout.write(`${formatVersion(resolveVersion(process.argv[2] ?? "", allowExisting))}\n`);
} catch (error) {
  console.error(`[desktop-version] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
