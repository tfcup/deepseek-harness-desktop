import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { useI18n } from "../i18n/context";

export interface RuntimeInfo {
  app_version: string;
  dsh_version: string | null;
  runtime_version: string | null;
  extension_version: string | null;
  node_version: string;
  service_url: string;
  data_dir: string;
  log_path: string;
  platform: string;
  arch: string;
}

export interface VersionInfo {
  runtime_version: string;
  harness_version: string;
  node_version: string;
  active: boolean;
}

export interface RuntimeStatus {
  current: VersionInfo | null;
  previous: VersionInfo | null;
  versions: VersionInfo[];
}

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  url: string;
  sha256: string;
}

export interface AppConfig {
  port: number;
  auto_start: boolean;
}

export type SidebarBusyAction = "restart" | "shutdown" | "start" | "openBrowser" | null;

interface SidebarPanelProps {
  open: boolean;
  serviceRunning: boolean;
  busyAction: SidebarBusyAction;
  onClose: () => void;
  onRestart: () => void;
  onShutdown: () => void;
  onStart: () => void;
  onOpenBrowser: () => void;
}

// 按钮内的小型加载指示器：边框旋转动画，颜色跟随当前文字
function Spinner() {
  return (
    <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}

export default function SidebarPanel({
  open,
  serviceRunning,
  busyAction,
  onClose,
  onRestart,
  onShutdown,
  onStart,
  onOpenBrowser,
}: SidebarPanelProps) {
  const { t, language, setLanguage } = useI18n();
  const btnBase =
    "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line bg-panel2 px-2 py-1 text-xs text-ink transition-colors hover:border-line-strong hover:bg-panel-hover disabled:cursor-not-allowed disabled:opacity-55";
  const btnPrimary = `${btnBase} border-accent bg-accent text-white hover:border-accent2 hover:bg-accent2`;
  const btnDanger = `${btnBase} border-[rgba(229,72,77,0.4)] text-danger`;
  const btnBlock = " mt-1.5 w-full";
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [port, setPort] = useState("3080");
  const [autoStart, setAutoStart] = useState(true);
  const [logs, setLogs] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rtStatus, setRtStatus] = useState<RuntimeStatus | null>(null);
  const [channelUrl, setChannelUrl] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [rtBusy, setRtBusy] = useState<string | null>(null);
  const [duInfo, setDuInfo] = useState<{ latest: string; available: boolean; error: string | null } | null>(null);
  const [duBusy, setDuBusy] = useState<string | null>(null);

  const refreshInfo = async () => {
    if (busy) return;
    setBusy("refreshInfo");
    try {
      const nextInfo = await invoke<RuntimeInfo>("get_runtime_info");
      setInfo(nextInfo);
    } catch (err) {
      console.error("[SidebarPanel] failed to load runtime info:", err);
    } finally {
      setBusy(null);
    }
  };

  const refreshRuntimeStatus = async () => {
    if (rtBusy) return;
    setRtBusy("refresh");
    try {
      setRtStatus(await invoke<RuntimeStatus>("get_runtime_status"));
    } catch (err) {
      console.error("[SidebarPanel] failed to load runtime status:", err);
    } finally {
      setRtBusy(null);
    }
  };

  const handleCheckUpdate = async () => {
    if (rtBusy) return;
    setRtBusy("check");
    try {
      const next = await invoke<UpdateInfo>("check_runtime_update", { channelUrl });
      setUpdateInfo(next);
      setNotice(
        next.has_update
          ? `${t("ui.runtime_update_available")} ${next.latest_version}`
          : t("ui.runtime_up_to_date"),
      );
    } catch (err) {
      console.error("[SidebarPanel] check update failed:", err);
      setNotice(String(err));
    } finally {
      setRtBusy(null);
    }
  };

  const handleInstallUpdate = async () => {
    if (rtBusy) return;
    setRtBusy("install");
    try {
      const m = await invoke<{ runtime_version: string }>("install_runtime_update", {
        channelUrl,
      });
      setUpdateInfo(null);
      setNotice(`${t("ui.runtime_installed")} ${m.runtime_version}`);
      await refreshRuntimeStatus();
      await refreshInfo();
    } catch (err) {
      console.error("[SidebarPanel] install update failed:", err);
      setNotice(String(err));
    } finally {
      setRtBusy(null);
    }
  };

  const handleRollback = async () => {
    if (rtBusy) return;
    setRtBusy("rollback");
    try {
      const msg = await invoke<string>("rollback_runtime");
      setNotice(msg);
      setUpdateInfo(null);
      await refreshRuntimeStatus();
      await refreshInfo();
    } catch (err) {
      console.error("[SidebarPanel] rollback failed:", err);
      setNotice(String(err));
    } finally {
      setRtBusy(null);
    }
  };

  // --- Desktop Update（§18/§19，Tauri Updater 分支） ---
  const handleCheckDesktopUpdate = async () => {
    if (duBusy) return;
    setDuBusy("check");
    try {
      const update = await check();
      if (update) {
        setDuInfo({ latest: update.version, available: true, error: null });
        setNotice(`${t("ui.desktop_update_available")} ${update.version}`);
      } else {
        setDuInfo({ latest: info?.app_version ?? "-", available: false, error: null });
        setNotice(t("ui.desktop_up_to_date"));
      }
    } catch (err) {
      console.error("[SidebarPanel] desktop update check failed:", err);
      setDuInfo({ latest: "-", available: false, error: String(err) });
      setNotice(String(err));
    } finally {
      setDuBusy(null);
    }
  };

  const handleInstallDesktopUpdate = async () => {
    if (duBusy) return;
    setDuBusy("install");
    try {
      const update = await check();
      if (!update) {
        setNotice(t("ui.desktop_up_to_date"));
        return;
      }
      await update.downloadAndInstall();
      setNotice(t("ui.desktop_update_restart"));
    } catch (err) {
      console.error("[SidebarPanel] desktop update install failed:", err);
      setNotice(String(err));
    } finally {
      setDuBusy(null);
    }
  };

  const refreshConfig = async () => {
    try {
      const nextConfig = await invoke<AppConfig>("get_app_config");
      setPort(String(nextConfig.port));
      setAutoStart(nextConfig.auto_start);
    } catch (err) {
      console.error("[SidebarPanel] failed to load config:", err);
    }
  };

  const refreshLogs = async () => {
    if (busy) return;
    setBusy("refreshLogs");
    try {
      setLogs(await invoke<string>("read_service_logs", { maxBytes: 64 * 1024 }));
    } catch (err) {
      console.error("[SidebarPanel] failed to read logs:", err);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    refreshInfo();
    refreshConfig();
    refreshLogs();
    refreshRuntimeStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const nextPort = Number(port);
      const nextConfig = await invoke<AppConfig>("update_app_config", {
        port: Number.isInteger(nextPort) && nextPort > 0 ? nextPort : null,
        autoStart,
      });
      setPort(String(nextConfig.port));
      setNotice(t("messages.config_saved"));
    } catch (err) {
      console.error("[SidebarPanel] failed to save config:", err);
      setNotice(t("messages.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    if (busy) return;
    setBusy("copy");
    try {
      await invoke("copy_service_url");
      setNotice(t("messages.copy_success"));
    } catch {
      setNotice(t("messages.copy_failed"));
    } finally {
      setBusy(null);
    }
  };

  const clearLogs = async () => {
    if (busy) return;
    setBusy("clearLogs");
    try {
      await invoke("clear_service_logs");
      setLogs("");
      setNotice(t("messages.logs_cleared"));
    } catch (err) {
      console.error("[SidebarPanel] failed to clear logs:", err);
    } finally {
      setBusy(null);
    }
  };

  const revealDataDir = async () => {
    if (busy) return;
    setBusy("revealDataDir");
    try {
      await invoke("reveal_data_dir");
    } catch (err) {
      console.error("[SidebarPanel] failed to reveal data dir:", err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {/* 点击侧边栏外内容时关闭侧边栏；透明遮罩位于内容之上、侧边栏(以及窗口控制)之下 */}
      {open && <div aria-hidden onClick={onClose} className="fixed inset-0 z-[25]" />}
      <aside
        className={`fixed top-14.5 right-0 bottom-0 z-30 flex w-[300px] flex-col overflow-y-auto border-l border-t rounded-md border-line bg-panel shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
      <div className="px-3 pt-4 pb-5">
        <div className="mb-[18px]">
          <h3 className="mb-2 flex items-center justify-between gap-1.5 text-xs uppercase tracking-[0.06em] text-muted">{t("ui.connection_status")}</h3>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              serviceRunning ? "bg-[rgba(70,167,88,0.15)] text-ok" : "bg-[rgba(229,72,77,0.15)] text-danger"
            }`}
          >
            {serviceRunning ? t("ui.running") : t("ui.stopped")}
          </span>
        </div>

        <div className="mb-[18px]">
          <h3 className="mb-2 flex items-center justify-between gap-1.5 text-xs uppercase tracking-[0.06em] text-muted">{t("ui.service_url")}</h3>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 truncate rounded-md border border-line bg-panel2 px-2 py-1.5 text-xs">{info?.service_url ?? "-"}</code>
            <button className={btnBase} onClick={copyUrl} disabled={busy === "copy"} title={t("app.copy_url")}>
              {busy === "copy" && <Spinner />}
              {t("buttons.copy")}
            </button>
          </div>
          <button
            className={`${btnBase}${btnBlock}`}
            onClick={onOpenBrowser}
            disabled={busyAction !== null}
          >
            {busyAction === "openBrowser" && <Spinner />}
            {t("app.open_browser")}
          </button>
        </div>

        <div className="mb-[18px]">
          <h3 className="mb-2 flex items-center justify-between gap-1.5 text-xs uppercase tracking-[0.06em] text-muted">{t("ui.actions")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {serviceRunning ? (
              <>
                <button className={btnBase} onClick={onRestart} disabled={busyAction !== null}>
                  {busyAction === "restart" && <Spinner />}
                  {t("app.restart")}
                </button>
                <button className={btnDanger} onClick={onShutdown} disabled={busyAction !== null}>
                  {busyAction === "shutdown" && <Spinner />}
                  {t("app.shutdown")}
                </button>
              </>
            ) : (
              <button className={btnPrimary} onClick={onStart} disabled={busyAction !== null}>
                {busyAction === "start" && <Spinner />}
                {t("app.retry")}
              </button>
            )}
            <button className={btnBase} onClick={refreshInfo} disabled={busy === "refreshInfo"}>
              {busy === "refreshInfo" && <Spinner />}
              {t("app.refresh")}
            </button>
          </div>
        </div>

        <div className="mb-[18px]">
          <h3 className="mb-2 flex items-center justify-between gap-1.5 text-xs uppercase tracking-[0.06em] text-muted">{t("ui.app_info")}</h3>
          <dl className="m-0 text-xs">
            <dt className="mt-1.5 text-muted">{t("ui.current_version")}</dt>
            <dd className="mt-0.5 break-all">{info?.app_version ?? "-"}</dd>
            <dt className="mt-1.5 text-muted">{t("ui.dsh_version")}</dt>
            <dd className="mt-0.5 break-all">{info?.dsh_version ?? "-"}</dd>
            <dt className="mt-1.5 text-muted">{t("ui.runtime_version")}</dt>
            <dd className="mt-0.5 break-all">{info?.runtime_version ?? "-"}</dd>
            <dt className="mt-1.5 text-muted">{t("ui.extension_version")}</dt>
            <dd className="mt-0.5 break-all">{info?.extension_version ?? "-"}</dd>
            <dt className="mt-1.5 text-muted">{t("ui.node_version")}</dt>
            <dd className="mt-0.5 break-all">v{info?.node_version ?? "-"}</dd>
            <dt className="mt-1.5 text-muted">Platform</dt>
            <dd className="mt-0.5 break-all">
              {info?.platform ?? "-"} / {info?.arch ?? "-"}
            </dd>
            <dt className="mt-1.5 text-muted">{t("ui.data_dir")}</dt>
            <dd className="mt-0.5 flex items-center justify-center gap-2" title={info?.data_dir}>
              <div className="break-all truncate">{info?.data_dir ?? "-"}</div>
              <button className={`${btnBase} flex-shrink-0 text-[10px]`} onClick={revealDataDir} disabled={busy === "revealDataDir"}>
                {busy === "revealDataDir" && <Spinner />}
                {t("app.reveal_dir")}
              </button>
            </dd>
          </dl>
        </div>

        <div className="mb-[18px]">
          <h3 className="mb-2 flex items-center justify-between gap-1.5 text-xs uppercase tracking-[0.06em] text-muted">{t("ui.desktop_update")}</h3>
          <dl className="m-0 text-xs">
            <dt className="mt-1.5 text-muted">{t("ui.current_version")}</dt>
            <dd className="mt-0.5 break-all">{info?.app_version ?? "-"}</dd>
            <dt className="mt-1.5 text-muted">{t("ui.desktop_latest")}</dt>
            <dd className="mt-0.5 break-all">{duInfo?.latest ?? "-"}</dd>
            {duInfo?.error && (
              <dd className="mt-1 break-all text-danger">{duInfo.error}</dd>
            )}
          </dl>
          <div className="mt-2 flex gap-1.5">
            <button className={btnBase} onClick={handleCheckDesktopUpdate} disabled={duBusy !== null}>
              {duBusy === "check" && <Spinner />}
              {t("ui.desktop_check_update")}
            </button>
            {duInfo?.available && (
              <button className={btnPrimary} onClick={handleInstallDesktopUpdate} disabled={duBusy !== null}>
                {duBusy === "install" && <Spinner />}
                {t("ui.desktop_install_update")}
              </button>
            )}
          </div>
        </div>

        <div className="mb-[18px]">
          <h3 className="mb-2 flex items-center justify-between gap-1.5 text-xs uppercase tracking-[0.06em] text-muted">
            {t("ui.runtime")}
            <button className={btnBase} onClick={refreshRuntimeStatus} disabled={rtBusy === "refresh"} title={t("app.refresh")}>
              {rtBusy === "refresh" ? <Spinner /> : "↻"}
            </button>
          </h3>
          <dl className="m-0 text-xs">
            <dt className="mt-1.5 text-muted">{t("ui.runtime_current")}</dt>
            <dd className="mt-0.5 break-all">
              {rtStatus?.current?.runtime_version ?? info?.runtime_version ?? "-"}
            </dd>
          </dl>
          {rtStatus && rtStatus.versions.length > 0 && (
            <ul className="mt-1.5 space-y-1 text-[11px]">
              {rtStatus.versions.map((v) => (
                <li key={v.runtime_version} className="flex items-center justify-between gap-2">
                  <span className="truncate">{v.runtime_version}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-muted">
                    {v.harness_version}
                    {v.active && <span className="text-accent">●</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <label className="mt-2 block">
            <span className="text-muted">{t("ui.runtime_channel_url")}</span>
            <input
              className="mt-0.5 w-full rounded-md border border-line bg-panel2 px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent/60"
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
              placeholder="https://.../stable.json"
            />
          </label>
          <div className="mt-2 flex gap-1.5">
            <button className={btnBase} onClick={handleCheckUpdate} disabled={rtBusy !== null}>
              {rtBusy === "check" && <Spinner />}
              {t("ui.runtime_check_update")}
            </button>
            {updateInfo?.has_update && (
              <button className={btnPrimary} onClick={handleInstallUpdate} disabled={rtBusy !== null}>
                {rtBusy === "install" && <Spinner />}
                {t("ui.runtime_install_update")}
              </button>
            )}
            <button
              className={btnDanger}
              onClick={handleRollback}
              disabled={rtBusy !== null || !rtStatus?.previous}
              title={rtStatus?.previous ? undefined : t("ui.runtime_no_previous")}
            >
              {rtBusy === "rollback" && <Spinner />}
              {t("ui.runtime_rollback")}
            </button>
          </div>
        </div>

        <div className="mb-[18px]">
          <h3 className="mb-2 flex items-center justify-between gap-1.5 text-xs uppercase tracking-[0.06em] text-muted">{t("ui.settings")}</h3>
          <label className="mb-2 flex items-center gap-2">
            <span>{t("ui.port")}</span>
            <input
              className="flex-1 rounded-md border border-line bg-panel2 px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent/60"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="mb-2 flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
            <span>{t("ui.auto_start")}</span>
          </label>
          <button className={`${btnBase}${btnBlock}`} onClick={saveConfig} disabled={saving}>
            {saving ? (
              <>
                <Spinner />
                {t("ui.saved")}
              </>
            ) : (
              t("ui.save")
            )}
          </button>
          <div className="mt-2.5 flex items-center gap-2 text-[13px]">
            <span>{t("ui.language")}:</span>
            <select
              className="flex-1 rounded-md border border-line bg-panel2 px-2 py-1 text-[13px] text-ink outline-none"
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "zh")}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <h3 className="mb-2 flex items-center justify-between gap-1.5 text-xs uppercase tracking-[0.06em] text-muted">
            {t("ui.logs")}
            <button className={btnBase} onClick={refreshLogs} disabled={busy === "refreshLogs"} title={t("buttons.refresh_logs")}>
              {busy === "refreshLogs" ? <Spinner /> : "↻"}
            </button>
          </h3>
          <pre className="m-0 max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-log-bg px-2 py-2 text-[11px] leading-[1.45] text-log-ink">{logs || t("ui.no_logs")}</pre>
          <button className={btnBase} onClick={clearLogs} disabled={busy === "clearLogs"}>
            {busy === "clearLogs" && <Spinner />}
            {t("buttons.clear_logs")}
          </button>
        </div>

        {notice && (
          <div className="fixed bottom-[18px] left-1/2 z-10 -translate-x-1/2 rounded-lg border border-line bg-panel2 px-3.5 py-2 text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            {notice}
          </div>
        )}
      </div>
    </aside>
    </>
  );
}
