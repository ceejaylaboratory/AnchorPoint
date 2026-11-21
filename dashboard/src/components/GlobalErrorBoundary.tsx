import { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCcw, Copy, Check } from 'lucide-react';
import { buildDiagnosticReport, formatDiagnosticReport, redactSensitiveData } from '../lib/diagnostics';

export { buildDiagnosticReport, formatDiagnosticReport, redactSensitiveData } from '../lib/diagnostics';

interface Props {
  children?: ReactNode;
  compact?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
  reported: boolean;
  reloading: boolean;
}

/**
 * Submit an anonymized diagnostic bundle to an optional collector.
 *
 * `VITE_ERROR_REPORT_URL` may point at any crash endpoint (including a
 * Sentry-compatible ingest proxy). Reports are skipped when it is unset.
 */
export async function reportError(error: Error, errorInfo: ErrorInfo | null): Promise<boolean> {
  const url = (import.meta.env.VITE_ERROR_REPORT_URL as string | undefined) ?? '';
  if (!url) return false;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDiagnosticReport(error, errorInfo)),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
    reported: false,
    reloading: false,
  };

  private copyResetTimer: number | undefined;

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
    void reportError(error, errorInfo).then((ok) => {
      if (ok) this.setState({ reported: true });
    });
  }

  public componentWillUnmount() {
    if (this.copyResetTimer !== undefined) {
      window.clearTimeout(this.copyResetTimer);
      this.copyResetTimer = undefined;
    }
  }

  private handleReload = () => {
    // Clearing the crash state keeps the UI recoverable if navigation is
    // blocked (for example in an embedded preview or a unit test).
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
      reported: false,
      reloading: true,
    });
    try {
      window.location.reload();
    } catch {
      /* navigation unavailable in this environment */
    }
  };

  private handleCopyDiagnosticInfo = async () => {
    const { error, errorInfo } = this.state;
    const diagnosticInfo = formatDiagnosticReport(buildDiagnosticReport(error, errorInfo));

    try {
      await navigator.clipboard.writeText(diagnosticInfo);
      this.setState({ copied: true });
      if (this.copyResetTimer !== undefined) window.clearTimeout(this.copyResetTimer);
      this.copyResetTimer = window.setTimeout(() => {
        this.copyResetTimer = undefined;
        this.setState({ copied: false });
      }, 2000);
    } catch {
      /* clipboard not available */
    }
  };

  public render() {
    if (this.state.reloading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-slate-50 p-6">
          <p className="glass-card p-6 text-center text-slate-300" role="status">
            Reloading AnchorPoint…
          </p>
        </div>
      );
    }

    if (this.state.hasError) {
      if (this.props.compact) {
        return (
          <div className="glass-card p-6 text-center" role="alert">
            <p className="font-semibold text-red-300">This section could not be displayed.</p>
            <p className="mt-2 text-sm text-slate-400">Try another section.</p>
          </div>
        );
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-slate-50 p-6">
          <div className="glass-card max-w-lg w-full p-8 flex flex-col items-center text-center space-y-6">
            <div className="h-16 w-16 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20">
              <AlertTriangle className="text-red-400" size={32} />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold font-display text-slate-50">System Error</h1>
              <p className="text-slate-400 text-sm">
                An unexpected error occurred while rendering the application interface. Copy the
                anonymized diagnostic info to report it, or reload to try again.
              </p>
            </div>

            {this.state.error && (
              <div className="w-full bg-slate-950/80 rounded-lg p-4 mt-2 text-left overflow-x-auto border border-slate-600">
                <p className="text-xs font-mono text-red-300/80 break-words whitespace-pre-wrap">
                  {redactSensitiveData(this.state.error.toString())}
                </p>
              </div>
            )}

            <div className="mt-6 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <button
                onClick={this.handleReload}
                className="action-button flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20 w-full sm:w-auto border border-blue-500"
              >
                <RefreshCcw size={18} />
                Reload App
              </button>
              <button
                onClick={this.handleCopyDiagnosticInfo}
                className="action-button flex items-center justify-center gap-2 bg-slate-800 text-slate-200 px-6 py-2.5 rounded-lg font-medium hover:bg-slate-700 w-full sm:w-auto border border-slate-600"
              >
                {this.state.copied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} />}
                {this.state.copied ? 'Copied!' : 'Copy Diagnostic Info'}
              </button>
              <a
                href="mailto:support@anchorpoint.local?subject=Problem%20Report"
                data-testid="report-problem-link"
                className="action-button flex items-center justify-center gap-2 bg-slate-800 text-slate-200 px-6 py-2.5 rounded-lg font-medium hover:bg-slate-700 w-full sm:w-auto border border-slate-600"
              >
                Report Problem
              </a>
            </div>
            {this.state.reported && (
              <p className="text-xs text-emerald-400" data-testid="error-reported-note">
                Error report sent. Thank you.
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
