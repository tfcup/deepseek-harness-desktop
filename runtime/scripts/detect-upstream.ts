//! 上游检查（设计文档 §10）：npm view @deepseek-ai/dsh version vs 已知版本。
//!
//! 用法：
//!   node scripts/detect-upstream.ts
//!   # 输出：
//!   #   latest=<远程最新版本>
//!   #   known=<runtime/.known-version 记录版本>
//!   #   changed=true|false
//!   # GitHub Actions 中写入 $GITHUB_OUTPUT（upstream_version / upstream_changed）
//!
//! 已知版本记录在 runtime/.known-version（提交到仓库，构建通过后由 promote 更新）。

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const KNOWN_FILE = join(RUNTIME_DIR, ".known-version");

function readKnown(): string {
  try {
    return readFileSync(KNOWN_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function main(): void {
  let latest = "";
  try {
    latest = execFileSync("npm", ["view", "@deepseek-ai/dsh", "version"], {
      encoding: "utf8",
      timeout: 30_000,
    }).trim();
  } catch (e) {
    // 网络失败等：用已知版本兜底，标记 changed=false（不阻断 CI 主流程）
    console.error(`[detect-upstream] npm view 失败: ${e}`);
  }

  const known = readKnown();
  const changed = latest !== "" && latest !== known;

  console.log(`latest=${latest}`);
  console.log(`known=${known}`);
  console.log(`changed=${changed}`);

  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `upstream_version=${latest}\nupstream_changed=${changed}\n`, {
      flag: "a",
    });
  }

  process.exit(changed ? 0 : 0); // 永远不失败；由 workflow 依据 changed 决定是否触发构建
}

main();
