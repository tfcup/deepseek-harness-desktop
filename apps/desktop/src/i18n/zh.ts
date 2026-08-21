import { Translations } from "./types";

export const zh: Translations = {
  app: {
    retry: "重试",
    open_editor: "打开 DeepSeek Harness",
  },
  status: {
    installing: "正在准备 DeepSeek Harness...",
    error: "启动失败",
    loading: "正在加载界面...",
  },
  errors: {
    service_start_timeout: "DeepSeek Harness 启动超时，请检查端口 {{port}} 是否被占用或启动过慢。",
  },
  ui: {
    iframe_error: "无法加载 DeepSeek Harness 界面。",
    ensure_running: "请确认服务正在 {{url}} 运行。",
    waiting_logs: "正在准备内置 Runtime...",
    install_log: "启动日志",
  },
};
