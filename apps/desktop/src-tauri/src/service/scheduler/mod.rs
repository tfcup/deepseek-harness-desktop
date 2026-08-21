use std::time::Duration;
use tauri::AppHandle;
use tokio::time;

/// 启动主题偏好同步任务；它不再维护已删除的桌面侧边栏服务状态。
pub fn start(app_handle: &AppHandle) {
    log::info!("Starting Harness theme preference monitor");
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        scheduler_permanent_loop(app_handle_clone).await;
    });
}

/// 低频读取 Harness 主题设置，仅在变化时由 config 模块发送事件。
async fn scheduler_permanent_loop(app_handle: AppHandle) {
    let mut interval = time::interval(Duration::from_secs(1));

    loop {
        crate::config::check_and_emit_theme(&app_handle);
        interval.tick().await;
    }
}
