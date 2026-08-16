pub mod status;
pub mod utils;

use crate::config;
use crate::service::download;
use crate::process::utils::{is_dsh_running, spawn_output_readers};
use std::collections::HashMap;
use std::fs;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

/// 启动守卫：并发调用 `launch` 时只允许一个真正拉起 dsh 进程
static LAUNCH_GUARD: AtomicBool = AtomicBool::new(false);

/// 端口是否被某个进程监听（LISTEN 状态，lsof 精确判定）。
/// 只检测"监听者"，不检测普通连接：浏览器等仅持有到端口连接（非监听）的进程不算占用，
/// 避免误判/误杀无关进程。
fn is_port_listened(port: u16) -> bool {
    let out = Command::new("sh")
        .arg("-c")
        .arg(format!("lsof -nP -iTCP:{} -sTCP:LISTEN -t", port))
        .output();
    match out {
        Ok(o) => !o.stdout.is_empty(),
        Err(e) => {
            log::debug!("Failed to probe port {port} listener: {e}");
            false
        }
    }
}

/// 强制结束监听指定端口的进程（仅 LISTEN 状态的监听者；用于停止服务或清理僵尸进程）。
/// 绝不使用 `lsof -i` 全量匹配：只有监听 socket 才会被结束，
/// 仅持有普通连接（非监听）的无关进程不会被误杀。
fn kill_port_holder(port: u16) {
    // 使用 lsof 找到监听端口的进程并强制结束
    let _ = Command::new("sh")
        .arg("-c")
        .arg(format!(
            "lsof -nP -iTCP:{} -sTCP:LISTEN -t | xargs kill -9",
            port
        ))
        .output();
}

/// 检测并启动 Harness 服务
pub async fn start(app_handle: tauri::AppHandle) -> Result<(), String> {
    let setting = config::get_store_dat_setting(&app_handle);
    let dsh_binary_path = config::get_dsh_binary_path(&app_handle);

    if !setting.installed {
        log::debug!("Harness not installed, skipping startup");
        return Ok(());
    }
    // 本机 Node 方案（§15 修订）：缺失/不兼容直接报错，不下载、不内置
    config::require_local_node()?;
    if !dsh_binary_path.exists() {
        let mut setting = config::get_store_dat_setting(&app_handle);
        setting.installed = false;
        config::set_store_dat_setting(&app_handle, setting);
        log::debug!("Harness not installed, skipping startup");
        return Ok(());
    }

    log::debug!("Checking Harness running status");

    // 无条件重建（数据隔离）：端口上有任何监听进程——无论是否本应用拉起的 dsh，
    // 还是外部 CLI dsh——都先结束监听者，再启动自己的实例。
    // 只针对 LISTEN 监听者，绝不触碰仅持有普通连接的无关进程。
    if is_port_listened(setting.port) {
        log::info!(
            "Port {} has a listening process, stopping it before starting own instance",
            setting.port
        );
        stop(app_handle.clone()).await?;
    }

    log::info!("Starting Harness service");
    status::set_status(status::Status::Starting);
    status::emit_status(&app_handle);
    launch(app_handle).await?;
    // 之后由 scheduler/health 检测状态

    Ok(())
}

/// 重启 Harness 服务
pub async fn restart(app_handle: tauri::AppHandle) -> Result<(), String> {
    log::info!("Restarting Harness service");

    // 1. 停止现有服务
    stop(app_handle.clone()).await?;

    // 2. 重新启动
    start(app_handle).await?;

    Ok(())
}

/// 启动 Harness 服务进程
pub async fn launch(app_handle: tauri::AppHandle) -> Result<(), String> {
    let setting = config::get_store_dat_setting(&app_handle);
    let node_binary_path = config::get_node_binary_path(&app_handle);
    let dsh_binary_path = config::get_dsh_binary_path(&app_handle);

    // 本机 Node 方案（§15 修订）：使用本机 Node，缺失/不兼容直接报错
    config::require_local_node()?;
    log::debug!("Checking Harness path: {:?}", dsh_binary_path);
    if !dsh_binary_path.exists() {
        log::error!("Harness not installed");
        return Err("HARNESS_NOT_FOUND: Harness not installed".to_string());
    }

    // 启动守卫：并发调用时只允许一个真正拉起 dsh 进程
    if LAUNCH_GUARD.swap(true, Ordering::SeqCst) {
        log::info!("Harness launch already in progress, skipping");
        return Ok(());
    }

    // 端口被监听但服务未响应：先清理僵尸监听者，避免 dsh EADDRINUSE 崩溃
    if is_port_listened(setting.port) {
        log::warn!(
            "Port {} is occupied but harness is not responding, cleaning up",
            setting.port
        );
        kill_port_holder(setting.port);
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    }

    // 构造环境变量：隔离的 $DSH_HOME + 隐私默认（关闭遥测）
    let dsh_home = config::get_dsh_data_path(&app_handle);
    fs::create_dir_all(&dsh_home).map_err(|e| format!("create dsh home failed: {e}"))?;
    let mut envs: HashMap<String, String> = HashMap::new();
    envs.insert("DSH_HOME".to_string(), dsh_home.to_string_lossy().into_owned());
    envs.insert("DSH_TELEMETRY_DISABLED".to_string(), "1".to_string());
    envs.insert("NO_COLOR".to_string(), "1".to_string());
    envs.insert("DSH_WEB_PORT".to_string(), setting.port.to_string());

    // 扩展 PATH，让 dsh 及其子进程能找到 node
    if let Some(node_dir) = node_binary_path.parent() {
        if let Some(existing_path) = std::env::var_os("PATH") {
            let mut paths = vec![node_dir.to_path_buf()];
            paths.extend(std::env::split_paths(&existing_path));
            if let Ok(new_path) = std::env::join_paths(paths) {
                envs.insert("PATH".to_string(), new_path.to_string_lossy().into_owned());
            }
        }
    }

    // 日志文件（前端日志面板读取）
    let log_path = config::get_service_log_path(&app_handle);
    fs::create_dir_all(log_path.parent().unwrap_or(std::path::Path::new(".")))
        .map_err(|e| format!("create log dir failed: {e}"))?;

    log::info!("Starting Harness process");

    let spawn_result = {
        let mut cmd = Command::new(&node_binary_path);
        cmd.arg(&dsh_binary_path)
            .arg("--profile")
            .arg("web")
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(&setting.port.to_string())
            .envs(&envs)
            .current_dir(config::get_dsh_install_path(&app_handle))
            // 核心修正：提供一个空的 stdin 防止 setRawMode 报错
            .stdin(Stdio::null())
            // 使用管道捕获输出，以便在子线程中读取
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd.spawn().map(|mut child| {
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            (stdout, stderr)
        })
    };

    match spawn_result {
        Ok((stdout, stderr)) => {
            log::info!("Harness process started successfully");
            spawn_output_readers(stdout, stderr, log_path);

            // 后台等待 dsh 就绪后释放启动守卫，覆盖启动窗口内的并发调用
            tauri::async_runtime::spawn(async move {
                for _ in 0..15 {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    if is_dsh_running().await {
                        break;
                    }
                }
                LAUNCH_GUARD.store(false, Ordering::SeqCst);
            });

            Ok(())
        }
        Err(e) => {
            LAUNCH_GUARD.store(false, Ordering::SeqCst);
            log::error!("Failed to start process: {}", e);
            Err(format!("Failed to start process: {}", e))
        }
    }
}

/// 停止 Harness 服务
pub async fn stop(app_handle: tauri::AppHandle) -> Result<(), String> {
    log::info!("Stopping Harness service...");
    let port = config::get_store_dat_setting(&app_handle).port;

    // 重置启动守卫，确保后续 launch 可以重新拉起
    LAUNCH_GUARD.store(false, Ordering::SeqCst);
    kill_port_holder(port);

    // 给系统一点时间释放端口 (重要！)
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;

    status::set_status(status::Status::Stopped);
    status::emit_status(&app_handle);
    Ok(())
}

/// 应用退出时同步回收 Harness 进程。
///
/// 退出路径上不更新状态、不做异步等待，仅强制结束端口占用者及其进程树，
/// 避免残留进程占用端口导致下次启动失败。
pub fn stop_on_exit(_app_handle: tauri::AppHandle, port: u16) {
    kill_port_holder(port);
}

/// 安装环境（打包的 Harness 发行版；Node.js 使用本机安装，缺失/不兼容即报错）
pub async fn install(
    app_handle: &tauri::AppHandle,
    dsh_latest_commit: Option<String>,
) -> Result<(), String> {
    log::info!("Starting installation process");

    // 本机 Node 方案（§15 修订）：先校验本机 Node，缺失/不兼容直接报错（不下载、不内置）
    config::require_local_node()?;

    // 安装前先停止正在运行的 Harness 服务，避免运行中的进程占用文件导致覆盖解压失败。
    // 注意不能只依赖 HTTP 探测：服务崩溃/失去响应时探测不到，因此探测不到时也要强制清理。
    if is_dsh_running().await {
        log::info!("Stopping running Harness service before installation");
        stop(app_handle.clone()).await?;
    } else {
        log::warn!("Harness service not responding, force cleaning dsh processes");
        kill_port_holder(config::get_store_dat_setting(&app_handle).port);
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    }

    let window = app_handle
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;
    log::debug!("Main window obtained");
    let mut tracker = download::ProgressTracker::new(&window, 2);
    let tasks: Vec<Box<dyn download::Installable>> = vec![Box::new(download::Dsh)];
    log::info!("Task list created, {} tasks total", tasks.len());

    for (index, task) in tasks.iter().enumerate() {
        log::debug!("Processing task {}/{}", index + 1, tasks.len());
        // 已安装但 commit 与最新 release 不一致时强制重新下载
        let outdated = index == 0
            && dsh_latest_commit.is_some()
            && config::get_dsh_pkg_commit(app_handle).as_deref() != dsh_latest_commit.as_deref();
        if task.check_installed(app_handle) && !outdated {
            log::debug!(
                "Task {} already installed and up to date, skipping",
                index + 1
            );
            tracker.skip_phases(2);
            continue;
        }

        log::info!("Task {} not installed, starting installation", index + 1);

        // 1. 下载
        tracker.start_phase("download", &format!("{} {}", config::i18n::t("install.downloading"), task.title()));
        let url = task.get_download_url()?;
        log::debug!("Download URL: {}", url);
        let name = url.split('/').last().unwrap().to_string();
        log::debug!("File name: {}", name);
        let buffer = download::download_file(&tracker, url).await?;
        log::info!("Download completed, file size: {} bytes", buffer.len());
        tracker.end_phase();

        // 2. 解压
        tracker.start_phase("extract", &format!("{} {}", config::i18n::t("install.extracting"), task.title()));
        let dest = task.get_install_path(app_handle);
        log::debug!("Installation path: {:?}", dest);
        download::ensure_extract(&tracker, name, buffer, dest)?;
        log::info!("Extraction completed");
        tracker.end_phase();

        // 记录本次安装对应的 release commit，供下次启动比对
        if index == 1 {
            if let Some(commit) = &dsh_latest_commit {
                config::set_dsh_pkg_commit(app_handle, commit.clone());
            }
        }
    }

    log::info!("All installation tasks completed");
    tracker.update(
        100.0,
        config::i18n::t("install.done"),
        "All tasks completed".into(),
    );

    // 将本次安装纳入版本化 Runtime 布局（生成第一个版本目录 + current.json）
    if let Err(e) = crate::runtime::manager::ensure_runtime_import(app_handle) {
        log::warn!("Runtime import failed: {}", e);
    }

    Ok(())
}

/// 健康检查（通过 Rust 代理，避免 WebView CORS 问题）
pub async fn proxy_health_check(port: u16) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(config::HEALTH_CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    for endpoint in [
        format!("http://127.0.0.1:{port}/"),
        format!("http://127.0.0.1:{port}/healthz"),
    ] {
        match client.get(&endpoint).send().await {
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                if status.is_success() {
                    return Ok(format!(
                        "healthy - {status} - {}",
                        body.chars().take(80).collect::<String>()
                    ));
                }
            }
            Err(err) => {
                log::debug!("Health check {endpoint}: {err}");
            }
        }
    }
    Err("HARNESS_NOT_READY: Harness service is not ready".to_string())
}
