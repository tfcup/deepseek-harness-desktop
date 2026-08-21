//! 校验 Runtime 分发三件套，并可从最终 ZIP 还原 Compatibility Gate staging。
//!
//! 该脚本供 runtime-build 与 desktop-release 共用，确保 Cache、跨 Job Artifact 和
//! 本次新构建都经过完全相同的 manifest/SHA256/平台检查。

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface RuntimeManifest {
  harnessVersion?: unknown;
  platform?: unknown;
  arch?: unknown;
  sha256?: unknown;
}

/** 读取带值的命令行参数；可选参数不存在时返回空字符串。 */
function arg(name: string, required = false): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`缺少参数 ${name}`);
  return value || "";
}

/** 在目录中查找唯一匹配文件，避免旧产物混入后被 head 静默选中。 */
function uniqueFile(dir: string, pattern: RegExp, description: string): string {
  const matches = readdirSync(dir)
    .filter((name) => pattern.test(name))
    .map((name) => join(dir, name));
  if (matches.length !== 1) {
    throw new Error(`${description} 数量异常: ${matches.length}`);
  }
  return matches[0];
}

/** 计算文件 SHA256；Runtime ZIP 约几十 MB，一次读取可避免平台命令输出差异。 */
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * 从最终 ZIP 还原 staging，并用当前仓库 dsh-ui 覆盖 Runtime 中的副本。
 * dsh-ui 由 App Bundle 独立交付；这里模拟 App 启动时用随包 UI 覆盖 Runtime UI 的真实顺序。
 */
function extractForCompatibility(zip: string, target: string): string {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  execFileSync("unzip", ["-q", zip, "-d", target]);

  const roots = readdirSync(target)
    .map((name) => join(target, name))
    .filter((path) => statSync(path).isDirectory());
  if (roots.length !== 1 || !existsSync(join(roots[0], "package.json"))) {
    throw new Error(`Runtime ZIP 顶层目录异常: ${roots.map(basename).join(", ") || "无"}`);
  }

  const source = join(REPO_ROOT, "packages", "dsh-ui");
  const destination = join(roots[0], ".dsh-desktop", "extensions", "dsh-ui");
  if (!existsSync(join(source, "package.json"))) throw new Error("当前仓库缺少 packages/dsh-ui");
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
  return roots[0];
}

/** 执行三件套校验，并输出可直接追加到 GITHUB_ENV 的绝对路径。 */
function main(): void {
  const dist = resolve(arg("--dist", true));
  const expectedHarness = arg("--expected-harness");
  const extractTarget = arg("--extract");
  if (!existsSync(dist)) throw new Error(`Runtime Artifact 目录不存在: ${dist}`);

  const zip = uniqueFile(dist, /^runtime-.*-arm64\.zip$/, "Runtime ZIP");
  const manifestPath = uniqueFile(dist, /^manifest-.*\.json$/, "Runtime manifest");
  const shaPath = `${zip}.sha256`;
  if (!existsSync(shaPath)) throw new Error("Runtime Artifact 缺少 SHA256 文件");

  const expectedSha = readFileSync(shaPath, "utf8").trim().split(/\s+/)[0];
  const actualSha = sha256(zip);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RuntimeManifest;
  if (!/^[a-f0-9]{64}$/.test(expectedSha) || expectedSha !== actualSha || manifest.sha256 !== actualSha) {
    throw new Error("Runtime Artifact SHA256 校验失败");
  }
  if (manifest.platform !== "darwin" || manifest.arch !== "arm64") {
    throw new Error(`Runtime manifest 平台不匹配: platform=${String(manifest.platform)} arch=${String(manifest.arch)}`);
  }
  if (expectedHarness && manifest.harnessVersion !== expectedHarness) {
    throw new Error(
      `Runtime manifest Harness 版本不匹配: expected=${expectedHarness} actual=${String(manifest.harnessVersion)}`,
    );
  }

  const env = [
    `RUNTIME_ZIP=${zip}`,
    `RUNTIME_MANIFEST=${manifestPath}`,
    `RUNTIME_SHA_FILE=${shaPath}`,
  ];
  if (extractTarget) env.push(`STAGING_DIR=${extractForCompatibility(zip, resolve(extractTarget))}`);
  process.stdout.write(`${env.join("\n")}\n`);
  console.error(`[runtime-artifact] verified ${basename(zip)} (Harness ${String(manifest.harnessVersion)})`);
}

try {
  main();
} catch (error) {
  console.error(`[runtime-artifact] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
