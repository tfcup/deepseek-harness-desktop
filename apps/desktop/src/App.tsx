import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import SetupScreen, { InstallProgress, SetupStatus } from "./components/SetupScreen";
import { useI18n } from "./i18n/context";
import { generateTimestampedUrl } from "./hooks/useAutoSync";
import { useDshTheme } from "./hooks/useDshTheme";
import { useDesktopFontBridge } from "./hooks/useDesktopFontBridge";
import { useDesktopUpdaterBridge } from "./hooks/useDesktopUpdaterBridge";

const MAX_RETRIES = 8;

interface InstallerState {
  title: string;
  detail: string;
  percentage: number;
  logs: string[];
}

const initialInstaller: InstallerState = {
  title: "",
  detail: "",
  percentage: 0,
  logs: [],
};

const btnPrimary =
  "inline-flex cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-accent2 disabled:cursor-not-allowed disabled:opacity-55";

/**
 * Desktop 外壳只负责启动内置 Harness、展示其 Web 页面并桥接 App Updater 与本机字体目录。
 * Runtime 选择和失败回滚全部在 Rust 启动命令内完成，不向用户暴露第二套更新界面。
 */
export default function App() {
  const { t } = useI18n();
  useDshTheme();
  const [status, setStatus] = useState<SetupStatus>("ready");
  const [installer, setInstaller] = useState<InstallerState>(initialInstaller);
  const [errorMsg, setErrorMsg] = useState("");
  const [serviceUrl, setServiceUrl] = useState("http://127.0.0.1:3080");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [serviceHealthy, setServiceHealthy] = useState(false);

  const bootToken = useRef(0);
  const bootStartedRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const iframeSrc = useMemo(() => generateTimestampedUrl(serviceUrl), [serviceUrl]);
  useDesktopFontBridge({ iframeRef, serviceUrl });
  useDesktopUpdaterBridge({ iframeRef, serviceUrl });

  /** 重新挂载 WebView，供服务已经健康但页面加载失败时重试。 */
  const refreshIframe = useCallback(() => {
    setIframeLoaded(false);
    setIframeError(false);
    setTimeout(() => setIframeKey((previous) => previous + 1), 800);
  }, []);

  /** 通过 Rust 代理探测本地服务，避免 WebView CORS 影响启动判断。 */
  const checkHealthViaProxy = async (): Promise<boolean> => {
    try {
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("health check timeout")), 8000);
      });
      const result = await Promise.race([invoke<string>("proxy_health_check"), timeout]);
      const normalized = result.toLowerCase();
      return (
        normalized.includes("healthy") ||
        normalized.includes("ready") ||
        normalized.includes("ok") ||
        result.includes("200") ||
        result.includes("201")
      );
    } catch (error) {
      console.debug("[App] health check pending:", error);
      return false;
    }
  };

  /** 监听内置 Runtime 解压进度；异常监听不能阻断 App 启动。 */
  const listenInstallProgress = useCallback(async (): Promise<UnlistenFn> => {
    return listen<InstallProgress>("install-progress", (event) => {
      const payload = event.payload;
      setInstaller((previous) => {
        if (payload.percentage < previous.percentage) return previous;
        return {
          title: payload.title || previous.title,
          detail: payload.detail || previous.detail,
          percentage: payload.percentage,
          logs: payload.log ? [...previous.logs, payload.log].slice(-5) : previous.logs,
        };
      });
    });
  }, []);

  /** 启动命令已经完成 Runtime 激活和首轮健康检查；前端再确认后才挂载页面。 */
  const launchAndWait = useCallback(
    async (url: string) => {
      setStatus("ready");
      setInstaller(initialInstaller);
      setServiceHealthy(false);
      setIframeLoaded(false);
      setIframeError(false);
      await invoke("launch_harness");

      for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        if (await checkHealthViaProxy()) {
          setServiceHealthy(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error(t("errors.service_start_timeout", { port: new URL(url).port || "3080" }));
    },
    [t],
  );

  /** 串行执行内置 Runtime 准备、Harness 启动和页面挂载。 */
  const boot = useCallback(async () => {
    const token = ++bootToken.current;
    setErrorMsg("");
    let unlistenInstall: UnlistenFn | null = null;
    try {
      try {
        unlistenInstall = await listenInstallProgress();
      } catch (error) {
        console.debug("[App] install progress listener unavailable:", error);
      }
      const runtimeInfo = await invoke<{ service_url: string }>("get_runtime_info");
      setServiceUrl(runtimeInfo.service_url);
      await launchAndWait(runtimeInfo.service_url);
    } catch (error) {
      if (token !== bootToken.current) return;
      console.error("[App] startup failed:", error);
      setErrorMsg(String(error));
      setStatus("error");
      setServiceHealthy(false);
    } finally {
      unlistenInstall?.();
    }
  }, [launchAndWait, listenInstallProgress]);

  useEffect(() => {
    // React StrictMode 在开发环境会重复执行 effect，启动流程必须保持单实例。
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    void boot();
  }, [boot]);

  useEffect(() => {
    if (status !== "ready" || !serviceHealthy || iframeLoaded) return;
    const timer = setTimeout(() => setIframeError(true), 20000);
    return () => clearTimeout(timer);
  }, [status, serviceHealthy, iframeLoaded, iframeKey]);

  if (status === "error") {
    return (
      <main className="relative h-screen w-screen bg-canvas">
        <SetupScreen
          status="error"
          title=""
          detail=""
          percentage={installer.percentage}
          logs={installer.logs}
          errorMsg={serviceUrl ? `${errorMsg} (${serviceUrl})` : errorMsg}
          onRetry={boot}
        />
      </main>
    );
  }

  return (
    <main className="relative h-screen w-screen bg-canvas">
      {!iframeLoaded && (
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 bg-canvas text-ink">
          <span className="h-[34px] w-[34px] animate-spin rounded-full border-[3px] border-line border-t-accent" />
          <p>{installer.title || t("status.loading")}</p>
        </div>
      )}
      {serviceHealthy && iframeError && (
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 bg-canvas text-ink">
          <p>{t("ui.iframe_error")}</p>
          <p className="text-muted">{t("ui.ensure_running", { url: serviceUrl })}</p>
          <button className={btnPrimary} onClick={refreshIframe}>
            {t("app.retry")}
          </button>
        </div>
      )}
      {serviceHealthy && (
        <iframe
          ref={iframeRef}
          key={iframeKey}
          className="block h-full w-full border-none bg-white"
          src={iframeSrc}
          onLoad={() => {
            setIframeLoaded(true);
            setIframeError(false);
          }}
          onError={() => {
            setIframeError(true);
            setIframeLoaded(false);
          }}
          title={t("app.open_editor")}
        />
      )}
    </main>
  );
}
