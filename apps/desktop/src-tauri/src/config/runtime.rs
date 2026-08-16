use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

use super::constants::*;
use super::format::get_dsh_service_url;

/// 获取 App Data 基础目录
pub fn get_base_dir<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .expect("Failed to resolve app data directory")
}

/// Node.js 运行时下载地址（macOS ARM64 only）
pub fn get_node_download_url() -> Result<String, String> {
    let arch = env::consts::ARCH;
    let os = env::consts::OS;
    if os != "macos" || arch != "aarch64" {
        return Err(format!("Unsupported platform: {} {}", os, arch));
    }

    let filename = format!("node-{}-darwin-arm64.tar.gz", NODE_VERSION);
    Ok(format!("{}/{}/{}", NODE_BASE_URL, NODE_VERSION, filename))
}

/// 打包的 DeepSeek Harness 发行版下载地址（macOS ARM64 only）
pub fn get_dsh_download_url() -> Result<String, String> {
    let arch = env::consts::ARCH;
    let os = env::consts::OS;
    if os != "macos" || arch != "aarch64" {
        return Err(format!("Unsupported platform: {} {}", os, arch));
    }

    let filename = "deepseek-harness-pkg-macos-arm64.zip";
    Ok(format!("{}{}", DSH_CORE_URL, filename))
}

/// 运行 `node --version` 并捕获输出
fn node_version_output(node: &Path) -> Option<std::process::Output> {
    std::process::Command::new(node)
        .arg("--version")
        .output()
        .ok()
}

/// Node.js 二进制路径（App Managed Node，设计文档 §15：始终使用 App 管理的运行时，
/// 不依赖系统 Node / Homebrew / nvm）
pub fn get_node_binary_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let runtime_dir = get_node_install_path(app_handle);
    runtime_dir.join("bin").join("node")
}

/// Node.js 安装目录（App Managed Node，设计文档 §15 / §24）
///
/// 旧版本将 Node 放在 `<app-data>/runtime/`，此处做一次性迁移到独立的 `node/` 目录：
/// 仅当旧目录存在、新目录不存在且旧目录确有 Node 内容时移动（幂等）。
pub fn get_node_install_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let base_dir = get_base_dir(app_handle);
    let new_dir = base_dir.join("node");
    let legacy_dir = base_dir.join("runtime");

    if !new_dir.exists() && legacy_dir.exists() && legacy_dir.join("bin").join("node").exists() {
        log::info!("Migrating legacy Node runtime dir: runtime/ -> node/");
        if let Err(e) = fs::rename(&legacy_dir, &new_dir) {
            log::warn!("Node dir migration failed ({}), will use legacy dir", e);
            return legacy_dir;
        }
    }

    new_dir
}

/// Runtime 多版本目录（设计文档 §14）：`<app-data>/runtime/versions/`。Phase 1 使用
#[allow(dead_code)]
pub fn get_runtime_versions_dir<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    get_base_dir(app_handle).join("runtime").join("versions")
}

/// 当前生效 Runtime 的 manifest 路径（§14 current.json）
pub fn get_runtime_current_json<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    get_base_dir(app_handle).join("runtime").join("current.json")
}

/// 上一个 Runtime 的 manifest 路径（§14 previous.json）。Phase 1 使用
#[allow(dead_code)]
pub fn get_runtime_previous_json<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    get_base_dir(app_handle).join("runtime").join("previous.json")
}

/// 传统 Harness 安装目录（未纳入版本化布局前的路径，§24 迁移用）
pub fn get_legacy_dsh_install_path<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    get_base_dir(app_handle).join("dependencies").join(DSH_CORE_DIR)
}

/// Harness 发行版安装目录
///
/// 优先返回当前生效版本目录（`runtime/versions/<current>/`，§14）；当前版本缺失
/// 或目录不存在时回退到传统目录（首次安装完成前 / 迁移前）。
pub fn get_dsh_install_path<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    if let Some(m) = crate::runtime::manifest::RuntimeManifest::load_current(app_handle) {
        let vdir = get_runtime_versions_dir(app_handle).join(&m.runtime_version);
        if vdir.exists() {
            return vdir;
        }
    }
    get_legacy_dsh_install_path(app_handle)
}

/// dsh CLI 入口
pub fn get_dsh_binary_path<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    get_dsh_install_path(app_handle).join(DSH_ENTRY_RELATIVE)
}

/// Harness 发行版清单路径
pub fn get_dsh_package_json_path<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    get_dsh_install_path(app_handle).join(DSH_MANIFEST_RELATIVE)
}

/// Harness 用户数据目录（$DSH_HOME）
pub fn get_dsh_data_path(app_handle: &tauri::AppHandle) -> PathBuf {
    get_base_dir(app_handle).join("data").join(DSH_DATA_DIR_NAME)
}

/// $DSH_HOME/profiles（官方 profile 根）
pub fn get_dsh_profiles_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    get_dsh_data_path(app_handle).join("profiles")
}

/// $DSH_HOME/profiles/node_modules —— 官方扁平回退目录（§4.3-①，父目录上溯即可解析）
pub fn get_dsh_profiles_node_modules(app_handle: &tauri::AppHandle) -> PathBuf {
    get_dsh_profiles_dir(app_handle).join("node_modules")
}

/// $DSH_HOME/profiles/web/package.json（dsh.profile.bundles 清单）
pub fn get_dsh_profile_package_json(app_handle: &tauri::AppHandle) -> PathBuf {
    get_dsh_profiles_dir(app_handle).join("web").join("package.json")
}

/// dsh 服务日志文件路径
pub fn get_service_log_path(app_handle: &tauri::AppHandle) -> PathBuf {
    get_base_dir(app_handle).join("logs").join("dsh-web.log")
}

/// 捆绑的 Node.js 版本号（Managed Node，§15）
pub fn get_bundled_node_version() -> String {
    NODE_VERSION.trim_start_matches('v').to_string()
}

fn parse_node_version(output: &str) -> Option<(u64, u64, u64)> {
    let version = output.trim().trim_start_matches('v');
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    Some((major, minor, patch))
}

/// 兼容性规则：v22.15.0+ 或 v23.8.0+（v24+ 也满足）
fn is_supported_node_version(version: &str) -> bool {
    let Some((major, minor, _patch)) = parse_node_version(version) else {
        return false;
    };
    match major {
        22 => minor >= 15,
        23 => minor >= 8,
        major if major >= 24 => true,
        _ => false,
    }
}

/// 运行 `node --version` 并判断运行时是否兼容
pub fn is_runtime_compatible(app_handle: &tauri::AppHandle) -> bool {
    let node = get_node_binary_path(app_handle);
    if !node.exists() {
        return false;
    }
    let output = match node_version_output(&node) {
        Some(out) => out,
        None => return false,
    };
    if !output.status.success() {
        return false;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    is_supported_node_version(stdout.trim())
}

/// 从打包的 Harness 清单读取 dsh 版本（界面展示用）
pub fn get_dsh_version<R: Runtime>(app_handle: &AppHandle<R>) -> Option<String> {
    let manifest_path = get_dsh_package_json_path(app_handle);
    let content = fs::read_to_string(&manifest_path).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&content).ok()?;
    manifest
        .get("dependencies")
        .and_then(|deps| deps.get("@deepseek-ai/dsh"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim_start_matches(['^', '~', '=', '>', '<']).to_string())
}

/// 侧边栏展示的运行时/版本/诊断信息
#[derive(Debug, Clone, Serialize)]
pub struct RuntimeInfo {
    pub app_version: String,
    pub dsh_version: Option<String>,
    /// Runtime 版本（读自本地 current.json，§6 四版本分离）
    pub runtime_version: Option<String>,
    /// Extension Pack 版本（Phase 3 起填充）
    pub extension_version: Option<String>,
    pub node_version: String,
    pub service_url: String,
    pub data_dir: String,
    pub log_path: String,
    pub platform: String,
    pub arch: String,
}

pub fn runtime_info<R: Runtime>(app: &AppHandle<R>, port: u16) -> RuntimeInfo {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    let manifest = crate::runtime::manifest::RuntimeManifest::load_current(app);

    RuntimeInfo {
        app_version: app.package_info().version.to_string(),
        dsh_version: get_dsh_version(app),
        runtime_version: manifest.as_ref().map(|m| m.runtime_version.clone()),
        extension_version: manifest.as_ref().map(|m| m.extension_version.clone()),
        node_version: get_bundled_node_version(),
        service_url: get_dsh_service_url(port),
        data_dir: app_data_dir.clone(),
        log_path: PathBuf::from(&app_data_dir)
            .join("logs")
            .join("dsh-web.log")
            .to_string_lossy()
            .into_owned(),
        platform: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
    }
}
