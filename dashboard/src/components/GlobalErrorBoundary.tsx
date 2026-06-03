import React, { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-slate-50 p-6">
          <div className="glass-card max-w-lg w-full p-8 flex flex-col items-center text-center space-y-6">
            <div className="h-16 w-16 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20">
              <AlertTriangle className="text-red-400" size={32} />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-bold font-display text-white">System Error</h1>
              <p className="text-slate-400 text-sm">
                An unexpected error occurred while rendering the application interface. Our team has been notified.
              </p>
            </div>
            
            {this.state.error && (
              <div className="w-full bg-slate-950/80 rounded-lg p-4 mt-2 text-left overflow-x-auto border border-slate-800">
                <p className="text-xs font-mono text-red-300/80 break-words whitespace-pre-wrap">
                  {this.state.error.toString()}
                </p>
              </div>
            )}
            
            <button
              onClick={this.handleReload}
              className="mt-6 flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium transition-all hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20 active:scale-95 w-full sm:w-auto border border-blue-500"
            >
              <RefreshCcw size={18} />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
