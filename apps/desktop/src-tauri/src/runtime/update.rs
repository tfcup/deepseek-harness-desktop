//! Runtime 更新源（设计文档 §9 / §13 / §26）。
//!
//! Desktop 每次启动/手动检查时请求对应 channel 的 manifest（如 `stable.json`），
//! 比较 `runtimeVersion`，有新版则下载 zip → SHA256 → 交给 `manager` 安装激活。
//!
//! 远程发布链路（runtime-build/promote）在 Phase 4 落地；本模块已可直接对接
//! 任何符合 §7 schema 的 channel manifest URL。

use crate::runtime::manager;
use crate::runtime::manifest::RuntimeManifest;
use crate::service::download::{self, ProgressTracker};
use serde::Serialize;
use std::fs;
use std::time::Duration;
use tauri::Manager;

/// 更新检查结果（前端展示用）
#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub url: String,
    pub sha256: String,
}

/// 从 channel URL 获取远程 manifest（§26 stable.json/beta.json/dev.json）
pub async fn fetch_channel_manifest(channel_url: &str) -> Result<RuntimeManifest, String> {
    let client = reqwest::Client::builder()
        .user_agent("deepseek-harness-desktop")
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let res = client
        .get(channel_url)
        .send()
        .await
        .map_err(|e| format!("请求 channel manifest 失败: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("channel manifest HTTP {}", res.status()));
    }
    let text = res.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("channel manifest 解析失败: {e}"))
}

/// 检查更新：比较 channel manifest 与本地当前版本
pub async fn check_update(
    app_handle: &tauri::AppHandle,
    channel_url: &str,
) -> Result<UpdateInfo, String> {
    if channel_url.trim().is_empty() {
        return Err("未配置更新源 URL".to_string());
    }
    let remote = fetch_channel_manifest(channel_url).await?;
    let current = RuntimeManifest::load_current(app_handle);
    let has_update = current
        .as_ref()
        .map(|c| RuntimeManifest::version_gt(&remote.runtime_version, &c.runtime_version))
        .unwrap_or(true);

    Ok(UpdateInfo {
        current_version: current
            .as_ref()
            .map(|c| c.runtime_version.clone())
            .unwrap_or_default(),
        latest_version: remote.runtime_version.clone(),
        has_update,
        url: remote.url.clone(),
        sha256: remote.sha256.clone(),
    })
}

/// 从 channel 下载并安装新 Runtime（§13 更新流程）。
/// 下载 → 临时 zip → `manager::install_runtime_package`（校验/解压/激活/健康检查/回滚）。
pub async fn install_update(
    app_handle: &tauri::AppHandle,
    channel_url: &str,
) -> Result<RuntimeManifest, String> {
    if channel_url.trim().is_empty() {
        return Err("未配置更新源 URL".to_string());
    }
    let remote = fetch_channel_manifest(channel_url).await?;

    if let Some(cur) = RuntimeManifest::load_current(app_handle) {
        if !RuntimeManifest::version_gt(&remote.runtime_version, &cur.runtime_version) {
            return Err(format!(
                "当前已是最新版本（{}），无需更新",
                cur.runtime_version
            ));
        }
    }
    if remote.url.is_empty() {
        return Err("channel manifest 缺少 url 字段".to_string());
    }

    // 下载到临时 zip（复用带进度的下载器）
    let window = app_handle
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;
    let mut tracker = ProgressTracker::new(&window, 2);
    tracker.start_phase(
        "download",
        &format!("下载 Runtime {}", remote.runtime_version),
    );
    let buffer = download::download_file(&tracker, remote.url.clone()).await?;
    tracker.end_phase();

    let tmp_zip = std::env::temp_dir().join(format!("runtime-{}.zip", remote.runtime_version));
    fs::write(&tmp_zip, &buffer).map_err(|e| format!("写入临时 zip 失败: {e}"))?;

    let sha256 = if remote.sha256.is_empty() {
        None
    } else {
        Some(remote.sha256.as_str())
    };
    let result = manager::install_runtime_package(app_handle, &tmp_zip, sha256, Some(&remote)).await;
    let _ = fs::remove_file(&tmp_zip);
    result
}
