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
}

interface NotificationBellProps {
  apiBaseUrl?: string;
  onViewAll?: () => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  onViewAll,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => n.status === 'PENDING').length;

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
        className="action-button relative rounded-lg border border-slate-700 bg-slate-900 p-2 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
      >
        <Bell size={20} className="text-slate-300" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
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
              <h3 className="font-semibold text-slate-100">Notifications</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded p-1 hover:bg-slate-800"
                aria-label="Close notifications"
              >
                <X size={18} className="text-slate-400" />
              </button>
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
                        notification.status === 'PENDING' ? 'bg-slate-800/30' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1">{getStatusIcon(notification.status)}</div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-200">{notification.message}</p>
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
