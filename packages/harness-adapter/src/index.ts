//! harness-adapter —— Compatibility Adapter（设计文档 Layer 2 / Anti-Corruption Layer）
//!
//! 只包装官方 dsh 的**稳定接缝**（经 docs/DSH-PLUGIN-API.md 调研与实测验证）：
//!
//! 1. Bundle 安装：把扩展包放进 `$DSH_HOME/profiles/node_modules/`（官方扁平回退目录，
//!    实测确认可解析），并向 `profiles/web/package.json` 的 `dependencies` 与
//!    `dsh.profile.bundles` 追加（实测确认"追加即用户所有、原样保留"）。
//! 2. 用户 patch 层：写 `$DSH_HOME/profiles/web/cordis.patch.yml`（官方热监听 HMR）。
//! 3. 主题桥：读 `$DSH_HOME/settings.yaml` 的 `ui-theme.preference`（官方 ThemeRuntime
//!    同一命名空间，桌面外壳联动用）。
//! 4. 版本兼容门：`dsh --profile web --dump-config` 输出断言关键行 id 存在。
//! 5. 健康检查：HTTP 探活。
//!
//! 原则：不直连官方 internal API（`__DSH_BOOT__`/`__ModuleLoader__` 等），官方版本演进
//! 变化只改本包。

import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 默认 profile 名（桌面端固定 web） */
export const PROFILE = "web";

// ---------- 路径 ----------

export function profilesDir(dshHome: string): string {
  return join(dshHome, "profiles");
}

export function profileDir(dshHome: string, profile = PROFILE): string {
  return join(profilesDir(dshHome), profile);
}

export function profilePackageJsonPath(dshHome: string, profile = PROFILE): string {
  return join(profileDir(dshHome, profile), "package.json");
}

export function userPatchPath(dshHome: string, profile = PROFILE): string {
  return join(profileDir(dshHome, profile), "cordis.patch.yml");
}

export function profilesNodeModulesDir(dshHome: string): string {
  return join(profilesDir(dshHome), "node_modules");
}

export function settingsYamlPath(dshHome: string): string {
  return join(dshHome, "settings.yaml");
}

// ---------- profile package.json（bundles 清单） ----------

export interface ProfilePackageJson {
  name?: string;
  private?: boolean;
  dependencies: Record<string, string>;
  dsh: { profile: { bundles: string[] } };
}

export function readProfilePackageJson(dshHome: string, profile = PROFILE): ProfilePackageJson {
  const p = profilePackageJsonPath(dshHome, profile);
  if (!existsSync(p)) {
    throw new Error(`profile package.json 不存在: ${p}（请先初始化 profile）`);
  }
  return JSON.parse(readFileSync(p, "utf8")) as ProfilePackageJson;
}

export function writeProfilePackageJson(dshHome: string, data: ProfilePackageJson, profile = PROFILE): void {
  const p = profilePackageJsonPath(dshHome, profile);
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** 把 bundle 包追加进 profile 清单（幂等）。追加后该列表即"用户所有"，官方不改写（实测确认）。 */
export function addBundleToProfile(dshHome: string, bundleName: string, version = "0.0.0", profile = PROFILE): void {
  const data = readProfilePackageJson(dshHome, profile);
  if (!data.dependencies[bundleName]) {
    data.dependencies[bundleName] = version;
  }
  if (!data.dsh.profile.bundles.includes(bundleName)) {
    data.dsh.profile.bundles.push(bundleName);
  }
  writeProfilePackageJson(dshHome, data, profile);
}

/** 把 bundle 从 profile 清单移除（幂等）。 */
export function removeBundleFromProfile(dshHome: string, bundleName: string, profile = PROFILE): void {
  const data = readProfilePackageJson(dshHome, profile);
  delete data.dependencies[bundleName];
  data.dsh.profile.bundles = data.dsh.profile.bundles.filter((b) => b !== bundleName);
  writeProfilePackageJson(dshHome, data, profile);
}

// ---------- bundle 安装（4.3-① 运行时布局，无 pnpm） ----------

/**
 * 把扩展包目录复制进 `$DSH_HOME/profiles/node_modules/<name>/`（官方扁平回退目录，
 * Node 父目录上溯即可解析；实测确认该目录由官方维护、只增不删）。
 * 复制而非软链：跨 Runtime 更新更稳（不会留下悬空链接）。
 */
export function installBundleToProfile(dshHome: string, srcDir: string, bundleName: string): string {
  const dest = join(profilesNodeModulesDir(dshHome), bundleName);
  mkdirSync(dirname(dest), { recursive: true });
  // 先清理旧副本再复制，保证与源一致
  cpSync(srcDir, dest, { recursive: true, force: true, verbatimSymlinks: false });
  return dest;
}

// ---------- 用户 patch 层 ----------

/**
 * 写入 profile 用户 patch（`profiles/web/cordis.patch.yml`，官方热监听 HMR）。
 * 注意：id 定位是整体替换 config 而非深合并；空文件会抛错，禁止写空内容。
 */
export function writeUserPatch(dshHome: string, patchYaml: string, profile = PROFILE): void {
  if (!patchYaml.trim()) {
    throw new Error("cordis.patch.yml 不能为空（官方要求，禁用用 []）");
  }
  const p = userPatchPath(dshHome, profile);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, patchYaml, "utf8");
}

// ---------- 主题桥（settings.yaml） ----------

export type ThemePreference = "light" | "dark" | "system";

/**
 * 读取官方主题偏好 `$DSH_HOME/settings.yaml` 的 `ui-theme.preference`
 * （官方 ThemeRuntime 持久化命名空间，常量 THEME_SETTINGS_NAMESPACE="ui-theme"）。
 * 最小行级解析，足够读取该字段；字段缺失返回 null。
 */
export function readThemePreference(dshHome: string): ThemePreference | null {
  const p = settingsYamlPath(dshHome);
  if (!existsSync(p)) {
    return null;
  }
  const lines = readFileSync(p, "utf8").split(/\r?\n/);
  let inUiTheme = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^ui-theme:\s*$/.test(line)) {
      inUiTheme = true;
      continue;
    }
    if (inUiTheme) {
      if (/^\S/.test(line)) {
        break; // 离开 ui-theme 命名空间
      }
      const m = /^preference:\s*(light|dark|system)\s*$/.exec(line.trim());
      if (m) {
        return m[1] as ThemePreference;
      }
    }
  }
  return null;
}

// ---------- 版本兼容门 / 健康检查 ----------

export interface DumpConfigResult {
  stdout: string;
  rows: string[];
  missing: string[];
}

/**
 * 运行 `dsh --profile web --dump-config` 打印组合后的配置树（官方：任何条目都可由
 * 你的 patch 替换）。用作版本兼容门：断言关键行 id 存在，官方演进导致行消失时在此暴露。
 */
export async function dumpConfig(dshHome: string, opts: { bin?: string; profile?: string; timeoutMs?: number } = {}): Promise<DumpConfigResult> {
  const bin = opts.bin ?? "dsh";
  const profile = opts.profile ?? PROFILE;
  const env = { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: "1" };
  const { stdout } = await execFileAsync(bin, ["--profile", profile, "--dump-config"], {
    env,
    timeout: opts.timeoutMs ?? 60_000,
  });
  return parseDump(stdout);
}

/** 断言关键行 id 存在，返回缺失列表（空数组 = 兼容） */
export async function assertConfigCompatible(
  dshHome: string,
  requiredRowIds: string[],
  opts: { bin?: string; profile?: string } = {},
): Promise<{ result: DumpConfigResult; ok: boolean }> {
  const result = await dumpConfig(dshHome, opts);
  const present = new Set(result.rows);
  const missing = requiredRowIds.filter((id) => !present.has(id));
  return { result: { ...result, missing }, ok: missing.length === 0 };
}

export function parseDump(stdout: string): DumpConfigResult {
  const rows: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*- id:\s*(\S+)\s*$/.exec(line);
    if (m) {
      rows.push(m[1]);
    }
  }
  return { stdout, rows, missing: [] };
}

/** HTTP 健康检查 */
export async function healthCheck(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
