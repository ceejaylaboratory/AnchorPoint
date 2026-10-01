import React, { useState, useEffect, useRef } from 'react';
import { Bell, X, Check, Clock, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface Notification {
  id: string;
  userId: string;
  transactionId: string | null;
  type: 'EMAIL' | 'SMS' | 'PUSH';
  status: 'PENDING' | 'SENT' | 'FAILED';
  message: string;
  createdAt: string;
  readAt?: string | null;
}

interface NotificationBellProps {
  apiBaseUrl?: string;
  onViewAll?: () => void;
}

const STREAM_PATH = '/api/notifications/stream';
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

function isNotification(value: unknown): value is Notification {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<Notification>;
  return typeof candidate.id === 'string' && typeof candidate.message === 'string';
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  onViewAll,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashHighSeverity, setFlashHighSeverity] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  // Initialize audio context for ping sound
  useEffect(() => {
    const initAudio = () => {
      if (!audioContextRef.current) {
        const AudioContextConstructor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioContextRef.current = new AudioContextConstructor();
      }
    };

    // Initialize on first user interaction to comply with autoplay policies
    const handleFirstInteraction = () => {
      initAudio();
      document.removeEventListener('click', handleFirstInteraction);
    };

    document.addEventListener('click', handleFirstInteraction);
    return () => document.removeEventListener('click', handleFirstInteraction);
  }, []);

  // Play subtle audio ping for high-severity notifications
  const playPingSound = () => {
    if (!audioContextRef.current) return;
    
    const ctx = audioContextRef.current;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.2);
  };

  // Trigger visual flash for high-severity notifications
  const triggerVisualFlash = () => {
    setFlashHighSeverity(true);
    setTimeout(() => setFlashHighSeverity(false), 1000);
  };

  // SSE connection for real-time notifications
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
      eventSource = new EventSource(`${base}${STREAM_PATH}`, {
        withCredentials: true,
      });

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

          // Add the new notification to our list if it doesn't already exist
          setNotifications((prev) => {
            if (prev.some((item) => item.id === candidate.id)) {
              return prev;
            }
            // Add readAt: null to new notifications from stream to match our interface
            const newNotification = { ...candidate, readAt: null } as Notification;
            
            // Check if this is a high-severity notification (FAILED status)
            if (candidate.status === 'FAILED') {
              playPingSound();
              triggerVisualFlash();
            }
            
            return [newNotification, ...prev];
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchNotifications();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
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
      setNotifications(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter((notification) => notification.status === 'PENDING' && !notification.readAt).map((notification) => notification.id);
    if (unreadIds.length === 0) {
      return;
    }

    try {
      const token = localStorage.getItem('authToken');
      await fetch(`${apiBaseUrl}/api/notifications/history`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notificationIds: unreadIds }),
      });
      setNotifications((current) => current.map((notification) => (unreadIds.includes(notification.id) ? { ...notification, readAt: new Date().toISOString() } : notification)));
    } catch (err) {
      console.error('Failed to mark notifications as read', err);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SENT':
        return <Check size={14} className="text-emerald-500" />;
      case 'FAILED':
        return <AlertCircle size={14} className="text-red-500" />;
      case 'PENDING':
        return <Clock size={14} className="text-amber-500" />;
      default:
        return null;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`action-button relative rounded-lg border border-slate-700 bg-slate-900 p-2 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-all duration-300 ${
          flashHighSeverity ? 'ring-2 ring-red-500/70 scale-110' : ''
        }`}
        aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
      >
        <Bell size={20} className={`text-slate-300 transition-colors duration-300 ${flashHighSeverity ? 'text-red-400' : ''}`} />
        {unreadCount > 0 && (
          <span className={`absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white transition-all duration-300 ${
            flashHighSeverity ? 'bg-red-600 scale-125 animate-pulse' : 'bg-red-500'
          }`}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="absolute right-0 z-50 mt-2 w-96 rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-700 p-4">
              <div>
                <h3 className="font-semibold text-slate-100">Notifications</h3>
                <p className="text-xs text-slate-400">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={() => void markAllAsRead()}
                    className="rounded px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="rounded p-1 hover:bg-slate-800"
                  aria-label="Close notifications"
                >
                  <X size={18} className="text-slate-400" />
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center p-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-primary" />
                </div>
              ) : error ? (
                <div className="p-4 text-center text-sm text-red-400">{error}</div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell size={32} className="mx-auto mb-2 text-slate-600" />
                  <p className="text-sm text-slate-400">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800">
                  {notifications.slice(0, 5).map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 transition-colors hover:bg-slate-800/50 ${
                        notification.status === 'PENDING' && !notification.readAt ? 'bg-slate-800/30' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1">{getStatusIcon(notification.status)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-slate-200">{notification.message}</p>
                            {notification.status === 'PENDING' && !notification.readAt && (
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" aria-label="Unread notification" />
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                            <span className="capitalize">{notification.type.toLowerCase()}</span>
                            <span>•</span>
                            <span>{formatTimestamp(notification.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {notifications.length > 0 && (
              <div className="border-t border-slate-700 p-3">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onViewAll?.();
                  }}
                  className="action-button w-full rounded-lg bg-slate-800 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
                >
                  View All Notifications
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};