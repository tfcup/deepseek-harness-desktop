//! Runtime Manifest（设计文档 §7 / §14 / §26）。
//!
//! 一次 Runtime 发布是一个完整发行单元，因此 Desktop 不应只比较 Harness 版本，
//! 而应比较整个 `runtimeVersion`。

use crate::config;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

/// 发布通道（§9 / §26）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Dev,
    Beta,
    Stable,
}

/// Runtime Manifest（§7 字段全集）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeManifest {
    pub schema_version: u32,
    pub channel: Channel,
    /// Runtime 版本（独立发行单元，形如 `2026.08.15.1`）
    pub runtime_version: String,
    /// 官方 @deepseek-ai/dsh 版本（如 `0.1.0-rc.12`）
    pub harness_version: String,
    /// Extension Pack 版本（Phase 3 起填充）
    pub extension_version: String,
    /// App Managed Node 版本（如 `24.6.0`）
    pub node_version: String,
    pub platform: String,
    pub arch: String,
    /// Runtime 产物下载地址（Phase 4 发布时填充，本地为空）
    pub url: String,
    pub sha256: String,
    pub minimum_desktop_version: String,
    pub published_at: String,
}

impl RuntimeManifest {
    pub fn current_path<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
        config::get_runtime_current_json(app_handle)
    }

    /// Phase 1（Runtime 更新/回滚）使用
    #[allow(dead_code)]
    pub fn previous_path<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
        config::get_runtime_previous_json(app_handle)
    }

    /// 读取当前生效的 Runtime manifest（文件不存在/损坏时返回 None，调用方优雅降级）
    pub fn load_current<R: Runtime>(app_handle: &AppHandle<R>) -> Option<Self> {
        Self::load_file(&Self::current_path(app_handle))
    }

    /// 读取上一个 Runtime manifest（回滚用，§14）。Phase 1 使用
    #[allow(dead_code)]
    pub fn load_previous<R: Runtime>(app_handle: &AppHandle<R>) -> Option<Self> {
        Self::load_file(&Self::previous_path(app_handle))
    }

    fn load_file(path: &PathBuf) -> Option<Self> {
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// 写入当前生效 manifest（自动创建 runtime/ 目录，tmp+rename 原子写入）
    pub fn save_current<R: Runtime>(&self, app_handle: &AppHandle<R>) -> Result<(), String> {
        let path = Self::current_path(app_handle);
        let dir = path.parent().ok_or("no parent dir for current.json")?;
        fs::create_dir_all(dir).map_err(|e| format!("create runtime dir failed: {e}"))?;
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        write_atomic(&path, &json)
    }

    /// 将当前 manifest 存档为 previous（§14 更新成功时：old current -> previous）。Phase 1 使用
    #[allow(dead_code)]
    pub fn archive_current_as_previous<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
    ) -> Result<(), String> {
        let path = Self::previous_path(app_handle);
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        write_atomic(&path, &json)
    }

    /// 写入某个版本目录内的 manifest.json（`runtime/versions/<v>/manifest.json`）
    pub fn save_version<R: Runtime>(&self, app_handle: &AppHandle<R>) -> Result<(), String> {
        let dir = config::get_runtime_versions_dir(app_handle).join(&self.runtime_version);
        fs::create_dir_all(&dir).map_err(|e| format!("create version dir failed: {e}"))?;
        let path = dir.join("manifest.json");
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        write_atomic(&path, &json)
    }

    /// 读取版本目录内的 manifest.json（`runtime/versions/<v>/manifest.json`）
    pub fn load_version<R: Runtime>(
        app_handle: &AppHandle<R>,
        version: &str,
    ) -> Option<Self> {
        let path = config::get_runtime_versions_dir(app_handle)
            .join(version)
            .join("manifest.json");
        Self::load_file(&path)
    }

    /// 比较两个 Runtime 版本字符串（`YYYY.MM.DD.N` 数值段比较）。
    /// 返回 `a` 是否严格大于 `b`（Phase 1 更新判断用）。
    #[allow(dead_code)]
    pub fn version_gt(a: &str, b: &str) -> bool {
        let pa: Vec<u64> = a.split('.').filter_map(|s| s.parse().ok()).collect();
        let pb: Vec<u64> = b.split('.').filter_map(|s| s.parse().ok()).collect();
        for (x, y) in pa.iter().zip(pb.iter()) {
            if x != y {
                return x > y;
            }
        }
        pa.len() > pb.len()
    }
}

/// 原子写入：先写临时文件再 rename，避免写一半崩溃留下损坏的 manifest
pub(crate) fn write_atomic(path: &PathBuf, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| format!("write {} failed: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("rename {} failed: {e}", path.display()))
}

/// 平台标识：`macos` -> `darwin`，`aarch64` -> `arm64`（§7 字段约定）
pub(crate) fn platform_ids() -> (String, String) {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let platform = if os == "macos" { "darwin" } else { os };
    let arch = if arch == "aarch64" { "arm64" } else { arch };
    (platform.to_string(), arch.to_string())
}

/// 当前日期 `YYYY.MM.DD`（纯 Rust 实现，无 chrono 依赖）
pub(crate) fn today_yyyymmdd() -> String {
    let days = unix_days();
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}.{m:02}.{d:02}")
}

/// 当前 UTC 时间 `YYYY-MM-DDTHH:MM:SSZ`
pub(crate) fn now_rfc3339() -> String {
    let secs = unix_seconds();
    let days = secs / 86_400;
    let (y, m, d) = civil_from_days(days);
    let tod = secs % 86_400;
    let h = tod / 3600;
    let mi = (tod % 3600) / 60;
    let s = tod % 60;
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn unix_days() -> i64 {
    unix_seconds() / 86_400
}

/// 从 Unix 天数计算公历日期（Howard Hinnant's civil_from_days 算法）
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_gt_compares_numeric_segments() {
        assert!(RuntimeManifest::version_gt("2026.08.16.1", "2026.08.15.1"));
        assert!(RuntimeManifest::version_gt("2026.08.15.2", "2026.08.15.1"));
        assert!(!RuntimeManifest::version_gt("2026.08.15.1", "2026.08.15.1"));
        assert!(!RuntimeManifest::version_gt("2026.08.15.1", "2026.08.16.1"));
    }

    #[test]
    fn civil_date_is_correct() {
        // 1970-01-01
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2026-08-15（与 Python datetime 校验一致）
        assert_eq!(civil_from_days(20680), (2026, 8, 15));
        // 2026-08-10
        assert_eq!(civil_from_days(20675), (2026, 8, 10));
    }
}
