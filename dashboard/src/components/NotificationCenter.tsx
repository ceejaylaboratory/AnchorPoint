import React, { useState, useEffect } from 'react';
import { Bell, Check, Clock, AlertCircle, Filter, RefreshCw, Settings } from 'lucide-react';
import { motion } from 'framer-motion';

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

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  onOpenPreferences,
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'SENT' | 'FAILED'>('all');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchNotifications();
  }, []);

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
      setNotifications(data.data || []);
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

  const stats = {
    total: notifications.length,
    sent: notifications.filter((n) => n.status === 'SENT').length,
    pending: notifications.filter((n) => n.status === 'PENDING').length,
    failed: notifications.filter((n) => n.status === 'FAILED').length,
  };

  return (
    <div className="space-y-6">
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
          <div className="divide-y divide-slate-600">
            {filteredNotifications.map((notification, index) => (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="p-6 transition-colors hover:bg-slate-800/30"
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
                            <span className="font-mono">{notification.transactionId.slice(0, 8)}...</span>
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
        )}
      </div>
    </div>
  );
};

export default NotificationCenter;
