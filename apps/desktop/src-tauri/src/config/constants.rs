use std::time::Duration;

/// 支持的 Node.js 版本基线（本机 Node 方案：直接使用用户本机 Node，缺失/不兼容即报错）
pub const NODE_VERSION: &str = "v22.22.0";

/// Harness 服务地址与默认端口
pub const DSH_HOST: &str = "http://127.0.0.1";
pub const DSH_PORT: u16 = 3080;

/// 安装目录与 CLI 入口（相对安装目录）
pub const DSH_CORE_DIR: &str = "dsh";
pub const DSH_ENTRY_RELATIVE: &str = "node_modules/@deepseek-ai/dsh/lib/bin.js";
pub const DSH_MANIFEST_RELATIVE: &str = "package.json";

/// 数据目录名（$DSH_HOME 的相对目录）
pub const DSH_DATA_DIR_NAME: &str = "dsh";

/// 简单 Store 持久化
pub const STORE_DAT_FILE: &str = ".store.dat";
pub const STORE_SETTING_KEY: &str = "setting";

/// 健康检查超时
pub const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(5);
