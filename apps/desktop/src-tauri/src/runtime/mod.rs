//! 随 Desktop Release 分发的 Harness Runtime 管理。
//!
//! Runtime 在内部保持版本化，以支持安全切换和自动回滚：
//!
//! ```text
//! Harness + Extension Pack + Compatibility Fix
//! ```
//!
//! - `manifest`：Runtime Manifest 定义、本地 `current.json` / `previous.json` 读写、版本比较。
//! - `manager`：旧目录迁移、内置 zip 校验、激活、健康检查与失败回滚。

pub mod manager;
pub mod manifest;
