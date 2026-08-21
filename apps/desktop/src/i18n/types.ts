export type Language = "en" | "zh";

/** Desktop 外壳仅保留启动、错误页和 WebView 所需文案。 */
export interface Translations {
  app: {
    retry: string;
    open_editor: string;
  };
  status: {
    installing: string;
    error: string;
    loading: string;
  };
  errors: {
    service_start_timeout: string;
  };
  ui: {
    iframe_error: string;
    ensure_running: string;
    waiting_logs: string;
    install_log: string;
  };
}
