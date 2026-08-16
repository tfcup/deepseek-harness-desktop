//! Harness Runtime 管理（设计文档 §6 / §7 / §13 / §14）。
//!
//! Runtime 是与 Desktop App 版本完全分离的发行单元：
//!
//! ```text
//! Harness + Node + Extension Pack + Compatibility Fix
//! ```
//!
//! - `manifest`：Runtime Manifest 定义、本地 `current.json` / `previous.json` 读写、版本比较。
//! - `manager`：多版本管理、首次导入、本地 zip 安装（SHA256 → staging → 激活 → 健康检查 → 回滚）。
//! - `update`：channel manifest 获取、更新检查、远程下载安装。

pub mod manager;
pub mod manifest;
pub mod update;
