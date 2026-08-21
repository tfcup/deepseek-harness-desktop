mod bridge;
mod config;
mod core;
mod font;
mod logger;
mod node;
mod process;
mod runtime;
mod service;

use core::utils::show_window;
use tauri::{
    ipc::Invoke,
    menu::{Menu, MenuEvent, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, Runtime, Wry,
};

// setup app
fn setup(app_handle: tauri::AppHandle) {
    // Harness 主题偏好由其设置文件持有；低频轮询只负责同步外层加载/错误界面。
    service::scheduler::start(&app_handle);

    // dsh-ui 属于桌面 App 的原生桥接层，必须优先覆盖旧 Runtime 携带的副本。
    // 覆盖安装新版 App 后即可出现新的设置入口，同时保留全部 Harness 用户数据。
    if let Err(e) = runtime::manager::install_bundled_desktop_ui_extension(&app_handle) {
        log::warn!("Bundled desktop UI extension install failed: {}", e);
    }

    // Runtime 安装与 Harness 启动必须严格串行；由前端 boot 调用 launch_harness，
    // 避免旧版的多个后台任务同时迁移、解压和拉起同一服务。
}

// setup tray
fn tray<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    // 使用默认窗口图标
    let icon = app.default_window_icon().unwrap().clone();

    // 构建菜单
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", "打开面板", true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?,
        ],
    )?;

    fn handle_menu_event<R: Runtime>(app: &tauri::AppHandle<R>, event: &MenuEvent) {
        match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    show_window(&window);
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        }
    }

    fn handle_tray_icon_event<R: Runtime>(tray: &tauri::tray::TrayIcon<R>, event: &TrayIconEvent) {
        let app = tray.app_handle();
        match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } => {
                if let Some(window) = app.get_webview_window("main") {
                    show_window(&window);
                }
            }
            _ => {}
        }
    }

    // 构建托盘图标
    let _ = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Deepseek Harness Desktop")
        .on_menu_event(move |app, event| handle_menu_event(app, &event))
        .on_tray_icon_event(move |tray, event| handle_tray_icon_event(&tray, &event))
        .build(app)?;

    Ok(())
}

// configure invoke handler
fn handler() -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        bridge::cmd::launch_harness,
        bridge::cmd::shutdown_harness,
        bridge::cmd::proxy_health_check,
        bridge::cmd::get_runtime_info,
        bridge::cmd::set_language,
        bridge::cmd::get_dsh_theme,
        bridge::cmd::list_system_fonts,
    ]
}

// configure tauri builder
fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        // 点击关闭按钮时隐藏到托盘而不是退出程序
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        // Simple Store plugin
        .plugin(tauri_plugin_store::Builder::new().build())
        // Process plugin：Updater 安装完成后正常重启当前 App
        .plugin(tauri_plugin_process::init())
        // Updater plugin（§18 Desktop Update；pubkey/endpoints 来自 tauri.conf.json plugins.updater）
        .plugin(tauri_plugin_updater::Builder::new().build())
}

// run app
pub fn run() {
    // 初始化日志系统
    logger::init();

    builder()
        .setup(|app| {
            tray(&app.handle()).unwrap();
            setup(app.handle().clone());
            Ok(())
        })
        .invoke_handler(handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 退出时回收 Harness 进程：不回收的话，node 进程会在应用退出后
            // 残留并把原生模块 DLL（如 sharp 的 libvips-42.dll）锁在内存，
            // 下次启动重新解压时会失败（Windows os error 32）
            if let tauri::RunEvent::Exit = event {
                let setting = config::get_store_dat_setting(app_handle);
                if setting.installed {
                    process::stop_on_exit(app_handle.clone(), setting.port);
                }
            }
        });
}
