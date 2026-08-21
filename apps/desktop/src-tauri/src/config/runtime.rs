use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

use super::constants::*;
use super::format::get_dsh_service_url;

/// 获取 App Data 基础目录（自定义：`~/Library/Application Support/Deepseek-Harness-Desktop`）
///
/// 说明：macOS 并不要求该目录名等于 bundle identifier——其他应用（Chrome/VS Code/
/// Telegram 等）都在代码里自定义此目录名。这里显式使用 `Deepseek-Harness-Desktop`
/// （不走 Tauri 默认的 identifier 命名），并配套让 store 使用绝对路径（见 setting.rs）。
pub fn get_base_dir<R: Runtime>(_app_handle: &AppHandle<R>) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Deepseek-Harness-Desktop")
}

/// 通过登录 shell 解析 node（GUI 应用从 Finder 启动时 PATH 不完整——launchd 只给
/// 系统默认 PATH；登录 shell 能加载用户配置拿到真实 PATH）。
///
/// 注意：用户常把 node 的 PATH 加在 `~/.zshrc`（交互式配置），非交互登录 shell
/// 不加载它，因此**必须用 `-lic`（登录+交互）**才能覆盖；`-lc` 兜底覆盖 .zprofile
/// 场景；bash 用 `-lc`（.bash_profile 登录时加载）。
fn resolve_node_via_login_shell() -> Option<PathBuf> {
    const VARIANTS: [(&str, &[&str]); 3] = [
        ("/bin/zsh", &["-lic", "command -v node"]),
        ("/bin/zsh", &["-lc", "command -v node"]),
        ("/bin/bash", &["-lc", "command -v node"]),
    ];
    for (shell, args) in VARIANTS {
        let Ok(output) = std::process::Command::new(shell).args(args).output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            continue;
        }
        let p = PathBuf::from(&path);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// 常见版本管理器/安装目录（GUI 场景 PATH 不含这些，显式补充）
fn common_node_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        // nvm：~/.nvm/versions/node/<v>/bin（版本目录按名称升序，取最新）
        if let Ok(entries) = fs::read_dir(home.join(".nvm").join("versions").join("node")) {
            let mut versions: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort();
            if let Some(latest) = versions.last() {
                dirs.push(latest.join("bin"));
            }
        }
        dirs.push(home.join(".volta").join("bin"));
        dirs.push(home.join(".nodenv").join("shims"));
        dirs.push(home.join(".fnm"));
    }
    dirs
}

/// 在 PATH、登录 shell 及常见安装目录中查找 node 可执行文件（不校验版本）
fn find_local_node_binary() -> Option<PathBuf> {
    // 1) 当前 PATH（终端启动 dev 时通常直接命中）
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        let candidate = dir.join("node");
        if candidate.is_file() && is_executable(&candidate) {
            return Some(candidate);
        }
    }
    // 2) 登录 shell（GUI 启动时 PATH 不完整，登录 shell 能拿到用户真实 PATH）
    if let Some(p) = resolve_node_via_login_shell() {
        if p.is_file() && is_executable(&p) {
            return Some(p);
        }
    }
    // 3) 常见版本管理器/安装目录
    for dir in common_node_dirs() {
        let candidate = dir.join("node");
        if candidate.is_file() && is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|meta| meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// 运行 `node --version` 并捕获输出
fn node_version_output(node: &Path) -> Option<std::process::Output> {
    std::process::Command::new(node)
        .arg("--version")
        .output()
        .ok()
}

/// 本机 Node.js 二进制路径（设计文档 §15 修订版：直接使用本机 Node，不下载、不内置）
///
/// 查找范围：PATH + /opt/homebrew/bin + /usr/local/bin。找不到时返回默认候选路径
/// （通常不存在），由 `require_local_node` 给出明确报错。
pub fn get_node_binary_path(_app_handle: &tauri::AppHandle) -> PathBuf {
    find_local_node_binary().unwrap_or_else(|| PathBuf::from("/usr/local/bin/node"))
}

/// 检查本机 Node.js 是否可用且兼容；缺失/不兼容时返回明确错误（不下载、不内置）
pub fn require_local_node() -> Result<PathBuf, String> {
    let Some(node) = find_local_node_binary() else {
        return Err(
            "未找到 Node.js：请先安装 Node.js v22.15+ / v23.8+（https://nodejs.org 或 brew install node）。\
             若已安装仍提示找不到，请确认终端里 `node -v` 可用（nvm 需先 `nvm use <版本>` 再启动应用），\
             或将 node 安装到 /usr/local/bin。"
                .to_string(),
        );
    };
    let output = node_version_output(&node).ok_or("无法运行 node --version")?;
    if !output.status.success() {
        return Err(format!("node --version 执行失败：{}", node.display()));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = stdout.trim();
    if !is_supported_node_version(version) {
        return Err(format!(
            "Node.js 版本不兼容：当前 {}，需要 v22.15+ / v23.8+（v24+ 亦可）",
            version
        ));
    }
    Ok(node)
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

/// 支持/推荐的 Node.js 版本基线（dsh 要求 v22.15+ / v23.8+；用于展示与报错提示）
pub fn get_supported_node_version() -> String {
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

/// 前端启动 WebView 所需的最小 Runtime 信息。
#[derive(Debug, Clone, Serialize)]
pub struct RuntimeInfo {
    pub service_url: String,
}

pub fn runtime_info<R: Runtime>(_app: &AppHandle<R>, port: u16) -> RuntimeInfo {
    RuntimeInfo {
        service_url: get_dsh_service_url(port),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_node_with_gui_launchd_path() {
        // 模拟 GUI 应用从 Finder 启动时的最小 PATH（launchd 默认，不含用户自定义目录）
        std::env::set_var("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
        let node = find_local_node_binary();
        assert!(node.is_some(), "GUI 最小 PATH 下应能定位到 node（登录 shell / 常见目录兜底）");
        let node = node.unwrap();
        assert!(node.is_file(), "解析到的 node 应为真实文件: {}", node.display());
        let out = node_version_output(&node).expect("node --version 应可执行");
        assert!(out.status.success(), "解析到的 node 应可运行");
    }
}
