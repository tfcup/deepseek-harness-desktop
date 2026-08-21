//! App 内置 Runtime 的版本化安装、激活与自动回滚。
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
//! Runtime 不再独立联网更新；每个 Desktop Release 都携带已经验证的 Runtime，App
//! 启动时先激活它，再启动 Harness 并执行健康检查。

use crate::config;
use crate::process;
use crate::runtime::manifest::{self, RuntimeManifest};
use crate::service::download::{self, ProgressTracker};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 为旧目录迁移计算一个本地版本号；正式内置 Runtime 始终采用构建清单版本。
pub fn next_runtime_version(app_handle: &tauri::AppHandle) -> String {
    let today = manifest::today_yyyymmdd();
    let count = match fs::read_dir(config::get_runtime_versions_dir(app_handle)) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|version| version.starts_with(&today))
            .count(),
        Err(_) => 0,
    };
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

    let m = build_legacy_manifest(&version, &target);
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
        return if install_bundled_desktop_ui_extension(app_handle)? {
            Ok(ExtInstallOutcome::Installed(vec!["dsh-ui".to_string()]))
        } else {
            Ok(ExtInstallOutcome::NoExtensions)
        };
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

    // Runtime 可以独立升级，但 dsh-ui 与 Tauri postMessage 协议必须和当前 App 同步。
    // 因此 Runtime 扩展复制完成后，再用 App Bundle 内的版本做最终覆盖。
    if install_bundled_desktop_ui_extension(app_handle)?
        && !installed.iter().any(|name| name == "dsh-ui")
    {
        installed.push("dsh-ui".to_string());
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

/// 定位 App Bundle 内随版本发布的 dsh-ui，兼容 Tauri 的扁平和 resources/ 嵌套布局。
fn resolve_bundled_desktop_ui_dir(resource_dir: &Path) -> Option<PathBuf> {
    [
        resource_dir.join("desktop-extensions").join("dsh-ui"),
        resource_dir
            .join("resources")
            .join("desktop-extensions")
            .join("dsh-ui"),
    ]
    .into_iter()
    .find(|candidate| candidate.join("package.json").exists())
}

/// 将 App 自带的 dsh-ui 原子刷新到当前 Harness profile。
/// 返回 false 表示 dev/旧构建未携带该资源；不会删除用户数据或其他第三方插件。
pub fn install_bundled_desktop_ui_extension(app_handle: &tauri::AppHandle) -> Result<bool, String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve resource_dir failed: {e}"))?;
    let Some(source) = resolve_bundled_desktop_ui_dir(&resource_dir) else {
        log::debug!("no bundled dsh-ui desktop extension, skipping overlay");
        return Ok(false);
    };

    let profiles_nm = config::get_dsh_profiles_node_modules(app_handle);
    fs::create_dir_all(&profiles_nm)
        .map_err(|e| format!("create profiles/node_modules failed: {e}"))?;
    let destination = profiles_nm.join("dsh-ui");
    let staging = profiles_nm.join(".dsh-ui-staging");

    // 先完整复制到同文件系统的 staging，避免复制中断留下半个插件目录。
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|e| format!("clean dsh-ui staging failed: {e}"))?;
    }
    copy_dir_recursive(&source, &staging)?;
    if destination.exists() {
        fs::remove_dir_all(&destination)
            .map_err(|e| format!("clean dsh-ui failed: {e}"))?;
    }
    fs::rename(&staging, &destination)
        .map_err(|e| format!("activate bundled dsh-ui failed: {e}"))?;
    log::info!("bundled dsh-ui extension synchronized from App resources");
    Ok(true)
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

/// 读取并校验 App Bundle 内的 Runtime 三件套。
///
/// manifest 与独立 sha256 文件必须指向同一个 zip 哈希，防止构建或拷贝步骤把不同
/// Runtime 版本混装进同一个 Desktop Release。
fn bundled_runtime_resources(
    app_handle: &tauri::AppHandle,
) -> Result<(PathBuf, RuntimeManifest), String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve resource_dir failed: {e}"))?;
    let baseline_dir = resolve_baseline_dir(&resource_dir);
    let runtime_zip = baseline_dir.join("runtime.zip");
    let manifest_path = baseline_dir.join("manifest.json");
    let sha_path = baseline_dir.join("runtime.zip.sha256");
    if !runtime_zip.is_file() || !manifest_path.is_file() || !sha_path.is_file() {
        return Err("App 缺少内置 Runtime 资源，请重新安装应用".to_string());
    }

    let raw = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read bundled Runtime manifest failed: {e}"))?;
    let manifest: RuntimeManifest = serde_json::from_str(&raw)
        .map_err(|e| format!("parse bundled Runtime manifest failed: {e}"))?;
    manifest.validate_bundled()?;

    let sidecar_sha = fs::read_to_string(&sha_path)
        .map_err(|e| format!("read bundled Runtime sha256 failed: {e}"))?
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if sidecar_sha != manifest.sha256.to_ascii_lowercase() {
        return Err("内置 Runtime manifest 与 SHA256 文件不一致".to_string());
    }
    let actual_sha = file_sha256(&runtime_zip)?;
    if actual_sha != sidecar_sha {
        return Err(format!(
            "内置 Runtime SHA256 校验失败：期望 {sidecar_sha}，实际 {actual_sha}"
        ));
    }
    Ok((runtime_zip, manifest))
}

/// 在 Harness 启动前安装 Desktop Release 内置的 Runtime。
///
/// 返回 true 表示本次切换了 current；只有相同版本才跳过。Desktop 与 Runtime 是同一
/// 个经过 Compatibility Gate 的发布单元，因此即使用户手动降级 App，也必须切换到
/// 该 App 精确携带的 Runtime，不能继续运行另一个 Desktop 版本的 Runtime。
fn activate_bundled_runtime(app_handle: &tauri::AppHandle) -> Result<bool, String> {
    let (runtime_zip, manifest) = bundled_runtime_resources(app_handle)?;
    if let Some(current) = RuntimeManifest::load_current(app_handle) {
        let current_dir = config::get_runtime_versions_dir(app_handle).join(&current.runtime_version);
        if current_dir.join(config::DSH_ENTRY_RELATIVE).is_file()
            && current.runtime_version == manifest.runtime_version
        {
            return Ok(false);
        }
    }

    let version = &manifest.runtime_version;
    let versions_dir = config::get_runtime_versions_dir(app_handle);
    fs::create_dir_all(&versions_dir).map_err(|e| format!("create versions dir failed: {e}"))?;
    let target = versions_dir.join(version);
    // 同一个 Desktop Release 已经触发过健康检查回滚时继续使用上一版本，避免每次
    // 重启都重复解压并启动一个已知不可用的 Runtime；下一个 Runtime 版本会正常尝试。
    if target.join(".activation-failed").is_file() {
        log::warn!("bundled Runtime {version} was previously rejected; keeping current Runtime");
        return Ok(false);
    }
    let staging = versions_dir.join(format!(".staging-{version}"));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| format!("clean Runtime staging failed: {e}"))?;
    }

    let buffer = fs::read(&runtime_zip).map_err(|e| format!("read runtime.zip failed: {e}"))?;
    let window = app_handle
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;
    let mut tracker = ProgressTracker::new(&window, 1);
    tracker.start_phase("extract", &format!("准备内置 Runtime {version}"));
    download::ensure_extract(&tracker, "runtime.zip".to_string(), buffer, staging.clone())?;
    tracker.end_phase();

    if !staging.join(config::DSH_ENTRY_RELATIVE).is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err("内置 Runtime 缺少 Harness 入口，请重新安装应用".to_string());
    }
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| format!("clean Runtime target failed: {e}"))?;
    }
    fs::rename(&staging, &target).map_err(|e| format!("activate Runtime staging failed: {e}"))?;

    if let Some(current) = RuntimeManifest::load_current(app_handle) {
        current.archive_current_as_previous(app_handle)?;
    }
    manifest.save_version(app_handle)?;
    manifest.save_current(app_handle)?;
    log_ext_install(&install_extensions(app_handle, &target)?);

    let mut setting = config::get_store_dat_setting(app_handle);
    setting.installed = true;
    config::set_store_dat_setting(app_handle, setting);
    log::info!(
        "bundled Runtime activated: {} (harness {})",
        manifest.runtime_version,
        manifest.harness_version
    );
    Ok(true)
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

/// 为旧版未纳入版本管理的 Harness 生成一次性迁移清单。
fn build_legacy_manifest(version: &str, runtime_dir: &Path) -> RuntimeManifest {
    let (platform, arch) = manifest::platform_ids();
    let harness_version = fs::read_to_string(runtime_dir.join(config::DSH_MANIFEST_RELATIVE))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|package| {
            package["dependencies"]["@deepseek-ai/dsh"]
                .as_str()
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "legacy".to_string());
    RuntimeManifest {
        schema_version: 1,
        runtime_version: version.to_string(),
        harness_version,
        extension_version: "legacy".to_string(),
        node_version: config::get_supported_node_version(),
        platform,
        arch,
        sha256: "0".repeat(64),
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

/// 等待 Harness 健康检查通过，避免仅凭子进程创建成功就确认 Runtime。
async fn wait_for_health(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let port = config::get_store_dat_setting(app_handle).port;
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if process::proxy_health_check(port).await.is_ok() {
            return Ok(());
        }
    }
    Err("健康检查超时（10s）".to_string())
}

/// 清理非 current/previous 的 Runtime，限制完整 App 更新后的磁盘增长。
fn cleanup_old_versions(app_handle: &tauri::AppHandle, preserve_failed: bool) {
    let current = RuntimeManifest::load_current(app_handle).map(|m| m.runtime_version);
    let previous = RuntimeManifest::load_previous(app_handle).map(|m| m.runtime_version);
    let Ok(entries) = fs::read_dir(config::get_runtime_versions_dir(app_handle)) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(version) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if path.is_dir()
            && current.as_deref() != Some(version)
            && previous.as_deref() != Some(version)
            && !(preserve_failed && path.join(".activation-failed").is_file())
        {
            if let Err(error) = fs::remove_dir_all(&path) {
                log::warn!("cleanup old Runtime {} failed: {}", path.display(), error);
            }
        }
    }
}

/// 激活 App 内置 Runtime，启动 Harness，并在新版本不健康时自动恢复上一版本。
/// 这是唯一 Runtime 升级入口，由 `launch_harness` 调用，对用户不可见。
pub async fn launch_with_bundled_runtime(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let profile_was_initialized = config::get_dsh_profile_package_json(app_handle).is_file();
    if config::get_store_dat_setting(app_handle).installed {
        ensure_runtime_import(app_handle)?;
    }
    let activated = activate_bundled_runtime(app_handle)?;
    let start_result = process::launch(app_handle.clone()).await;
    let health_result = match start_result {
        Ok(()) => wait_for_health(app_handle).await,
        Err(error) => Err(error),
    };

    if health_result.is_ok() {
        // 首次启动会在 Harness 就绪时创建 profile，此时补齐 bundles 后必须重启一次，
        // 否则“应用更新”设置行要等用户第二次打开 App 才会出现。
        match ensure_extensions_for_current(app_handle) {
            Ok(ExtInstallOutcome::Installed(_)) if !profile_was_initialized => {
                process::stop(app_handle.clone()).await?;
                process::launch(app_handle.clone()).await?;
                wait_for_health(app_handle).await?;
            }
            Ok(_) => {}
            Err(error) => log::warn!("post-start extension sync failed: {error}"),
        }
        cleanup_old_versions(app_handle, !activated);
        return Ok(());
    }

    let error = health_result.unwrap_err();
    if !activated {
        return Err(error);
    }
    let Some(previous) = RuntimeManifest::load_previous(app_handle) else {
        return Err(format!("新 Runtime 启动失败，且没有可回滚版本：{error}"));
    };

    log::error!("新 Runtime 启动失败：{error}，自动恢复 {}", previous.runtime_version);
    process::stop(app_handle.clone()).await?;
    if let Some(rejected) = RuntimeManifest::load_current(app_handle) {
        let rejected_dir = config::get_runtime_versions_dir(app_handle).join(rejected.runtime_version);
        if let Err(marker_error) = fs::write(rejected_dir.join(".activation-failed"), &error) {
            log::warn!("record rejected Runtime failed: {marker_error}");
        }
    }
    previous.save_current(app_handle)?;
    process::launch(app_handle.clone()).await?;
    match wait_for_health(app_handle).await {
        Ok(()) => {
            log::warn!("新 Runtime 启动失败，已自动恢复上一版本：{error}");
            Ok(())
        }
        Err(rollback_error) => Err(format!(
            "新 Runtime 启动失败，上一版本恢复后也未通过健康检查：{rollback_error}"
        )),
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
