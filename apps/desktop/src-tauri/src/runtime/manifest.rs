//! 内置 Runtime Manifest 与本地激活指针。
//!
//! Runtime 随 Desktop Release 分发；这里保留独立版本是为了在 App 更新后安全切换、
//! 健康检查失败时回滚，而不是向用户提供第二套更新通道。

use crate::config;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

/// Runtime Manifest。新文件使用 camelCase，与构建产物一致；字段 alias 兼容旧版
/// Desktop 已经写入的 snake_case 本地清单。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    #[serde(alias = "schema_version")]
    pub schema_version: u32,
    /// Runtime 版本（独立发行单元，形如 `2026.08.15.1`）
    #[serde(alias = "runtime_version")]
    pub runtime_version: String,
    /// 官方 @deepseek-ai/dsh 版本（如 `0.1.0-rc.12`）
    #[serde(alias = "harness_version")]
    pub harness_version: String,
    /// Desktop Extension Pack 版本。
    #[serde(alias = "extension_version")]
    pub extension_version: String,
    /// 构建 Runtime 时使用的 Node 兼容基线。
    #[serde(alias = "node_version")]
    pub node_version: String,
    pub platform: String,
    pub arch: String,
    pub sha256: String,
    #[serde(alias = "published_at")]
    pub published_at: String,
}

impl RuntimeManifest {
    pub fn current_path<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
        config::get_runtime_current_json(app_handle)
    }

    /// 上一份成功 Runtime 的指针路径，供自动回滚使用。
    pub fn previous_path<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
        config::get_runtime_previous_json(app_handle)
    }

    /// 读取当前生效的 Runtime manifest（文件不存在/损坏时返回 None，调用方优雅降级）
    pub fn load_current<R: Runtime>(app_handle: &AppHandle<R>) -> Option<Self> {
        Self::load_file(&Self::current_path(app_handle))
    }

    /// 读取上一个成功 Runtime manifest。
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

    /// 激活新版前将 current 原子存档为 previous。
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

    /// 校验来自 App Bundle 的清单，避免非法版本成为目录名或加载错误架构产物。
    pub fn validate_bundled(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!("不支持的 Runtime manifest schema：{}", self.schema_version));
        }
        version_parts(&self.runtime_version)
            .ok_or_else(|| format!("Runtime 版本格式无效：{}", self.runtime_version))?;
        if self.harness_version.trim().is_empty() || self.extension_version.trim().is_empty() {
            return Err("Runtime manifest 缺少 Harness 或 Extension Pack 版本".to_string());
        }
        let (platform, arch) = platform_ids();
        if self.platform != platform || self.arch != arch {
            return Err(format!(
                "Runtime 平台不匹配：需要 {platform}/{arch}，收到 {}/{}",
                self.platform, self.arch
            ));
        }
        if self.sha256.len() != 64 || !self.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Runtime manifest SHA256 格式无效".to_string());
        }
        Ok(())
    }

    /// 按 `YYYY.MM.DD.N` 的数值段比较，非法版本永远不会被判定为更新。
    pub fn version_gt(a: &str, b: &str) -> bool {
        match (version_parts(a), version_parts(b)) {
            (Some(left), Some(right)) => left > right,
            _ => false,
        }
    }
}

/// 严格解析 Runtime 版本；固定四段可同时阻止路径穿越和模糊比较。
fn version_parts(value: &str) -> Option<[u64; 4]> {
    let raw: Vec<&str> = value.split('.').collect();
    if raw.len() != 4 || raw[0].len() != 4 || raw[1].len() != 2 || raw[2].len() != 2 {
        return None;
    }
    if raw.iter().any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    let parts = [
        raw[0].parse().ok()?,
        raw[1].parse().ok()?,
        raw[2].parse().ok()?,
        raw[3].parse().ok()?,
    ];
    if !(1..=12).contains(&parts[1]) || !(1..=31).contains(&parts[2]) || parts[3] == 0 {
        return None;
    }
    Some(parts)
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

    /** 创建与当前测试平台匹配的有效内置清单。 */
    fn valid_manifest() -> RuntimeManifest {
        let (platform, arch) = platform_ids();
        RuntimeManifest {
            schema_version: 1,
            runtime_version: "2026.08.21.1".to_string(),
            harness_version: "0.1.0-rc.7".to_string(),
            extension_version: "0.1.0".to_string(),
            node_version: "22.22.0".to_string(),
            platform,
            arch,
            sha256: "a".repeat(64),
            published_at: "2026-08-21T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn version_gt_compares_numeric_segments() {
        assert!(RuntimeManifest::version_gt("2026.08.16.1", "2026.08.15.1"));
        assert!(RuntimeManifest::version_gt("2026.08.15.2", "2026.08.15.1"));
        assert!(!RuntimeManifest::version_gt("2026.08.15.1", "2026.08.15.1"));
        assert!(!RuntimeManifest::version_gt("2026.08.15.1", "2026.08.16.1"));
        assert!(!RuntimeManifest::version_gt("../2026.08.16.1", "2026.08.15.1"));
        assert!(!RuntimeManifest::version_gt("2026.8.16.1", "2026.08.15.1"));
    }

    #[test]
    fn bundled_manifest_rejects_unsafe_version() {
        let mut manifest = valid_manifest();
        assert!(manifest.validate_bundled().is_ok());
        manifest.runtime_version = "../../Library".to_string();
        assert!(manifest.validate_bundled().is_err());
    }

    #[test]
    fn camel_case_manifest_preserves_build_version() {
        let manifest = valid_manifest();
        let json = serde_json::to_string(&manifest).unwrap();
        assert!(json.contains("\"runtimeVersion\":\"2026.08.21.1\""));
        let parsed: RuntimeManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.runtime_version, manifest.runtime_version);
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
