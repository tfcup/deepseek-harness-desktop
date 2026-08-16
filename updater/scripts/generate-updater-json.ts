//! 生成 Tauri Updater 的 latest.json（§18 Desktop Update 清单）。
//!
//! Tauri v2 格式：
//!   { "version", "notes", "pub_date", "platforms": { "darwin-aarch64": { "signature", "url" } } }
//!
//! signature 由 tauri signer 对安装产物（.app.tar.gz）签名生成（CI 持有私钥）：
//!   tauri signer sign -f <artifact.tar.gz> -k <private.key> [-p <password>]
//!   # 输出追加到文件（.sig）；JSON 中取非注释的 base64 行
//!
//! 用法：
//!   node updater/scripts/generate-updater-json.ts \
//!     --version 1.2.4 \
//!     --url https://github.com/OWNER/REPO/releases/download/v1.2.4/app.tar.gz \
//!     --signature-file <path.sig> \
//!     --out updater/dist/latest.json \
//!     [--notes "更新说明"]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function main(): void {
  const version = arg("--version");
  const url = arg("--url");
  const sigFile = arg("--signature-file");
  const notes = arg("--notes", "");
  const out = arg("--out", join(REPO_ROOT, "updater", "dist", "latest.json"));

  if (!version || !url || !sigFile) {
    fail("用法: generate-updater-json.ts --version <v> --url <tar.gz url> --signature-file <path.sig>");
  }

  // .sig 文件内容（minisign 输出）：注释行 + base64 签名行；JSON 只需 base64 行
  const sigRaw = readFileSync(sigFile, "utf8");
  const sigLines = sigRaw
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("untrusted comment"));
  if (sigLines.length !== 1) fail(`signature 文件格式异常（期望 1 行 base64，实际 ${sigLines.length} 行）`);
  const signature = sigLines[0].trim();

  const manifest = {
    version,
    notes: notes || `DeepSeek Harness Desktop v${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      "darwin-aarch64": { signature, url },
    },
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[updater-json] ${out}`);
  console.log(`[updater-json] version=${version} signature=${signature.slice(0, 20)}…`);
  console.log(`[updater-json] 完成（上传到 endpoint 指向的位置，如 GitHub Release 资产 latest.json）`);
}

main();
