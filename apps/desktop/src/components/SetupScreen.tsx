import { useI18n } from "../i18n/context";

export type SetupStatus = "checking" | "installing" | "starting" | "ready" | "error";

export interface InstallProgress {
  title: string;
  detail: string;
  log: string;
  type: string;
  percentage: number;
  progress: number;
}

interface SetupScreenProps {
  status: SetupStatus;
  title: string;
  detail: string;
  percentage: number;
  logs: string[];
  errorMsg: string;
  onRetry: () => void;
}

const LOG_LIMIT = 5;

/**
 * Installer/download page, modeled on the early n8n-based
 * `hairyf/damn-reports` `Installer` + `StepStatus` components: an icon, a
 * headline, a description, a value-labelled progress bar, and a
 * terminal-style panel showing the most recent progress lines.
 */
export default function SetupScreen({
  status,
  title,
  detail,
  percentage,
  logs,
  errorMsg,
  onRetry,
}: SetupScreenProps) {
  const { t } = useI18n();
  const error = status === "error";
  const installing = status === "installing";
  const heading = error ? t("status.error") : title || t("status.installing");
  const description = error ? "" : detail || t("status.installing");
  const visibleLogs = logs.length ? logs : [t("ui.waiting_logs")];

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-[min(460px,88vw)] rounded-[14px] border border-line bg-panel px-[46px] py-[42px] text-center">
        <div className="text-accent2">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(77,107,254,0.35)] bg-gradient-to-br from-[rgba(77,107,254,0.2)] to-[rgba(110,139,255,0.06)] text-accent2">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
        </div>

        <h2 className="mt-[18px] mb-1.5 text-xl font-semibold text-ink truncate">{heading}</h2>
        <p className="mb-6 min-h-[18px] text-[13px] break-all text-muted">{errorMsg || description}</p>

        {installing && (
          <>
            <div className="mb-5 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2" role="progressbar" aria-valuenow={Math.round(percentage)}>
                <div className="h-full bg-gradient-to-r from-accent to-accent2 transition-[width] duration-150" style={{ width: `${Math.min(percentage, 100)}%` }} />
              </div>
              <span className="min-w-[44px] text-right text-[13px] font-semibold tabular-nums text-accent2">{Math.round(percentage)}%</span>
            </div>

            <div className="mb-5 min-h-[112px] max-h-[184px] overflow-y-auto rounded-lg border border-line bg-log-bg px-3.5 py-2.5 text-left font-mono text-xs leading-[1.7]" aria-label={t("ui.install_log")}>
              {visibleLogs.slice(-LOG_LIMIT).map((line, index) => (
                <p key={`${line}-${index}`} className="m-0 flex gap-2 overflow-hidden text-ellipsis whitespace-nowrap text-log-ink">
                  <span className="shrink-0 text-accent select-none">›</span>
                  <span className="min-w-0 overflow-hidden text-ellipsis">{line}</span>
                </p>
              ))}
            </div>
          </>
        )}

        {!error && (
          <div className="inline-flex items-center gap-2.5">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
            <span className="text-[11px] font-semibold tracking-[0.18em] text-muted">PROCESSING...</span>
          </div>
        )}

        {error && (
          <button
            className="inline-flex cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-accent2 disabled:cursor-not-allowed disabled:opacity-55"
            onClick={onRetry}
          >
            {t("app.retry")}
          </button>
        )}
      </div>
    </div>
  );
}
