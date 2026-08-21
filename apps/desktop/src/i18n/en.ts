import { Translations } from "./types";

export const en: Translations = {
  app: {
    retry: "Retry",
    open_editor: "Open DeepSeek Harness",
  },
  status: {
    installing: "Preparing DeepSeek Harness...",
    error: "Startup failed",
    loading: "Loading interface...",
  },
  errors: {
    service_start_timeout: "DeepSeek Harness startup timed out. Check whether port {{port}} is occupied or startup is still in progress.",
  },
  ui: {
    iframe_error: "Cannot load the DeepSeek Harness interface.",
    ensure_running: "Please make sure the service is running at {{url}}.",
    waiting_logs: "Preparing bundled Runtime...",
    install_log: "Startup log",
  },
};
