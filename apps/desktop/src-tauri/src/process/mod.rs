pub mod utils;

use crate::config;
use crate::process::utils::{is_dsh_running, spawn_output_readers};
use std::collections::HashMap;
use std::fs;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

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

    Ok(())
}

/// 应用退出时同步回收 Harness 进程。
///
/// 退出路径上不更新状态、不做异步等待，仅强制结束端口占用者及其进程树，
/// 避免残留进程占用端口导致下次启动失败。
pub fn stop_on_exit(_app_handle: tauri::AppHandle, port: u16) {
    kill_port_holder(port);
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
