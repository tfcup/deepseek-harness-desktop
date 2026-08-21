use crate::config;
use crate::process;
use tauri::AppHandle;

/// 激活当前 Desktop Release 内置的 Runtime，随后启动并验证 Harness 服务。
/// 新 Runtime 健康检查失败时，Runtime Manager 会在返回错误前自动恢复上一版本。
#[tauri::command]
pub async fn launch_harness(app_handle: AppHandle) -> Result<(), String> {
    crate::runtime::manager::launch_with_bundled_runtime(&app_handle).await
}

/// 停止 Harness 子进程；App Updater 在重启桌面应用前调用它释放端口和文件句柄。
#[tauri::command]
pub async fn shutdown_harness(app_handle: AppHandle) -> Result<(), String> {
    process::stop(app_handle).await
}

/// 通过 Rust 请求本地 Harness，避免 WebView 直接探测产生 CORS 错误。
#[tauri::command]
pub async fn proxy_health_check(app_handle: AppHandle) -> Result<String, String> {
    let port = config::get_store_dat_setting(&app_handle).port;
    process::proxy_health_check(port).await
}

/// 返回内嵌 Harness 页面地址及版本信息；前端只使用 service_url 建立 WebView。
#[tauri::command]
pub async fn get_runtime_info(app_handle: AppHandle) -> Result<config::RuntimeInfo, String> {
    let port = config::get_store_dat_setting(&app_handle).port;
    Ok(config::runtime_info(&app_handle, port))
}

/// 保存桌面外壳语言偏好，并同步 Rust 侧安装/错误消息语言。
#[tauri::command]
pub fn set_language(app_handle: AppHandle, lang: String) {
    let mut setting = config::get_store_dat_setting(&app_handle);
    setting.language = lang.clone();
    config::set_store_dat_setting(&app_handle, setting);
    config::i18n::set_language(match lang.as_str() {
        "en" => config::i18n::Lang::En,
        _ => config::i18n::Lang::Zh,
    });
}

/// 读取 Harness 主题偏好，让外层加载和错误界面与内嵌页面保持一致。
#[tauri::command]
pub fn get_dsh_theme(app_handle: AppHandle) -> config::DshTheme {
    config::get_dsh_theme(&app_handle)
}
