//! Runtime Manager（设计文档 §13 / §14）。
//!
//! 版本化布局（`<app-data>/runtime/`）：
//!
//! ```text
//! runtime/
//! ├── versions/
//! │   └── <runtimeVersion>/
//! │       ├── manifest.json     # 该版本的完整 manifest
//! │       └── (dsh 包内容，package.json 位于版本目录根)
//! ├── current.json              # 当前生效版本
//! └── previous.json             # 上一版本（回滚用）
//! ```
//!
//! 职责：多版本列表、首次导入（传统目录迁移）、本地 zip 安装（SHA256 → staging →
//! 激活 → 重启 → 健康检查 → 失败自动回滚）、回滚。

use crate::config;
use crate::process;
use crate::runtime::manifest::{self, Channel, RuntimeManifest};
use crate::service::download::{self, ProgressTracker};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 版本列表条目（前端展示用）
#[derive(Debug, Clone, Serialize)]
pub struct VersionInfo {
    pub runtime_version: String,
    pub harness_version: String,
    pub node_version: String,
    pub active: bool,
}

/// Runtime 状态（前端 Runtime 卡片用）
#[derive(Debug, Clone, Serialize)]
pub struct RuntimeStatus {
    pub current: Option<VersionInfo>,
    pub previous: Option<VersionInfo>,
    pub versions: Vec<VersionInfo>,
}

/// 列出全部已安装的 Runtime 版本（按版本号降序）
pub fn list_versions(app_handle: &tauri::AppHandle) -> Vec<VersionInfo> {
    let versions_dir = config::get_runtime_versions_dir(app_handle);
    let current = RuntimeManifest::load_current(app_handle);

    let mut items: Vec<VersionInfo> = Vec::new();
    if let Ok(entries) = fs::read_dir(&versions_dir) {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Some(version) = dir.file_name().and_then(|n| n.to_str()).map(String::from) else {
                continue;
            };
            if let Some(m) = RuntimeManifest::load_version(app_handle, &version) {
                items.push(VersionInfo {
                    runtime_version: m.runtime_version.clone(),
                    harness_version: m.harness_version.clone(),
                    node_version: m.node_version.clone(),
                    active: current
                        .as_ref()
                        .map(|c| c.runtime_version == m.runtime_version)
                        .unwrap_or(false),
                });
            }
        }
    }
    items.sort_by(|a, b| {
        if RuntimeManifest::version_gt(&a.runtime_version, &b.runtime_version) {
            std::cmp::Ordering::Less
        } else if RuntimeManifest::version_gt(&b.runtime_version, &a.runtime_version) {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    });
    items
}

/// 当前 Runtime 状态
pub fn status(app_handle: &tauri::AppHandle) -> RuntimeStatus {
    let versions = list_versions(app_handle);
    let current = RuntimeManifest::load_current(app_handle)
        .map(|m| to_version_info(&m, true));
    let previous = RuntimeManifest::load_previous(app_handle)
        .map(|m| to_version_info(&m, false));
    RuntimeStatus {
        current,
        previous,
        versions,
    }
}

fn to_version_info(m: &RuntimeManifest, active: bool) -> VersionInfo {
    VersionInfo {
        runtime_version: m.runtime_version.clone(),
        harness_version: m.harness_version.clone(),
        node_version: m.node_version.clone(),
        active,
    }
}

/// 计算下一个版本号：`YYYY.MM.DD.<当日序号>`（当天第 N 次安装）
pub fn next_runtime_version(app_handle: &tauri::AppHandle) -> String {
    let today = manifest::today_yyyymmdd();
    let count = list_versions(app_handle)
        .iter()
        .filter(|v| v.runtime_version.starts_with(&today))
        .count();
    format!("{today}.{}", count + 1)
}

/// 确保当前 Runtime 已纳入版本化布局（幂等）。
///
/// - 已有 `current.json` → 不动；
/// - 否则若存在传统 `dependencies/dsh` → 导入为第一个版本目录并激活。
///   同时覆盖两种场景：首次全新安装、从旧版升级的存量安装。
pub fn ensure_runtime_import(app_handle: &tauri::AppHandle) -> Result<(), String> {
    if RuntimeManifest::load_current(app_handle).is_some() {
        return Ok(());
    }

    let legacy = config::get_legacy_dsh_install_path(app_handle);
    if !legacy.join(config::DSH_ENTRY_RELATIVE).exists() {
        return Ok(());
    }

    log::info!("Importing legacy harness install into versioned runtime layout");
    let version = next_runtime_version(app_handle);
    let versions_dir = config::get_runtime_versions_dir(app_handle);
    fs::create_dir_all(&versions_dir).map_err(|e| format!("create versions dir failed: {e}"))?;

    let target = versions_dir.join(&version);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| format!("clean target dir failed: {e}"))?;
    }
    fs::rename(&legacy, &target).map_err(|e| format!("move legacy runtime failed: {e}"))?;

    let m = build_manifest(app_handle, &version, None);
    m.save_version(app_handle)?;
    m.save_current(app_handle)?;
    log::info!("Runtime imported: {} (harness {})", m.runtime_version, m.harness_version);

    // 安装本版本携带的 Extension Pack（§4.3-①；profile 未初始化时跳过）
    log_ext_install(&install_extensions(app_handle, &target)?);

    Ok(())
}

/// 扩展安装结果
pub enum ExtInstallOutcome {
    /// 版本目录无 .dsh-desktop/extensions
    NoExtensions,
    /// 已安装到 profiles/node_modules，且 bundles 清单已更新
    Installed(Vec<String>),
    /// 扩展包已复制，但 profile 尚未初始化（bundles 清单待首次启动后由 ensure 补齐）
    PendingProfileInit(Vec<String>),
}

fn log_ext_install(outcome: &ExtInstallOutcome) {
    match outcome {
        ExtInstallOutcome::NoExtensions => log::debug!("runtime has no extension pack"),
        ExtInstallOutcome::Installed(pkgs) => {
            log::info!("extension pack installed: {}", pkgs.join(", "))
        }
        ExtInstallOutcome::PendingProfileInit(pkgs) => {
            log::debug!("extensions copied, pending profile init: {}", pkgs.join(", "))
        }
    }
}

/// 把 runtime 版本目录携带的 Extension Pack 装入当前 DSH_HOME：
/// `.dsh-desktop/extensions/*` → `$DSH_HOME/profiles/node_modules/<name>/`（官方扁平回退目录），
/// 并将聚合包 `dsh-desktop-bundle` 追加进 `profiles/web/package.json` 的 bundles 清单（幂等）。
pub fn install_extensions(
    app_handle: &tauri::AppHandle,
    version_dir: &Path,
) -> Result<ExtInstallOutcome, String> {
    let ext_root = version_dir.join(".dsh-desktop").join("extensions");
    if !ext_root.exists() {
        return Ok(ExtInstallOutcome::NoExtensions);
    }

    let profiles_nm = config::get_dsh_profiles_node_modules(app_handle);
    fs::create_dir_all(&profiles_nm).map_err(|e| format!("create profiles/node_modules failed: {e}"))?;

    let mut installed: Vec<String> = Vec::new();
    for entry in fs::read_dir(&ext_root).map_err(|e| format!("read extensions failed: {e}"))? {
        let dir = entry.map_err(|e| e.to_string())?.path();
        if !dir.is_dir() {
            continue;
        }
        let Some(name) = dir.file_name().and_then(|n| n.to_str()).map(String::from) else {
            continue;
        };
        let dest = profiles_nm.join(&name);
        if dest.exists() {
            fs::remove_dir_all(&dest).map_err(|e| format!("clean {name} failed: {e}"))?;
        }
        copy_dir_recursive(&dir, &dest)?;
        installed.push(name);
    }

    // bundles 清单：profile 未初始化（无 profiles/web/package.json）时跳过，由 ensure 补齐
    if config::get_dsh_profile_package_json(app_handle).exists() {
        if installed.iter().any(|n| n == "dsh-desktop-bundle") {
            add_bundle_to_profile(app_handle, "dsh-desktop-bundle")?;
        }
        Ok(ExtInstallOutcome::Installed(installed))
    } else {
        Ok(ExtInstallOutcome::PendingProfileInit(installed))
    }
}

/// 把聚合 bundle 追加进 `profiles/web/package.json`（dependencies + dsh.profile.bundles，幂等）
pub fn add_bundle_to_profile(app_handle: &tauri::AppHandle, bundle_name: &str) -> Result<(), String> {
    let path = config::get_dsh_profile_package_json(app_handle);
    let raw = fs::read_to_string(&path).map_err(|e| format!("read profile package.json failed: {e}"))?;
    let mut data: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("parse profile package.json failed: {e}"))?;

    let deps = data["dependencies"]
        .as_object_mut()
        .ok_or("profile package.json 缺少 dependencies 对象")?;
    deps.insert(bundle_name.to_string(), serde_json::Value::String("0.1.0".into()));

    let bundles = data["dsh"]["profile"]["bundles"]
        .as_array_mut()
        .ok_or("profile package.json 缺少 dsh.profile.bundles 数组")?;
    if !bundles.iter().any(|b| b.as_str() == Some(bundle_name)) {
        bundles.push(serde_json::Value::String(bundle_name.into()));
    }

    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("write profile package.json failed: {e}"))
}

/// 为当前生效的 Runtime 版本补齐 Extension Pack（幂等；profile 未初始化时跳过）
pub fn ensure_extensions_for_current(app_handle: &tauri::AppHandle) -> Result<ExtInstallOutcome, String> {
    let Some(m) = RuntimeManifest::load_current(app_handle) else {
        return Ok(ExtInstallOutcome::NoExtensions);
    };
    let vdir = config::get_runtime_versions_dir(app_handle).join(&m.runtime_version);
    if !vdir.exists() {
        return Ok(ExtInstallOutcome::NoExtensions);
    }
    install_extensions(app_handle, &vdir)
}

/// 定位 baseline 资源目录，兼容两种打包布局：
/// - 扁平：`<resource_dir>/baseline/`
/// - 嵌套（Tauri `"resources": ["resources/**/*"]` 的默认映射，实测 release 布局）：
///   `<resource_dir>/resources/baseline/`
fn resolve_baseline_dir(resource_dir: &Path) -> PathBuf {
    for candidate in [
        resource_dir.join("baseline"),
        resource_dir.join("resources").join("baseline"),
    ] {
        if candidate.join("runtime.zip").exists() {
            return candidate;
        }
    }
    resource_dir.join("resources").join("baseline")
}

/// 方案 B（§23）：从 bundle 资源 seed 基线 Runtime 到 app-data（离线开箱即用）。
///
/// 资源布局（CI 构建期放入 `src-tauri/resources/baseline/`）：
///   - `runtime.zip`：Baseline Runtime（runtime/scripts/build-runtime.ts 产物）
///
/// 说明（§15 修订）：Node 不再内置/下载，直接使用本机 Node（缺失即报错）。
///
/// 流程：Runtime → `versions/<v>/` + manifest + current.json + 扩展装入。
/// 返回是否 seed 了内容（调用方据此标记 installed）。
/// tauri dev / 无资源构建时返回 Ok(false)，走原有下载流程。
pub fn seed_baseline_from_resources(app_handle: &tauri::AppHandle) -> Result<bool, String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve resource_dir failed: {e}"))?;
    let baseline_dir = resolve_baseline_dir(&resource_dir);
    let runtime_zip = baseline_dir.join("runtime.zip");

    if !runtime_zip.exists() {
        log::debug!("no baseline runtime resource (dev / plan A build), skipping seed");
        return Ok(false);
    }
    let mut seeded = false;

    // 1) Baseline Runtime（无当前版本且资源存在时）
    if RuntimeManifest::load_current(app_handle).is_none() && runtime_zip.exists() {
        let version = next_runtime_version(app_handle);
        let versions_dir = config::get_runtime_versions_dir(app_handle);
        fs::create_dir_all(&versions_dir).map_err(|e| format!("create versions dir failed: {e}"))?;
        let staging = versions_dir.join(format!(".staging-{version}"));

        let buffer = fs::read(&runtime_zip).map_err(|e| format!("read runtime.zip failed: {e}"))?;
        let window = app_handle
            .get_webview_window("main")
            .ok_or("Failed to get main window")?;
        let mut tracker = download::ProgressTracker::new(&window, 1);
        tracker.start_phase("extract", "seeding baseline runtime");
        download::ensure_extract(&tracker, "runtime.zip".to_string(), buffer, staging.clone())?;
        tracker.end_phase();

        if !staging.join(config::DSH_ENTRY_RELATIVE).exists() {
            let _ = fs::remove_dir_all(&staging);
            return Err("baseline runtime 缺少 dsh 入口，seed 中止".to_string());
        }
        let target = versions_dir.join(&version);
        if target.exists() {
            let _ = fs::remove_dir_all(&target);
        }
        fs::rename(&staging, &target).map_err(|e| format!("activate baseline failed: {e}"))?;

        let m = build_manifest(app_handle, &version, None);
        m.save_version(app_handle)?;
        m.save_current(app_handle)?;
        log_ext_install(&install_extensions(app_handle, &target)?);
        seeded = true;
        log::info!("baseline runtime seeded: {} (harness {})", m.runtime_version, m.harness_version);
    }

    Ok(seeded)
}

/// 是否存在方案 B 基线资源（bundle 内置 node/runtime）
pub fn has_baseline_resources(app_handle: &tauri::AppHandle) -> bool {
    let Ok(resource_dir) = app_handle.path().resource_dir() else {
        return false;
    };
    resolve_baseline_dir(&resource_dir).join("runtime.zip").exists()
}

/// 等待后台基线 seed 完成（最多 120s；seed 完成会把 installed 置 true）。
///
/// - 已安装 → 立即 true（无需等待）；
/// - 无基线资源 → 立即 false（前端回退联网安装）；
/// - 有基线 → 轮询 installed（seed 在解压完 runtime 后才置位），超时返回 false。
pub async fn wait_for_baseline_seed(app_handle: &tauri::AppHandle) -> bool {
    if config::get_store_dat_setting(app_handle).installed {
        return true;
    }
    if !has_baseline_resources(app_handle) {
        return false;
    }
    for _ in 0..240 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if config::get_store_dat_setting(app_handle).installed {
            return true;
        }
    }
    log::warn!("baseline seed 超时（120s），installed 仍未置位");
    false
}

/// 递归复制目录
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("create {dest:?} failed: {e}"))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read {src:?} failed: {e}"))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let name = path.file_name().ok_or("invalid file name")?;
        let target = dest.join(name);
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|e| format!("copy {path:?} failed: {e}"))?;
        }
    }
    Ok(())
}

/// 构建版本 manifest：本地缺省值 + 远程 channel manifest 覆盖（Phase 4 起 remote 生效）
fn build_manifest(
    app_handle: &tauri::AppHandle,
    version: &str,
    remote: Option<&RuntimeManifest>,
) -> RuntimeManifest {
    let app_version = app_handle.package_info().version.to_string();
    let (platform, arch) = manifest::platform_ids();
    RuntimeManifest {
        schema_version: 1,
        channel: remote.map(|m| m.channel).unwrap_or(Channel::Dev),
        runtime_version: version.to_string(),
        harness_version: remote
            .map(|m| m.harness_version.clone())
            .unwrap_or_else(|| config::get_dsh_version(app_handle).unwrap_or_default()),
        extension_version: remote
            .map(|m| m.extension_version.clone())
            .unwrap_or_else(|| "0.0.0".to_string()),
        node_version: remote
            .map(|m| m.node_version.clone())
            .unwrap_or_else(config::get_supported_node_version),
        platform,
        arch,
        url: remote.map(|m| m.url.clone()).unwrap_or_default(),
        sha256: remote.map(|m| m.sha256.clone()).unwrap_or_default(),
        minimum_desktop_version: app_version,
        published_at: manifest::now_rfc3339(),
    }
}

/// 计算文件 SHA256（十六进制小写）
pub fn file_sha256(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let bytes = fs::read(path).map_err(|e| format!("read file failed: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

/// 安装一个本地 runtime 包（zip），并激活。
///
/// 流程（§13）：SHA256 校验 → 解压到 staging → 校验产物 → 正式目录 → 写版本 manifest
/// → 激活（current → previous，new → current）→ 重启 Harness → 健康检查 → 失败自动回滚。
pub async fn install_runtime_package(
    app_handle: &tauri::AppHandle,
    zip_path: &Path,
    expected_sha256: Option<&str>,
    remote_manifest: Option<&RuntimeManifest>,
) -> Result<RuntimeManifest, String> {
    if !config::get_store_dat_setting(app_handle).installed {
        return Err("Harness 尚未安装，无法更新 Runtime".to_string());
    }

    // 1. SHA256 校验
    if let Some(expected) = expected_sha256 {
        if !expected.is_empty() {
            let actual = file_sha256(zip_path)?;
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(format!(
                    "SHA256 校验失败：期望 {expected}，实际 {actual}"
                ));
            }
        }
    }

    // 2. 读取 zip 内容
    let buffer = fs::read(zip_path).map_err(|e| format!("读取 zip 失败: {e}"))?;
    let name = zip_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("runtime.zip")
        .to_string();

    // 3. 版本号与目录
    let version = next_runtime_version(app_handle);
    let versions_dir = config::get_runtime_versions_dir(app_handle);
    fs::create_dir_all(&versions_dir).map_err(|e| format!("create versions dir failed: {e}"))?;
    let target_dir = versions_dir.join(&version);
    let staging_dir = versions_dir.join(format!(".staging-{version}"));

    // 4. 解压到 staging（复用现有下载器的解压/进度设施）
    let window = app_handle
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;
    let mut tracker = ProgressTracker::new(&window, 2);
    tracker.start_phase(
        "extract",
        &format!("解压 Runtime {}", version),
    );
    download::ensure_extract(&tracker, name, buffer, staging_dir.clone())?;
    tracker.end_phase();

    // 5. 校验解压产物：dsh 入口必须存在
    if !staging_dir.join(config::DSH_ENTRY_RELATIVE).exists() {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err("解压产物缺少 dsh 入口，安装中止".to_string());
    }

    // 6. staging → 正式目录（原子重命名）
    if target_dir.exists() {
        let _ = fs::remove_dir_all(&target_dir);
    }
    fs::rename(&staging_dir, &target_dir)
        .map_err(|e| format!("activate staging dir failed: {e}"))?;

    // 7. 写版本 manifest
    let new_manifest = build_manifest(app_handle, &version, remote_manifest);
    new_manifest.save_version(app_handle)?;

    // 7.5 安装本版本携带的 Extension Pack（在激活重启前，保证重启后扩展已就位）
    log_ext_install(&install_extensions(app_handle, &target_dir)?);

    // 8. 激活 + 重启 + 健康检查（失败自动回滚）
    activate_and_verify(app_handle, new_manifest.clone()).await?;

    Ok(new_manifest)
}

/// 激活新版本并验证：current → previous、new → current、重启 Harness、健康检查。
/// 健康检查失败时自动回滚到上一版本并再次重启（§14）。
async fn activate_and_verify(
    app_handle: &tauri::AppHandle,
    new_manifest: RuntimeManifest,
) -> Result<(), String> {
    let old = RuntimeManifest::load_current(app_handle);

    // 原子切换：先归档 previous，再写 current
    if let Some(old) = &old {
        old.archive_current_as_previous(app_handle)?;
    }
    new_manifest.save_current(app_handle)?;

    match restart_and_health_check(app_handle).await {
        Ok(()) => {
            log::info!(
                "Runtime {} activated (harness {})",
                new_manifest.runtime_version,
                new_manifest.harness_version
            );
            Ok(())
        }
        Err(e) => {
            log::error!("新 Runtime 健康检查失败: {e}，自动回滚");
            // 回滚：恢复 previous → current
            if let Some(prev) = RuntimeManifest::load_previous(app_handle) {
                let cur = RuntimeManifest::load_current(app_handle);
                if let Err(rollback_err) = prev.save_current(app_handle) {
                    log::error!("回滚写入 current.json 失败: {rollback_err}");
                }
                if let Some(c) = cur {
                    let _ = c.archive_current_as_previous(app_handle);
                }
            }
            let _ = restart_and_health_check(app_handle).await;
            Err(format!("新 Runtime 启动失败，已自动回滚：{e}"))
        }
    }
}

/// 重启 Harness 并轮询健康检查（最多约 10 秒）
async fn restart_and_health_check(app_handle: &tauri::AppHandle) -> Result<(), String> {
    process::restart(app_handle.clone()).await?;
    let port = config::get_store_dat_setting(app_handle).port;
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if process::proxy_health_check(port).await.is_ok() {
            return Ok(());
        }
    }
    Err("健康检查超时（10s）".to_string())
}

/// 回滚到上一版本（§14）
pub async fn rollback_runtime(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let prev = RuntimeManifest::load_previous(app_handle)
        .ok_or("没有可回滚的上一版本".to_string())?;
    let cur = RuntimeManifest::load_current(app_handle);

    prev.save_current(app_handle)?;
    if let Some(c) = cur {
        c.archive_current_as_previous(app_handle)?;
    }

    let msg = format!("已回滚到 Runtime {}", prev.runtime_version);
    match restart_and_health_check(app_handle).await {
        Ok(()) => Ok(msg),
        Err(e) => Err(format!("{msg}，但健康检查失败：{e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_is_hex_lowercase() {
        let dir = std::env::temp_dir().join(format!("dsh_sha_test_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.txt");
        fs::write(&f, b"hello").unwrap();
        // echo -n hello | shasum -a 256
        assert_eq!(
            file_sha256(&f).unwrap(),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn next_version_seq_increments() {
        // 纯逻辑验证：version_gt 对同日序号递增
        assert!(RuntimeManifest::version_gt("2026.08.15.2", "2026.08.15.1"));
    }

    #[test]
    fn baseline_dir_resolves_nested_and_flat_layouts() {
        let dir = std::env::temp_dir().join(format!("dsh_baseline_dir_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();

        // 仅嵌套布局（Tauri release 实际布局：<resource>/resources/baseline/）
        let nested = dir.join("resources").join("baseline");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("runtime.zip"), b"x").unwrap();
        assert_eq!(resolve_baseline_dir(&dir), nested, "应命中嵌套布局");

        // 扁平布局也存在 → 扁平优先
        let flat = dir.join("baseline");
        fs::create_dir_all(&flat).unwrap();
        fs::write(flat.join("runtime.zip"), b"y").unwrap();
        assert_eq!(resolve_baseline_dir(&dir), flat, "两种布局并存时应命中扁平");

        // 无 runtime.zip → 回退嵌套默认
        let empty = dir.join("empty");
        fs::create_dir_all(&empty).unwrap();
        let resolved = resolve_baseline_dir(&empty);
        assert!(resolved.ends_with("resources/baseline"), "无资源时应回退嵌套默认");

        let _ = fs::remove_dir_all(&dir);
    }
}
