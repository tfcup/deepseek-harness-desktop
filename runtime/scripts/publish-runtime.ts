//! 发布 Runtime 到 channel（设计文档 §9 / §26）。
//!
//! 职责：把构建产物 manifest 发布为某个 channel 的当前版本
//! （updater/channels/<channel>.json —— 桌面端 check_runtime_update 消费的文件）。
//!
//! 用法：
//!   node scripts/publish-runtime.ts --channel dev --manifest <runtime/dist/manifest-<v>.json>
//!   # 可选 --repo <owner/repo>（用于生成下载 URL，缺省从 git remote 推断）
//!
//! 注意：zip 上传到 GitHub Releases（tag runtime-<v>）由 workflow 完成；
//! 本脚本只负责把 manifest 落到 channel 文件并校验 schema。

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const UPDATER_DIR = join(RUNTIME_DIR, "..", "updater");
const CHANNELS = ["dev", "beta", "stable"] as const;

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

interface Manifest {
  schemaVersion: number;
  channel: string;
  runtimeVersion: string;
  harnessVersion: string;
  extensionVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  url: string;
  sha256: string;
  minimumDesktopVersion: string;
  publishedAt: string;
}

function main(): void {
  const channel = arg("--channel", "dev") as (typeof CHANNELS)[number];
  const manifestPath = arg("--manifest", "");
  if (!CHANNELS.includes(channel)) fail(`channel 必须是 ${CHANNELS.join("/")}`);
  if (!manifestPath) fail("用法: publish-runtime.ts --channel <dev|beta|stable> --manifest <path>");

  const m = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

  // 基础校验（与 updater/schema/runtime-manifest.schema.json 对应）
  const required: Array<keyof Manifest> = [
    "schemaVersion", "channel", "runtimeVersion", "harnessVersion",
    "extensionVersion", "nodeVersion", "platform", "arch", "url", "sha256",
    "minimumDesktopVersion", "publishedAt",
  ];
  for (const k of required) {
    if (m[k] === undefined || m[k] === "") fail(`manifest 缺少字段: ${k}`);
  }
  if (m.channel !== channel) fail(`manifest.channel(${m.channel}) 与 --channel(${channel}) 不一致`);
  if (m.platform !== "darwin" || m.arch !== "arm64") {
    fail(`manifest 平台不符: ${m.platform}/${m.arch}（本项目仅 darwin/arm64）`);
  }
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(m.runtimeVersion)) {
    fail(`runtimeVersion 格式不符: ${m.runtimeVersion}（期望 YYYY.MM.DD.N）`);
  }

  const dest = join(UPDATER_DIR, "channels", `${channel}.json`);
  mkdirSafe(dirname(dest));
  writeFileSync(dest, `${JSON.stringify(m, null, 2)}\n`);
  console.log(`[publish] ${channel} → ${dest}`);
  console.log(`[publish] runtime=${m.runtimeVersion} harness=${m.harnessVersion} sha256=${m.sha256.slice(0, 12)}…`);
  console.log("[publish] 完成。GitHub Release 资产由 workflow 上传。");
}

function mkdirSafe(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* 已存在 */
  }
}

main();
