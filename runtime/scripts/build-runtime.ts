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
//!   node scripts/build-runtime.ts [--version <v>] [--no-zip]
//!                                [--dsh-base <dir>] [--out <dir>]
//!   # DSH_BASE 环境变量可替代 --dsh-base（默认从 PATH 解析全局 dsh）
//!   # 输出：runtime/dist/runtime-<version>-arm64.zip + manifest.json（--no-zip 时仅 staging）
//!   # staging 目录打印到 stdout（verify-runtime.ts 用它做 Compatibility Gate）

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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

/**
 * 定位 dsh 基座根目录：DSH_BASE env > --dsh-base > PATH 解析全局安装。
 *
 * 基座根 = 包含 node_modules/ 的目录（npm 全局安装根 或 pnpm install 根）。
 * 整棵复制 node_modules（保留相对符号链接）——pnpm 布局下 @deepseek-ai/dsh 的
 * 依赖是其同级符号链接（指向 node_modules/.pnpm），只复制包目录会丢失全部依赖。
 */
function resolveDshBase(): string {
  const candidates: string[] = [];
  const env = process.env.DSH_BASE ?? arg("--dsh-base");
  if (env) candidates.push(env);
  try {
    const bin = execFileSync("which", ["dsh"], { encoding: "utf8" }).trim();
    if (bin) {
      // <prefix>/global_packages/bin/dsh → <prefix>/global_packages/lib（含 node_modules）
      candidates.push(join(dirname(bin), "..", "lib"));
    }
  } catch {
    /* PATH 无 dsh */
  }
  for (const c of candidates) {
    if (existsSync(join(c, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"))) return c;
  }
  throw new Error("无法定位 dsh 基座根：设置 DSH_BASE（含 node_modules 的目录）或确保 dsh 在 PATH");
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

/**
 * 生成 Runtime 版本：显式值优先，否则使用 `YYYY.MM.DD.<build-id>`。
 *
 * CI 的输出目录每次都是空的，不能靠扫描 dist 计算“当日第几个”，否则同一天的
 * 多次构建都会得到 `.1`，App 会误判为相同 Runtime 并跳过新版 Harness。GitHub
 * 使用仓库内唯一的 run id，本地构建使用毫秒时间戳，保证 manifest 版本随构建变化。
 */
function nextVersion(): string {
  const explicit = arg("--version");
  const sequence = explicit || `${today()}.${process.env.GITHUB_RUN_ID?.trim() || Date.now()}`;
  if (!/^\d{4}\.\d{2}\.\d{2}\.[1-9]\d*$/.test(sequence)) {
    throw new Error(`Runtime 版本格式无效: ${sequence}`);
  }
  return sequence;
}

/**
 * 瘦身 node_modules：删除运行时永不加载的文件，减小 runtime zip / DMG 体积。
 *
 * 安全规则：
 * - 删：源码映射（.map）、test/tests/__tests__/spec/examples/example/docs/.github
 *   目录、README / LICENSE / CHANGELOG / CONTRIBUTING / SECURITY / CODE_OF_CONDUCT 文件；
 * - 不删 src/：部分包是 src-based（如 koffi 的 index.js 直接 import ./src/koffi/index.js），
 *   "有 lib/dist 即安全删 src"的启发式实测会误删运行时代码（Compatibility Gate 曾因此失败）；
 * - 保留：package.json、lib/、dist/、src/、原生二进制、.bin、.pnpm（防御性）。
 * 返回删除的源体积（KB）。
 */
function slimNodeModules(root: string): number {
  let removedKb = 0;
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      try {
        if (e.isDirectory()) {
          if (e.name === ".bin" || e.name === ".pnpm" || e.name === ".git") continue;
          if (existsSync(join(p, "package.json"))) {
            // 包根清理（仅删确认不参与运行的文件/目录）
            const removeDirs = ["test", "tests", "__tests__", "spec", "examples", "example", "docs", ".github"];
            for (const d of removeDirs) {
              const dp = join(p, d);
              if (existsSync(dp) && statSync(dp).isDirectory()) {
                removedKb += dirSizeKb(dp);
                rmSync(dp, { recursive: true, force: true });
              }
            }
            for (const f of readdirSync(p)) {
              if (/^(README|LICENSE|CHANGELOG|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT)/i.test(f)) {
                const fp = join(p, f);
                if (statSync(fp).isFile()) {
                  removedKb += statSync(fp).size / 1024;
                  rmSync(fp, { force: true });
                }
              }
            }
          }
          walk(p); // 递归找嵌套 node_modules / .map
        } else if (e.name.endsWith(".map")) {
          removedKb += statSync(p).size / 1024;
          rmSync(p, { force: true });
        }
      } catch {
        /* 单个条目失败不阻断整体 */
      }
    }
  };
  walk(root);
  return Math.round(removedKb / 1024);
}

function dirSizeKb(dir: string): number {
  let total = 0;
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      try {
        if (e.isDirectory()) walk(p);
        else total += statSync(p).size;
      } catch {
        /* ignore */
      }
    }
  };
  walk(dir);
  return total / 1024;
}

function main(): void {
  const noZip = process.argv.includes("--no-zip");
  // 绝对化输出目录：zip 的 cwd 是 tmpdir，相对路径会导致输出文件找不到
  const outDir = resolve(arg("--out", join(RUNTIME_DIR, "dist")));
  const version = nextVersion();
  const dshBase = resolveDshBase();
  const harnessVersion = packageVersion(join(dshBase, "node_modules", "@deepseek-ai", "dsh"));
  const extensionVersion = packageVersion(join(EXTENSIONS_SRC, BUNDLE_PACKAGE));
  const nodeVersion = process.env.NODE_VERSION ?? "22.22.0";

  mkdirSync(outDir, { recursive: true });
  const staging = join(tmpdir(), `runtime-${version}`);
  rmSync(staging, { recursive: true, force: true });

  console.log(`[build] runtimeVersion=${version}`);
  console.log(`[build] harness=${harnessVersion} extension=${extensionVersion} node=${nodeVersion}`);
  console.log(`[build] dsh-base=${dshBase}`);

  // 1) dsh 基座：整棵复制 node_modules（保留相对符号链接）。
  //    pnpm 布局下依赖是同级符号链接（指向 node_modules/.pnpm），相对链接复制后依然有效；
  //    不可 dereference（只实体化单个包会丢失其依赖）。
  const nmSrc = join(dshBase, "node_modules");
  if (!existsSync(join(nmSrc, "@deepseek-ai", "dsh", "lib", "bin.js"))) {
    throw new Error(`基座缺少 node_modules/@deepseek-ai/dsh: ${nmSrc}`);
  }
  const nmDest = join(staging, "node_modules");
  cpSync(nmSrc, nmDest, { recursive: true });
  console.log(`[build] node_modules → ${nmDest}`);

  // 1.5) 瘦身：删除运行时永不加载的文件（源映射/测试/文档/src-冗余）
  const removedMb = slimNodeModules(nmDest);
  console.log(`[build] slimmed node_modules: 移除约 ${removedMb} MB 非运行时文件`);

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

  // 4) 初始 manifest（zip 生成后回填 sha256）
  const manifest = {
    schemaVersion: 1,
    runtimeVersion: version,
    harnessVersion,
    extensionVersion,
    nodeVersion,
    platform: "darwin",
    arch: "arm64",
    sha256: "",
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
