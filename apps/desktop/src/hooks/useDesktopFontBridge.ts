import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";

const REQUEST_TYPE = "dsh-desktop:font-request-v1";
const STATE_TYPE = "dsh-desktop:font-state-v1";

type FontAction = "list" | "refresh";
type FontPhase = "idle" | "loading" | "ready" | "error";

interface FontRequest {
  type: typeof REQUEST_TYPE;
  action: FontAction;
}

export interface FontFaceInfo {
  postscriptName: string;
  fullName: string;
  weight: number;
  weightLabel: string;
  style: "normal" | "italic" | "oblique";
}

export interface FontFamilyInfo {
  family: string;
  monospace: boolean;
  faces: FontFaceInfo[];
}

interface FontBridgeState {
  type: typeof STATE_TYPE;
  desktop: true;
  connected: true;
  phase: FontPhase;
  families: FontFamilyInfo[];
  error?: string;
}

interface DesktopFontBridgeOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  serviceUrl: string;
}

/** Validate the narrow, read-only font catalog protocol before invoking native code. */
function isFontRequest(value: unknown): value is FontRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<FontRequest>;
  return request.type === REQUEST_TYPE && ["list", "refresh"].includes(request.action ?? "");
}

/** Normalize the Harness URL to the exact origin accepted by the message boundary. */
function serviceOrigin(serviceUrl: string): string | null {
  try {
    return new URL(serviceUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Serve the native font catalog to the trusted Harness iframe.
 * Font enumeration remains in Tauri; the iframe receives metadata but no filesystem capability.
 */
export function useDesktopFontBridge({
  iframeRef,
  serviceUrl,
}: DesktopFontBridgeOptions): void {
  const origin = useMemo(() => serviceOrigin(serviceUrl), [serviceUrl]);
  const busyRef = useRef(false);
  const stateRef = useRef<FontBridgeState>({
    type: STATE_TYPE,
    desktop: true,
    connected: true,
    phase: "idle",
    families: [],
  });

  /** Send the latest complete catalog state only to the active Harness frame. */
  const sendState = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target || !origin) return;
    target.postMessage(stateRef.current, origin);
  }, [iframeRef, origin]);

  /** Publish a new immutable state snapshot so stale errors never survive a successful scan. */
  const publish = useCallback(
    (patch: Partial<FontBridgeState>) => {
      stateRef.current = { ...stateRef.current, ...patch };
      sendState();
    },
    [sendState],
  );

  /** Scan or return the Rust-side cache; concurrent menu requests share the same in-flight call. */
  const loadFonts = useCallback(
    async (refresh: boolean) => {
      if (busyRef.current) {
        sendState();
        return;
      }
      busyRef.current = true;
      publish({ phase: "loading", error: undefined });
      try {
        const families = await invoke<FontFamilyInfo[]>("list_system_fonts", { refresh });
        publish({ phase: "ready", families, error: undefined });
      } catch (error) {
        console.error("[DesktopFontBridge] font scan failed:", error);
        publish({ phase: "error", error: String(error) });
      } finally {
        busyRef.current = false;
      }
    },
    [publish, sendState],
  );

  useEffect(() => {
    /** Enforce the same source/origin boundary as the updater bridge before native invocation. */
    function onMessage(event: MessageEvent) {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || !origin) return;
      if (event.source !== frameWindow || event.origin !== origin || !isFontRequest(event.data)) return;
      if (event.data.action === "refresh") void loadFonts(true);
      else if (stateRef.current.phase === "idle") void loadFonts(false);
      else sendState();
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [iframeRef, loadFonts, origin, sendState]);
}
