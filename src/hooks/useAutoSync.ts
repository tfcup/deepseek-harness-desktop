import { useEffect } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

/**
 * Listen for the `app://sync-state` event and run a callback when it fires.
 * Kept for parity with the reference desktop implementation; the backend may
 * emit it after lifecycle transitions.
 */
export function useAutoSync(onSync: () => void) {
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      try {
        unlisten = await listen<string>("app://sync-state", () => onSync());
      } catch (error) {
        console.error("[useAutoSync] failed to register listener:", error);
      }
    };

    setupListener();
    return () => {
      unlisten?.();
    };
  }, [onSync]);
}

/** Build a cache-busting URL for the harness iframe. */
export function generateTimestampedUrl(baseUrl: string): string {
  const timestamp = Date.now();
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}t=${timestamp}`;
}
