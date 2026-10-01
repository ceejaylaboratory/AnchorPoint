import React, { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCcw, Copy, Check } from 'lucide-react';

interface Props {
  children?: ReactNode;
  compact?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleCopyStackTrace = async () => {
    const { error, errorInfo } = this.state;
    const stackTrace = [error?.stack ?? error?.toString(), errorInfo?.componentStack]
      .filter(Boolean)
      .join('\n\nComponent Stack:');

    try {
      await navigator.clipboard.writeText(stackTrace);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  public render() {
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
                An unexpected error occurred while rendering the application interface. Our team has been notified.
              </p>
            </div>
            
            {this.state.error && (
              <div className="w-full bg-slate-950/80 rounded-lg p-4 mt-2 text-left overflow-x-auto border border-slate-600">
                <p className="text-xs font-mono text-red-300/80 break-words whitespace-pre-wrap">
                  {this.state.error.toString()}
                </p>
              </div>
            )}
            
            <div className="mt-6 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <button
                onClick={this.handleReload}
                className="action-button flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20 w-full sm:w-auto border border-blue-500"
              >
                <RefreshCcw size={18} />
                Reload Application
              </button>
              <button
                onClick={this.handleCopyStackTrace}
                className="action-button flex items-center justify-center gap-2 bg-slate-800 text-slate-200 px-6 py-2.5 rounded-lg font-medium hover:bg-slate-700 w-full sm:w-auto border border-slate-600"
              >
                {this.state.copied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} />}
                {this.state.copied ? 'Copied!' : 'Copy Error Details'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
