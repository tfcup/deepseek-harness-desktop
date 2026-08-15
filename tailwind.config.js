/** @type {import("tailwindcss").Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 主题色通过 CSS 变量定义（见 src/style/main.css），
        // 由 <html data-theme="light"> 在浅色/深色之间切换
        canvas: "var(--color-canvas)",
        panel: "var(--color-panel)",
        panel2: "var(--color-panel-2)",
        "panel-hover": "var(--color-panel-hover)",
        line: "var(--color-line)",
        "line-strong": "var(--color-line-strong)",
        ink: "var(--color-ink)",
        muted: "var(--color-muted)",
        accent: "var(--color-accent)",
        accent2: "var(--color-accent-2)",
        danger: "var(--color-danger)",
        ok: "var(--color-ok)",
        "log-bg": "var(--color-log-bg)",
        "log-ink": "var(--color-log-ink)",
      },
      fontFamily: {
        sans: [
          '"Segoe UI"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ['"Cascadia Code"', '"SF Mono"', "Consolas", '"Courier New"', "monospace"],
      },
    },
  },
  darkMode: "class",
}
