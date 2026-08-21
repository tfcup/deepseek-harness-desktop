//! 验证脚本：dsh-theme Client Plugin 端到端（真实 dsh 二进制）。
//!
//! 前置：dsh 在 PATH（或 DSH_BIN 环境变量）；本仓库 packages/dsh-theme。
//!
//! 校验内容（对应 docs/DSH-PLUGIN-API.md §2.3 加载链）：
//!   1. 经 adapter 安装 dsh-theme 后，dump-config 组合树含 dsh-theme 宿主行；
//!   2. 启动 dsh web 服务，index 的 __DSH_BOOT__ 引导图含 dsh-theme 条目；
//!   3. /plugins/dsh-theme/client.js?rev=<rev> 返回 200 且内容含主题 id 标记。

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addBundleToProfile,
  assertConfigCompatible,
  installBundleToProfile,
  writeUserPatch,
} from "../src/index.ts";

const KEEP = process.argv.includes("--keep");
const DSH_BIN = process.env.DSH_BIN ?? "dsh";
const PORT = 3082;
const PKG_ROOT = join(process.cwd(), "packages");
const LEAF_PKGS = ["dsh-theme", "dsh-ui", "dsh-tools", "dsh-integrations"] as const;
const BUNDLE_PKG = join(PKG_ROOT, "dsh-desktop-bundle");
const REQUIRED_ROWS = ["dsh-theme", "dsh-ui", "dsh-tools", "dsh-integrations", "ui-theme", "webserver"];

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 按端口杀掉残留进程（防止 SIGTERM 未传播导致僵尸服务器占用端口） */
async function killPort(port: number): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const out = await promisify(execFile)("lsof", ["-ti", String(port)]);
    for (const pid of out.stdout.trim().split(/\s+/).filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // 已退出
      }
    }
  } catch {
    // lsof 无结果或不可用：忽略
  }
}

async function main(): Promise<void> {
  for (const pkg of [...LEAF_PKGS, "dsh-desktop-bundle"]) {
    if (!existsSync(join(PKG_ROOT, pkg, "package.json"))) {
      fail(`包不存在: ${pkg}（请在仓库根目录运行）`);
    }
  }
  const dshHome = mkdtempSync(join(tmpdir(), "dsh-extpack-verify-"));
  console.log(`DSH_HOME: ${dshHome}`);

  let server: ReturnType<typeof spawn> | null = null;
  try {
    await killPort(PORT);
    // 0) 首次 dump 初始化 web profile（官方 initProfile），并断言官方关键行
    console.log("\n[0] 初始化 profile 并断言官方关键行…");
    const base = await assertConfigCompatible(dshHome, ["ui-theme", "webserver"], { bin: DSH_BIN });
    if (!base.ok) {
      fail(`官方关键行缺失: ${base.result.missing.join(", ")}`);
    }
    console.log(`    ✓ profile 已初始化（${base.result.rows.length} 行）`);

    // 1) 安装聚合 bundle + 全部叶子包，断言各宿主行（由聚合 patch insert）进入组合树
    console.log("\n[1] 安装 dsh-desktop-bundle（聚合）+ 叶子包并断言组合树…");
    for (const pkg of LEAF_PKGS) {
      installBundleToProfile(dshHome, join(PKG_ROOT, pkg), pkg);
    }
    installBundleToProfile(dshHome, BUNDLE_PKG, "dsh-desktop-bundle");
    addBundleToProfile(dshHome, "dsh-desktop-bundle", "0.1.0");
    writeUserPatch(dshHome, "[]\n");
    const dump = await assertConfigCompatible(dshHome, REQUIRED_ROWS, { bin: DSH_BIN });
    if (!dump.ok) {
      fail(`组合树缺失关键行: ${dump.result.missing.join(", ")}`);
    }
    console.log(`    ✓ 四个叶子包宿主行已进入组合树（共 ${dump.result.rows.length} 行）`);

    // 2) 启动服务器，检查 __DSH_BOOT__ 引导图（两个客户端插件都应出现）
    console.log("\n[2] 启动 dsh web 并检查客户端引导图…");
    server = spawn(DSH_BIN, ["--profile", "web", "--port", String(PORT)], {
      env: { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverErr = "";
    server.stderr?.on("data", (d: Buffer) => (serverErr += d.toString()));
    let bootJson: string | null = null;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) continue;
        const html = await res.text();
        const m = /window\.__DSH_BOOT__\s*=\s*(\{.*?\})\s*<\/script>/s.exec(html);
        if (m) {
          bootJson = m[1];
          break;
        }
      } catch {
        // 未就绪，继续等
      }
    }
    if (!bootJson) {
      fail(`服务器未就绪或 __DSH_BOOT__ 缺失。stderr 尾部: ${serverErr.slice(-300)}`);
    }
    let boot: { entries?: Array<{ id: string; url: string; rev: string }> };
    try {
      boot = JSON.parse(bootJson);
    } catch {
      fail(`__DSH_BOOT__ 解析失败: ${bootJson.slice(0, 200)}`);
    }
    const bootIds = boot.entries?.map((e) => e.id) ?? [];
    for (const clientId of ["dsh-theme", "dsh-ui"] as const) {
      const entry = boot.entries?.find((e) => e.id === clientId);
      if (!entry) {
        fail(`引导图缺少 ${clientId} 条目。现有条目: ${bootIds.join(", ") || "(无)"}`);
      }
      console.log(`    ✓ __DSH_BOOT__ 含 ${clientId} 条目（rev=${entry.rev}）`);
    }

    // 3) 拉取各客户端 bundle 并校验内容
    console.log("\n[3] 拉取客户端 bundle…");
    const markers: Record<string, string[]> = {
      "dsh-theme": ["__ModuleLoader__.load", "dsh-desktop"],
      "dsh-ui": ["__ModuleLoader__.load", "settings.general.item"],
    };
    for (const clientId of ["dsh-theme", "dsh-ui"] as const) {
      const entry = boot.entries!.find((e) => e.id === clientId)!;
      const url = entry.url.includes("?")
        ? `http://127.0.0.1:${PORT}${entry.url}`
        : `http://127.0.0.1:${PORT}${entry.url}?rev=${entry.rev}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        fail(`client.js HTTP ${res.status}（${clientId}, url=${url}）`);
      }
      const body = await res.text();
      for (const marker of markers[clientId]) {
        if (!body.includes(marker)) {
          fail(`client.js 内容缺少标记 "${marker}"（${clientId}）`);
        }
      }
      console.log(`    ✓ ${clientId}/client.js 正常服务（${body.length} 字节）`);
    }

    console.log("\n✅ 全部通过：Extension Pack 加载链（聚合 → 组合树 → 引导图 → client.js）在真实 dsh 上成立。");
  } finally {
    server?.kill("SIGKILL");
    await killPort(PORT);
    if (!KEEP) {
      rmSync(dshHome, { recursive: true, force: true });
    }
  }
}

void main();
