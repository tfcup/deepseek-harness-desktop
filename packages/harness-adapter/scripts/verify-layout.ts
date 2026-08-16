//! 验证脚本：用真实 dsh 二进制复现 docs/DSH-PLUGIN-API.md §5.2 的端到端验证。
//!
//! 前置：dsh 可执行文件在 PATH（或 DSH_BIN 环境变量指定）；本机已有
//! `dsh --version` = 0.1.0-rc.6 实测通过。
//!
//! 用法：
//!   node packages/harness-adapter/scripts/verify-layout.ts [--keep]
//!   （--keep 保留临时 DSH_HOME 便于人工检查）
//!
//! 校验内容：
//!   1. 全新 DSH_HOME 下 dump-config 可运行且含关键行（ui-theme / webserver / web-runtime）；
//!   2. 经 adapter 安装测试 bundle（profiles/node_modules + bundles 清单）后，patch 标记
//!      出现在组合树中（4.3-① 运行时布局成立）；
//!   3. 主题桥：写入 settings.yaml 的 ui-theme.preference 后可读回。

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addBundleToProfile,
  assertConfigCompatible,
  installBundleToProfile,
  readThemePreference,
  writeUserPatch,
} from "../src/index.ts";

const KEEP = process.argv.includes("--keep");
const DSH_BIN = process.env.DSH_BIN ?? "dsh";
const REQUIRED_ROWS = ["ui-theme", "webserver", "web-runtime"];

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const dshHome = mkdtempSync(join(tmpdir(), "dsh-adapter-verify-"));
  console.log(`DSH_HOME: ${dshHome}`);

  try {
    // 1) 全新 DSH_HOME：dump-config + 关键行断言
    console.log("\n[1] 全新 DSH_HOME 下 dump-config 与兼容断言…");
    const base = await assertConfigCompatible(dshHome, REQUIRED_ROWS, { bin: DSH_BIN });
    if (!base.ok) {
      fail(`关键行缺失: ${base.result.missing.join(", ")}`);
    }
    console.log(`    ✓ ${REQUIRED_ROWS.join(", ")} 均存在（共 ${base.result.rows.length} 行）`);

    // 2) 构造测试 bundle 并安装
    console.log("\n[2] 经 adapter 安装测试 bundle 并注入 patch…");
    const bundleSrc = join(dshHome, "bundle-src");
    mkdirSync(join(bundleSrc, "dsh-test-bundle"), { recursive: true });
    writeFileSync(
      join(bundleSrc, "dsh-test-bundle", "package.json"),
      JSON.stringify(
        {
          name: "dsh-test-bundle",
          version: "0.0.1",
          private: true,
          dsh: { bundle: { patch: "./cordis.patch.yml" } },
        },
        null,
        2,
      ),
    );
    // 覆盖已禁用行 hmr 的 config 加标记（避免 insert 重复注册 service 插件导致启动冲突，见 §5.2）
    writeFileSync(
      join(bundleSrc, "dsh-test-bundle", "cordis.patch.yml"),
      "- id: hmr\n  config:\n    marker: dsh-adapter-was-here\n",
    );
    installBundleToProfile(dshHome, join(bundleSrc, "dsh-test-bundle"), "dsh-test-bundle");
    addBundleToProfile(dshHome, "dsh-test-bundle", "0.0.1");
    writeUserPatch(dshHome, "[]\n");

    const injected = await assertConfigCompatible(dshHome, REQUIRED_ROWS, { bin: DSH_BIN });
    if (!injected.result.stdout.includes("dsh-adapter-was-here")) {
      fail("注入标记未出现在组合树中（bundle 安装/patch 未生效）");
    }
    console.log(`    ✓ 标记 dsh-adapter-was-here 出现在组合树中（${injected.result.rows.length} 行）`);

    // 3) 主题桥
    console.log("\n[3] 主题桥：settings.yaml 读写…");
    const settings = join(dshHome, "settings.yaml");
    writeFileSync(settings, "ui-theme:\n  preference: dark\n");
    const pref = readThemePreference(dshHome);
    if (pref !== "dark") {
      fail(`主题偏好读取异常: ${String(pref)}`);
    }
    console.log(`    ✓ ui-theme.preference = ${pref}`);

    console.log("\n✅ 全部通过：4.3-① 运行时布局在真实 dsh 上成立，adapter 接口可用。");
  } finally {
    if (!KEEP) {
      rmSync(dshHome, { recursive: true, force: true });
    }
  }
}

void main();
