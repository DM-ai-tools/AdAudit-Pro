import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class OptimizationErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[OptimizationErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="max-w-2xl mx-auto p-8">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 flex gap-3">
            <AlertTriangle className="text-red-400 shrink-0" size={22} />
            <div>
              <p className="text-red-300 text-sm font-medium mb-1">Could not display optimization results</p>
              <p className="text-muted text-xs mb-3">{this.state.error.message}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  this.setState({ error: null });
                  this.props.onReset?.();
                }}
              >
                <RefreshCw size={14} /> Try again
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
