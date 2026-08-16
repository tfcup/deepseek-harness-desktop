use crate::config::{DSH_HOST, DSH_PORT};

/// 获取 Harness 服务基础地址
pub fn get_dsh_base_url() -> String {
    format!("{}:{}", DSH_HOST, DSH_PORT)
}

/// 获取指定端口的 Harness 服务地址
pub fn get_dsh_service_url(port: u16) -> String {
    format!("{}:{}", DSH_HOST, port)
}
