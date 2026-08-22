//! 验证 Runtime（设计文档 §12 Compatibility Gate）。
//!
//! 对 build-runtime.ts 的产物（staging 目录或解压后的 zip）做端到端验证：
//!   1. 用产物内的 Harness 初始化全新 DSH_HOME（官方关键行断言）；
//!   2. 把产物 .dsh-desktop/extensions 安装进 profile（模拟桌面端 adapter/Rust 逻辑）；
//!   3. 组合树断言：四个叶子包行 + 官方关键行；
//!   4. 启动产物内的 dsh 服务器 → 健康检查 → __DSH_BOOT__ 含双客户端条目 → client.js 服务。
//!
//! 用法：
//!   node scripts/verify-runtime.ts --runtime <dir> [--port 3086] [--keep]

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addBundleToProfile,
  assertConfigCompatible,
  installBundleToProfile,
  writeUserPatch,
} from "../../packages/harness-adapter/src/index.ts";
import { extractDshBootJson } from "../../packages/harness-adapter/scripts/boot-html.ts";

const RUNTIME_DIR = arg("--runtime", "");
const PORT = Number(arg("--port", "3086"));
const KEEP = process.argv.includes("--keep");
const REQUIRED_ROWS = ["dsh-theme", "dsh-ui", "dsh-tools", "dsh-integrations", "ui-theme", "webserver", "web-runtime"];

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function killPort(port: number): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const out = await promisify(execFile)("lsof", ["-ti", String(port)]);
    for (const pid of out.stdout.trim().split(/\s+/).filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        /* 已退出 */
      }
    }
  } catch {
    /* 无占用 */
  }
}

async function main(): Promise<void> {
  if (!RUNTIME_DIR || !existsSync(RUNTIME_DIR)) {
    fail("用法: node scripts/verify-runtime.ts --runtime <dir>（build-runtime.ts 输出的 STAGING）");
  }
  const harnessBin = join(RUNTIME_DIR, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const officialThemeClient = join(
    RUNTIME_DIR,
    "node_modules",
    "@deepseek-ai",
    "dsh-client-ui-theme",
    "lib",
    "client.js",
  );
  const extRoot = join(RUNTIME_DIR, ".dsh-desktop", "extensions");
  if (!existsSync(harnessBin)) fail(`Harness 入口缺失: ${harnessBin}`);
  if (!existsSync(extRoot)) fail(`Extension Pack 缺失: ${extRoot}`);
  if (!existsSync(officialThemeClient)) fail(`Harness 官方主题客户端缺失: ${officialThemeClient}`);
  const officialThemeSource = readFileSync(officialThemeClient, "utf8");
  // 字体与字号都依赖官方语义 token；上游删除时应阻止发布一个设置已失效的 Desktop。
  for (const variable of [
    "--dsw-font-family",
    "--ds-font-family-code",
    "--dsw-font-markdown-base-font-size",
    "--dsw-font-markdown-code-block-font-size",
  ]) {
    if (!officialThemeSource.includes(variable)) {
      fail(`Harness 官方主题不再提供字体变量 ${variable}`);
    }
  }

  const dshHome = mkdtempSync(join(tmpdir(), "dsh-runtime-verify-"));
  console.log(`DSH_HOME: ${dshHome}`);
  console.log(`RUNTIME:  ${RUNTIME_DIR}`);

  let server: ReturnType<typeof spawn> | null = null;
  try {
    await killPort(PORT);

    // 1) 初始化 profile + 官方关键行
    console.log("\n[1] 用产物 Harness 初始化 profile…");
    const base = await assertConfigCompatible(dshHome, ["ui-theme", "webserver"], { bin: harnessBin });
    if (!base.ok) fail(`官方关键行缺失: ${base.result.missing.join(", ")}`);
    console.log(`    ✓ profile 已初始化（${base.result.rows.length} 行）`);

    // 2) 安装扩展（模拟桌面端逻辑）
    console.log("\n[2] 安装 .dsh-desktop/extensions…");
    const installed: string[] = [];
    const { readdirSync } = await import("node:fs");
    for (const name of readdirSync(extRoot)) {
      installBundleToProfile(dshHome, join(extRoot, name), name);
      installed.push(name);
    }
    addBundleToProfile(dshHome, "dsh-desktop-bundle", "0.1.0");
    writeUserPatch(dshHome, "[]\n");
    console.log(`    ✓ 已安装 ${installed.join(", ")}`);

    // 3) 组合树断言
    console.log("\n[3] 组合树断言（Compatibility Gate）…");
    const dump = await assertConfigCompatible(dshHome, REQUIRED_ROWS, { bin: harnessBin });
    if (!dump.ok) fail(`组合树缺失关键行: ${dump.result.missing.join(", ")}`);
    console.log(`    ✓ 四个扩展行 + 官方关键行均在（共 ${dump.result.rows.length} 行）`);

    // 4) 启动 + 健康检查 + 引导图 + client.js
    console.log("\n[4] 启动产物 Harness 并验证加载链…");
    server = spawn(harnessBin, ["--profile", "web", "--port", String(PORT), "--no-open"], {
      env: { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverOut = "";
    let serverErr = "";
    let serverExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    server.stdout?.on("data", (d: Buffer) => (serverOut += d.toString()));
    server.stderr?.on("data", (d: Buffer) => (serverErr += d.toString()));
    server.once("exit", (code, signal) => {
      serverExit = { code, signal };
    });

    let bootJson: string | null = null;
    let serverResponded = false;
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) continue;
        serverResponded = true;
        const html = await res.text();
        bootJson = extractDshBootJson(html);
        if (bootJson) break;
      } catch {
        /* 未就绪 */
      }
      if (serverExit) break;
    }
    if (!bootJson) {
      const reason = serverResponded ? "服务器已就绪，但首页无法解析 __DSH_BOOT__" : "服务器未就绪";
      const exit = serverExit
        ? `code=${serverExit.code ?? "null"} signal=${serverExit.signal ?? "null"}`
        : "仍在运行";
      fail(
        `${reason}。进程: ${exit}\nstdout 尾部: ${serverOut.slice(-500)}\nstderr 尾部: ${serverErr.slice(-500)}`,
      );
    }
    const boot = JSON.parse(bootJson) as { entries?: Array<{ id: string; url: string; rev: string }> };
    const bootIds = boot.entries?.map((e) => e.id) ?? [];
    for (const clientId of ["dsh-theme", "dsh-ui"] as const) {
      const entry = boot.entries?.find((e) => e.id === clientId);
      if (!entry) fail(`引导图缺少 ${clientId}（现有: ${bootIds.join(", ") || "无"}）`);
      console.log(`    ✓ __DSH_BOOT__ 含 ${clientId}（rev=${entry.rev}）`);
      const url = entry.url.includes("?")
        ? `http://127.0.0.1:${PORT}${entry.url}`
        : `http://127.0.0.1:${PORT}${entry.url}?rev=${entry.rev}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) fail(`client.js HTTP ${res.status}（${clientId}）`);
      const body = await res.text();
      if (!body.includes("__ModuleLoader__.load")) fail(`client.js 内容异常（${clientId}）`);
      if (clientId === "dsh-ui" && !body.includes("settings.general.item")) {
        fail("dsh-ui client.js 缺少 Harness 设置 slot 标记");
      }
      if (clientId === "dsh-ui" && !body.includes("desktop-fonts")) {
        fail("dsh-ui client.js 缺少 Desktop 字体设置标记");
      }
      console.log(`    ✓ ${clientId}/client.js 正常服务（${body.length} 字节）`);
    }

    console.log("\n✅ 全部通过：Runtime Compatibility Gate（构建产物 → 扩展加载 → 启动 → 引导图 → client.js）成立。");
  } finally {
    server?.kill("SIGKILL");
    await killPort(PORT);
    if (!KEEP) rmSync(dshHome, { recursive: true, force: true });
  }
}

void main();
