//! Managed Node Runtime（设计文档 §15 / 目录结构 §5 `node/`）。
//!
//! 原则：**始终使用 App Managed Node**，不依赖系统 Node（`/usr/local/bin/node`、
//! `/opt/homebrew/bin/node`、nvm）。
//!
//! 当前实现（Phase 2 已完成）：
//! - Node 安装于 `<app-data>/node/`（`config::get_node_install_path`），带旧路径迁移；
//! - 二进制路径 `config::get_node_binary_path` 固定指向托管运行时（不再复用系统 Node）；
//! - 版本常量 `config::NODE_VERSION`（v22.22.0），并随 Runtime Manifest 记录
//!   `nodeVersion`，随 Runtime 一起升级。
//!
//! 后续（随 Runtime 版本体系演进）：本模块可继续承载 Node 版本矩阵管理、
//! 多版本共存与兼容性校验等能力。
