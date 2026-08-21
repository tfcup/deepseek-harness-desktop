import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";

const REQUEST_TYPE = "dsh-desktop:update-request-v1";
const STATE_TYPE = "dsh-desktop:update-state-v1";

type UpdateAction = "get-state" | "check" | "install" | "relaunch";
type UpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "restart-required"
  | "error";

interface UpdateRequest {
  type: typeof REQUEST_TYPE;
  action: UpdateAction;
}

interface UpdateBridgeState {
  type: typeof STATE_TYPE;
  desktop: true;
  connected: true;
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion?: string;
  notes?: string;
  progress: number;
  error?: string;
}

interface DesktopUpdaterBridgeOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  serviceUrl: string;
}

/** 判断跨窗口消息是否属于桌面更新协议，拒绝形状相似的任意对象。 */
function isUpdateRequest(value: unknown): value is UpdateRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<UpdateRequest>;
  return (
    request.type === REQUEST_TYPE &&
    ["get-state", "check", "install", "relaunch"].includes(request.action ?? "")
  );
}

/** 将本地服务 URL 规整为 postMessage 可使用的精确 origin。 */
function serviceOrigin(serviceUrl: string): string | null {
  try {
    return new URL(serviceUrl).origin;
  } catch {
    return null;
  }
}

/**
 * 将 Harness 设置页的更新请求桥接到 Tauri Updater。
 * 该 Hook 常驻 App 根组件，所以关闭设置弹窗不会中断下载或丢失进度状态。
 */
export function useDesktopUpdaterBridge({
  iframeRef,
  serviceUrl,
}: DesktopUpdaterBridgeOptions): void {
  const origin = useMemo(() => serviceOrigin(serviceUrl), [serviceUrl]);
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);
  const stateRef = useRef<UpdateBridgeState>({
    type: STATE_TYPE,
    desktop: true,
    connected: true,
    phase: "idle",
    currentVersion: "",
    progress: 0,
  });

  /** 将当前完整状态发送给唯一受信任的 Harness iframe。 */
  const sendState = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target || !origin) return;
    target.postMessage(stateRef.current, origin);
  }, [iframeRef, origin]);

  /** 原子更新状态快照并通知设置页，避免进度回调覆盖其他字段。 */
  const publish = useCallback(
    (patch: Partial<UpdateBridgeState>) => {
      stateRef.current = { ...stateRef.current, ...patch };
      sendState();
    },
    [sendState],
  );

  /** 释放上一次检查返回的原生资源，防止重复检查积累 Resource handle。 */
  const replaceUpdate = useCallback(async (next: Update | null) => {
    const previous = updateRef.current;
    updateRef.current = next;
    if (previous && previous !== next) {
      try {
        await previous.close();
      } catch (error) {
        console.debug("[DesktopUpdaterBridge] failed to close previous update:", error);
      }
    }
  }, []);

  /** 执行一次更新检查并缓存可安装的 Update 资源。 */
  const performCheck = useCallback(async (): Promise<Update | null> => {
    publish({ phase: "checking", latestVersion: undefined, notes: undefined, error: undefined, progress: 0 });
    const update = await check();
    await replaceUpdate(update);
    if (!update) {
      publish({ phase: "up-to-date", latestVersion: undefined, notes: undefined, progress: 0 });
      return null;
    }
    publish({
      phase: "available",
      currentVersion: update.currentVersion || stateRef.current.currentVersion,
      latestVersion: update.version,
      notes: update.body,
      progress: 0,
    });
    return update;
  }, [publish, replaceUpdate]);

  /** 检查更新；busy 锁确保来自多个 UI 入口的请求不会并发执行。 */
  const checkForUpdate = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await performCheck();
    } catch (error) {
      console.error("[DesktopUpdaterBridge] update check failed:", error);
      publish({ phase: "error", error: String(error), progress: 0 });
    } finally {
      busyRef.current = false;
    }
  }, [performCheck, publish]);

  /** 下载并安装已检查到的版本，同时把分块下载进度映射到设置页。 */
  const installUpdate = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    let contentLength = 0;
    let downloaded = 0;
    try {
      const update = updateRef.current ?? (await performCheck());
      if (!update) return;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          downloaded = 0;
          publish({ phase: "downloading", progress: 0, error: undefined });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = contentLength > 0 ? Math.min(99, (downloaded / contentLength) * 100) : 0;
          publish({ phase: "downloading", progress });
        } else {
          publish({ phase: "installing", progress: 100 });
        }
      });
      publish({ phase: "restart-required", progress: 100 });
    } catch (error) {
      console.error("[DesktopUpdaterBridge] update install failed:", error);
      publish({ phase: "error", error: String(error) });
    } finally {
      busyRef.current = false;
    }
  }, [performCheck, publish]);

  /** 正常停止 Harness 子进程后重启 App，让已经安装的新 Bundle 生效。 */
  const relaunchApp = useCallback(async () => {
    if (busyRef.current || stateRef.current.phase !== "restart-required") return;
    busyRef.current = true;
    try {
      try {
        await invoke("shutdown_harness");
      } catch (error) {
        // Harness 已停止不应阻止 App 切换到刚安装的新版本。
        console.warn("[DesktopUpdaterBridge] shutdown before relaunch failed:", error);
      }
      await relaunch();
    } catch (error) {
      busyRef.current = false;
      console.error("[DesktopUpdaterBridge] relaunch failed:", error);
      publish({ phase: "error", error: String(error) });
    }
  }, [publish]);

  useEffect(() => {
    /** 初始化当前版本后静默检查一次；安装和重启仍只响应用户在设置页的操作。 */
    async function initializeUpdater() {
      try {
        publish({ currentVersion: await getVersion() });
      } catch (error) {
        console.debug("[DesktopUpdaterBridge] failed to read app version:", error);
      }
      await checkForUpdate();
    }
    void initializeUpdater();
  }, [checkForUpdate, publish]);

  useEffect(() => {
    /**
     * 只接受当前 iframe 且 origin 与本地 Harness 服务完全一致的消息。
     * 这是原生安装/重启操作的权限边界，不能仅依赖消息 type。
     */
    function onMessage(event: MessageEvent) {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || !origin) return;
      if (event.source !== frameWindow || event.origin !== origin || !isUpdateRequest(event.data)) return;

      if (event.data.action === "get-state") sendState();
      else if (event.data.action === "check") void checkForUpdate();
      else if (event.data.action === "install") void installUpdate();
      else if (event.data.action === "relaunch") void relaunchApp();
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [checkForUpdate, iframeRef, installUpdate, origin, relaunchApp, sendState]);

  useEffect(() => {
    return () => {
      const update = updateRef.current;
      updateRef.current = null;
      if (update) void update.close();
    };
  }, []);
}
