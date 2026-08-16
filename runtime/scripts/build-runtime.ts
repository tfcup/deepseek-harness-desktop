//! 构建 Runtime（设计文档 §11 / §6 / §7）。
//!
//! 产出布局（与桌面端 runtime/versions/<v>/ 对齐，§14）：
//!
//! ```text
//! <runtime-<version>>/
//! ├── package.json                    # harness 包清单（依赖 @deepseek-ai/dsh:<pinned>）
//! ├── node_modules/@deepseek-ai/dsh/  # 固定版本的官方 Harness（含全部依赖）
//! └── .dsh-desktop/
//!     ├── extensions/                 # Extension Pack 各包（dsh-theme/ui/tools/integrations + 聚合）
//!     │   ├── dsh-theme/
//!     │   ├── dsh-ui/
//!     │   ├── dsh-tools/
//!     │   ├── dsh-integrations/
//!     │   └── dsh-desktop-bundle/
//!     └── manifest.json               # RuntimeManifest（§7）
//! ```
//!
//! 用法：
//!   node scripts/build-runtime.ts [--channel dev|beta|stable] [--version <v>] [--no-zip]
//!                                [--dsh-base <dir>] [--out <dir>]
//!   # DSH_BASE 环境变量可替代 --dsh-base（默认从 PATH 解析全局 dsh）
//!   # 输出：runtime/dist/runtime-<version>-arm64.zip + manifest.json（--no-zip 时仅 staging）
//!   # staging 目录打印到 stdout（verify-runtime.ts 用它做 Compatibility Gate）

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(RUNTIME_DIR, "..");
const EXTENSIONS_SRC = join(REPO_ROOT, "packages");
const LEAF_PACKAGES = ["dsh-theme", "dsh-ui", "dsh-tools", "dsh-integrations"];
const BUNDLE_PACKAGE = "dsh-desktop-bundle";
const EXTENSION_PACKAGES = [...LEAF_PACKAGES, BUNDLE_PACKAGE];

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** 定位 dsh 基座：DSH_BASE env > --dsh-base > PATH 解析全局安装 */
function resolveDshBase(): string {
  const candidates: string[] = [];
  const env = process.env.DSH_BASE ?? arg("--dsh-base");
  if (env) candidates.push(env);
  try {
    const bin = execFileSync("which", ["dsh"], { encoding: "utf8" }).trim();
    if (bin) {
      // <prefix>/global_packages/bin/dsh → <prefix>/global_packages/lib/node_modules/@deepseek-ai/dsh
      candidates.push(join(dirname(bin), "..", "lib", "node_modules", "@deepseek-ai", "dsh"));
    }
  } catch {
    /* PATH 无 dsh */
  }
  for (const c of candidates) {
    if (existsSync(join(c, "lib", "bin.js"))) return c;
  }
  throw new Error("无法定位 dsh 基座：设置 DSH_BASE 或确保 dsh 在 PATH（which dsh）");
}

function packageVersion(dir: string): string {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  return pkg.version as string;
}

/** 今天日期 YYYY.MM.DD */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** 生成 runtimeVersion：--version 或 YYYY.MM.DD.N（当日序号，对齐桌面 manager） */
function nextVersion(outDir: string): string {
  const explicit = arg("--version");
  if (explicit) return explicit;
  const t = today();
  let seq = 1;
  if (existsSync(outDir)) {
    for (const f of readFileSyncList(outDir)) {
      const m = /^runtime-(\d{4}\.\d{2}\.\d{2}\.(\d+))-arm64\.zip$/.exec(basename(f));
      if (m && m[1].startsWith(t)) seq = Math.max(seq, Number(m[2]) + 1);
    }
  }
  return `${t}.${seq}`;
}

function readFileSyncList(dir: string): string[] {
  return ([] as string[]).concat(
    ...readdirSync(dir, { withFileTypes: true }).map((e) =>
      e.isDirectory() ? readFileSyncList(join(dir, e.name)) : [join(dir, e.name)],
    ),
  );
}

function main(): void {
  const channel = arg("--channel", "dev");
  const noZip = process.argv.includes("--no-zip");
  const outDir = arg("--out", join(RUNTIME_DIR, "dist"));
  const version = nextVersion(outDir);
  const dshBase = resolveDshBase();
  const harnessVersion = packageVersion(dshBase);
  const extensionVersion = packageVersion(join(EXTENSIONS_SRC, BUNDLE_PACKAGE));
  const nodeVersion = process.env.NODE_VERSION ?? "22.22.0";

  mkdirSync(outDir, { recursive: true });
  const staging = join(tmpdir(), `runtime-${version}`);
  rmSync(staging, { recursive: true, force: true });

  console.log(`[build] runtimeVersion=${version} channel=${channel}`);
  console.log(`[build] harness=${harnessVersion} extension=${extensionVersion} node=${nodeVersion}`);
  console.log(`[build] dsh-base=${dshBase}`);

  // 1) dsh 基座（固定版本官方 Harness）
  const dshDest = join(staging, "node_modules", "@deepseek-ai", "dsh");
  mkdirSync(dirname(dshDest), { recursive: true });
  cpSync(dshBase, dshDest, { recursive: true });
  console.log(`[build] dsh base → ${dshDest}`);

  // 2) 根 package.json（harness 包清单，桌面端 DSH_MANIFEST_RELATIVE=package.json）
  writeFileSync(
    join(staging, "package.json"),
    JSON.stringify(
      {
        name: "deepseek-harness-runtime",
        version,
        private: true,
        dependencies: { "@deepseek-ai/dsh": harnessVersion },
      },
      null,
      2,
    ),
  );

  // 3) Extension Pack
  const extDir = join(staging, ".dsh-desktop", "extensions");
  for (const pkg of EXTENSION_PACKAGES) {
    const src = join(EXTENSIONS_SRC, pkg);
    if (!existsSync(join(src, "package.json"))) {
      throw new Error(`Extension 包缺失: ${src}`);
    }
    cpSync(src, join(extDir, pkg), { recursive: true });
  }
  console.log(`[build] extension pack → ${extDir}（${EXTENSION_PACKAGES.length} 包）`);

  // 4) 初始 manifest（sha256/url 在 zip 后回填）
  const manifest = {
    schemaVersion: 1,
    channel,
    runtimeVersion: version,
    harnessVersion,
    extensionVersion,
    nodeVersion,
    platform: "darwin",
    arch: "arm64",
    url: "",
    sha256: "",
    minimumDesktopVersion: "0.1.0",
    publishedAt: new Date().toISOString(),
  };
  writeFileSync(join(staging, ".dsh-desktop", "manifest.json"), JSON.stringify(manifest, null, 2));

  if (noZip) {
    console.log(`STAGING=${staging}`);
    console.log(`[build] 完成（--no-zip，staging 供 verify-runtime.ts 使用）`);
    return;
  }

  // 5) 打 zip + sha256 + 回填 manifest
  const zipPath = join(outDir, `runtime-${version}-arm64.zip`);
  rmSync(zipPath, { force: true });
  execFileSync("zip", ["-rq", zipPath, basename(staging)], { cwd: tmpdir() });
  const sha256 = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
  manifest.url = `https://github.com/tfcup/deepseek-harness-desktop/releases/download/runtime-${version}/runtime-${version}-arm64.zip`;
  manifest.sha256 = sha256;
  writeFileSync(join(staging, ".dsh-desktop", "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(outDir, `runtime-${version}-arm64.zip.sha256`), `${sha256}  ${basename(zipPath)}\n`);
  writeFileSync(join(outDir, `manifest-${version}.json`), JSON.stringify(manifest, null, 2));

  console.log(`[build] zip=${zipPath}（${(readFileSync(zipPath).length / 1_000_000).toFixed(1)} MB）`);
  console.log(`[build] sha256=${sha256}`);
  console.log(`[build] manifest=${join(outDir, `manifest-${version}.json`)}`);
  console.log(`STAGING=${staging}`);
}

main();
