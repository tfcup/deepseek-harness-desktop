//! 本机 Node.js 策略（设计文档 §15 修订版 / 目录结构 §5 `node/`）。
//!
//! 原则（§15 修订）：**直接使用用户本机安装的 Node.js**，不下载、不内置；
//! 本机缺失或不兼容时**直接报错**（不联网下载、不静默跳过）。
//!
//! 当前实现：
//! - 查找范围：PATH + `/opt/homebrew/bin` + `/usr/local/bin`（`config::find_local_node_binary`）；
//! - 版本要求：v22.15+ / v23.8+ / v24+（`config::require_local_node`，缺失/不兼容返回明确错误）；
//! - 支持基线常量 `config::NODE_VERSION`（v22.22.0），随 Runtime Manifest 记录
//!   `nodeVersion`（本机实际版本，读取失败时回退支持基线）。
//!
//! 设计演进：早期版本曾内置 Managed Node（§15 原案），后按分发诉求改为本机 Node。
