use std::time::Duration;
use tauri::AppHandle;
use tokio::time;

pub fn start(app_handle: &AppHandle) {
    log::info!("Starting dsh process monitor");
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        scheduler_permanent_loop(app_handle_clone).await;
    });
}

async fn scheduler_permanent_loop(app_handle: AppHandle) {
    let mut interval = time::interval(Duration::from_secs(1));

    loop {
        crate::health::trigger(app_handle.clone())
            .await
            .unwrap();
        crate::config::check_and_emit_theme(&app_handle);
        interval.tick().await;
    }
}
