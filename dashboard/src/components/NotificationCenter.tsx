import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Bell, Check, Clock, Filter, Info, RefreshCw, Settings, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { CopyableText } from './CopyableText';
import { TableShortcutHints } from './TableShortcutHints';
import { useTableRowKeyboardNavigation } from '../hooks/useKeyboardShortcuts';

export interface Notification {
  id: string;
  userId: string;
  transactionId: string | null;
  type: 'EMAIL' | 'SMS' | 'PUSH';
  status: 'PENDING' | 'SENT' | 'FAILED';
  message: string;
  createdAt: string;
}

interface NotificationCenterProps {
  apiBaseUrl?: string;
  onOpenPreferences?: () => void;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

export const STREAM_PATH = '/api/notifications/stream';

function isNotification(value: unknown): value is Notification {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<Notification>;
  return typeof candidate.id === 'string' && typeof candidate.message === 'string';
}

// ---------------------------------------------------------------------------
// Toast stack
// ---------------------------------------------------------------------------

export type ToastSeverity = 'success' | 'warning' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
}

/** A queued toast plus the bookkeeping needed to pause and resume its timer. */
interface QueuedToast extends Toast {
  /** Milliseconds still to run. Frozen while the stack is paused. */
  remainingMs: number;
  /** Wall-clock deadline, or null while paused. */
  expiresAt: number | null;
}

export const TOAST_DURATION_MS = 5000;
/** Older toasts are dropped past this so the stack never covers the viewport. */
export const MAX_VISIBLE_TOASTS = 4;

export function statusToSeverity(status: Notification['status']): ToastSeverity {
  switch (status) {
    case 'SENT':
      return 'success';
    case 'FAILED':
      return 'error';
    case 'PENDING':
      return 'warning';
    default:
      return 'info';
  }
}

export interface ToastQueue {
  toasts: Toast[];
  paused: boolean;
  push: (toast: Toast) => void;
  dismiss: (id: string) => void;
  pause: () => void;
  resume: () => void;
}

/**
 * Queue behind the toast stack: newest-last ordering, a hard cap on visible
 * toasts, auto-dismiss after `duration`, and a pause that freezes the
 * remaining time of every toast rather than restarting it on resume.
 */
export function useToastQueue(
  duration: number = TOAST_DURATION_MS,
  max: number = MAX_VISIBLE_TOASTS,
): ToastQueue {
  const [toasts, setToasts] = useState<QueuedToast[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const push = useCallback(
    (toast: Toast) => {
      setToasts((prev) => {
        if (prev.some((item) => item.id === toast.id)) {
          return prev;
        }
        const queued: QueuedToast = {
          ...toast,
          remainingMs: duration,
          // A toast that arrives while the user is hovering the stack waits
          // for the pointer to leave before its timer starts.
          expiresAt: pausedRef.current ? null : Date.now() + duration,
        };
        return [...prev, queued].slice(-max);
      });
    },
    [duration, max],
  );

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const pause = useCallback(() => {
    setPaused((wasPaused) => {
      if (wasPaused) return wasPaused;
      const now = Date.now();
      setToasts((prev) =>
        prev.map((toast) => ({
          ...toast,
          remainingMs:
            toast.expiresAt === null ? toast.remainingMs : Math.max(0, toast.expiresAt - now),
          expiresAt: null,
        })),
      );
      return true;
    });
  }, []);

  const resume = useCallback(() => {
    setPaused((wasPaused) => {
      if (!wasPaused) return wasPaused;
      const now = Date.now();
      setToasts((prev) => prev.map((toast) => ({ ...toast, expiresAt: now + toast.remainingMs })));
      return false;
    });
  }, []);

  // One timer for the whole stack, rearmed at the earliest deadline.
  useEffect(() => {
    if (paused || toasts.length === 0) return;

    const deadlines = toasts
      .map((toast) => toast.expiresAt)
      .filter((value): value is number => value !== null);
    if (deadlines.length === 0) return;

    const delay = Math.max(0, Math.min(...deadlines) - Date.now());
    const timer = setTimeout(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((toast) => toast.expiresAt === null || toast.expiresAt > now));
    }, delay);

    return () => clearTimeout(timer);
  }, [paused, toasts]);

  return { toasts, paused, push, dismiss, pause, resume };
}

const SEVERITY_STYLE: Record<ToastSeverity, { card: string; icon: React.ReactNode }> = {
  success: {
    card: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
    icon: <Check size={18} className="text-emerald-400" aria-hidden="true" />,
  },
  warning: {
    card: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    icon: <AlertTriangle size={18} className="text-amber-400" aria-hidden="true" />,
  },
  error: {
    card: 'border-red-500/40 bg-red-500/10 text-red-100',
    icon: <AlertCircle size={18} className="text-red-400" aria-hidden="true" />,
  },
  info: {
    card: 'border-sky-500/40 bg-sky-500/10 text-sky-100',
    icon: <Info size={18} className="text-sky-400" aria-hidden="true" />,
  },
};

export interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  /** Called when the pointer or keyboard focus enters the stack. */
  onPause?: () => void;
  /** Called when the pointer or keyboard focus leaves the stack. */
  onResume?: () => void;
}

/**
 * Floating stack of transient alerts pinned to the bottom-right corner.
 * Hovering or focusing the stack pauses every auto-dismiss timer so a toast
 * cannot vanish while it is being read or its close button is being reached.
 */
export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onDismiss,
  onPause,
  onResume,
}) => (
  <div
    data-testid="toast-container"
    aria-label="Notification alerts"
    className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    onMouseEnter={onPause}
    onMouseLeave={onResume}
    onFocus={onPause}
    onBlur={onResume}
  >
    <AnimatePresence initial={false}>
      {toasts.map((toast) => (
        <motion.div
          key={toast.id}
          layout
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.2 }}
          data-severity={toast.severity}
          role={toast.severity === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-lg backdrop-blur-md ${
            SEVERITY_STYLE[toast.severity].card
          }`}
        >
          <span className="mt-0.5 shrink-0">{SEVERITY_STYLE[toast.severity].icon}</span>
          <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label={`Dismiss notification: ${toast.message}`}
            className="shrink-0 rounded p-1 text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  onOpenPreferences,
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'SENT' | 'FAILED'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'connected' | 'reconnecting'>('idle');
  const { toasts, push, dismiss, pause, resume } = useToastQueue();

  // Held in a ref so the stream effect never has to re-subscribe when the
  // queue callbacks change identity.
  const pushToast = useRef(push);
  pushToast.current = push;

  useEffect(() => {
    fetchNotifications();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;

    const clearTimer = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      eventSource?.close();
      const base = apiBaseUrl.replace(/\/$/, '');
      eventSource = new EventSource(`${base}${STREAM_PATH}`);

      eventSource.onopen = () => {
        if (cancelled) {
          return;
        }
        backoffMs = INITIAL_BACKOFF_MS;
        setStreamStatus('connected');
      };

      eventSource.onmessage = (event) => {
        if (cancelled) {
          return;
        }
        try {
          const payload = JSON.parse(event.data) as unknown;
          const candidate =
            payload && typeof payload === 'object' && 'data' in payload
              ? (payload as { data: unknown }).data
              : payload;
          if (!isNotification(candidate)) {
            return;
          }
          setNotifications((prev) => {
            if (prev.some((item) => item.id === candidate.id)) {
              return prev;
            }
            // Only surface a toast for a notification the session has not
            // already seen, so a reconnect replay does not re-announce it.
            pushToast.current({
              id: candidate.id,
              message: candidate.message,
              severity: statusToSeverity(candidate.status),
            });
            return [candidate, ...prev];
          });
        } catch {
          // Ignore keep-alive comments and malformed frames.
        }
      };

      eventSource.onerror = () => {
        if (cancelled) {
          return;
        }
        eventSource?.close();
        eventSource = null;
        setStreamStatus('reconnecting');
        clearTimer();
        const delay = backoffMs;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearTimer();
      eventSource?.close();
      eventSource = null;
    };
  }, [apiBaseUrl]);

  const fetchNotifications = async (showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${apiBaseUrl}/api/notifications/history`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }

      const data = await response.json();
      const incoming: Notification[] = data.data || [];
      setNotifications((prev) => {
        const seen = new Set(incoming.map((item) => item.id));
        const liveOnly = prev.filter((item) => !seen.has(item.id));
        return [...liveOnly, ...incoming];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SENT':
        return <Check size={18} className="text-emerald-500" />;
      case 'FAILED':
        return <AlertCircle size={18} className="text-red-500" />;
      case 'PENDING':
        return <Clock size={18} className="text-amber-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      SENT: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      FAILED: 'bg-red-500/10 text-red-400 border-red-500/20',
      PENDING: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    };

    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
          styles[status as keyof typeof styles] || ''
        }`}
      >
        {getStatusIcon(status)}
        {status}
      </span>
    );
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleString();
  };

  const filteredNotifications =
    filter === 'all'
      ? notifications
      : notifications.filter((n) => n.status === filter);

  const listRef = useRef<HTMLDivElement>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);

  useEffect(() => {
    if (selectedRowIndex >= filteredNotifications.length) setSelectedRowIndex(0);
  }, [filteredNotifications.length, selectedRowIndex]);

  const handleCopyRow = (index: number) => {
    const row = listRef.current?.querySelectorAll<HTMLElement>('[data-keyboard-row]')[index];
    row?.querySelector<HTMLButtonElement>('[data-testid="copyable-text-btn"]')?.click();
  };

  useTableRowKeyboardNavigation({
    containerRef: listRef,
    rowCount: filteredNotifications.length,
    selectedIndex: selectedRowIndex,
    onSelectRow: setSelectedRowIndex,
    onCopyRow: handleCopyRow,
  });

  const stats = {
    total: notifications.length,
    sent: notifications.filter((n) => n.status === 'SENT').length,
    pending: notifications.filter((n) => n.status === 'PENDING').length,
    failed: notifications.filter((n) => n.status === 'FAILED').length,
  };

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
      {streamStatus === 'reconnecting' && (
        <p role="status" className="text-xs text-slate-400">
          Reconnecting event stream...
        </p>
      )}
      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="glass-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Total</p>
              <p className="text-2xl font-bold text-slate-100">{stats.total}</p>
            </div>
            <Bell size={24} className="text-slate-400" />
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Sent</p>
              <p className="text-2xl font-bold text-emerald-400">{stats.sent}</p>
            </div>
            <Check size={24} className="text-emerald-500" />
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Pending</p>
              <p className="text-2xl font-bold text-amber-400">{stats.pending}</p>
            </div>
            <Clock size={24} className="text-amber-500" />
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Failed</p>
              <p className="text-2xl font-bold text-red-400">{stats.failed}</p>
            </div>
            <AlertCircle size={24} className="text-red-500" />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="glass-card p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-300">Filter:</span>
            <div className="flex gap-2">
              {(['all', 'PENDING', 'SENT', 'FAILED'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-3 py-1 text-sm font-medium transition-colors ${
                    filter === f
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {f === 'all' ? 'All' : f}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => fetchNotifications(true)}
              disabled={refreshing}
              className="action-button flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>

            {onOpenPreferences && (
              <button
                onClick={onOpenPreferences}
                className="action-button flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
              >
                <Settings size={16} />
                Preferences
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notifications List */}
      <div className="glass-card">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-500 border-t-primary-text" />
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <AlertCircle size={48} className="mx-auto mb-4 text-red-500" />
            <p className="text-lg font-medium text-red-400">{error}</p>
            <button
              onClick={() => fetchNotifications()}
              className="action-button mt-4 rounded-lg bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20"
            >
              Try Again
            </button>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="p-12 text-center">
            <Bell size={48} className="mx-auto mb-4 text-slate-400" />
            <p className="text-lg font-medium text-slate-400">
              {filter === 'all' ? 'No notifications yet' : `No ${filter.toLowerCase()} notifications`}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Webhook events and transaction updates will appear here
            </p>
          </div>
        ) : (
          <>
            <div className="flex justify-end px-4 pt-3">
              <TableShortcutHints copyLabel="transaction ID" />
            </div>
            <div ref={listRef} data-keyboard-table data-testid="notification-list" className="divide-y divide-slate-600">
              {filteredNotifications.map((notification, index) => (
                <motion.div
                  key={notification.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  data-keyboard-row
                  tabIndex={selectedRowIndex === index ? 0 : -1}
                  aria-selected={selectedRowIndex === index}
                  onFocus={() => setSelectedRowIndex(index)}
                  className={`p-6 transition-colors hover:bg-slate-800/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 ${
                    selectedRowIndex === index ? 'bg-slate-800/20' : ''
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="mt-1">{getStatusIcon(notification.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm text-slate-200">{notification.message}</p>
                        {getStatusBadge(notification.status)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <span className="font-medium">Type:</span>
                          <span className="capitalize">{notification.type.toLowerCase()}</span>
                        </span>
                        {notification.transactionId && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <span className="font-medium">Transaction:</span>
                              <CopyableText value={notification.transactionId} label="Transaction ID" />
                            </span>
                          </>
                        )}
                        <span>•</span>
                        <span>{formatTimestamp(notification.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NotificationCenter;
