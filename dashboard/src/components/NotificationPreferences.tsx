import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Mail, MessageSquare, Bell, Save, AlertCircle, CheckCircle, RotateCcw } from 'lucide-react';

interface NotificationPreferencesProps {
  apiBaseUrl?: string;
}

interface Preferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  phone?: string;
}

/**
 * Shipping defaults the reset action restores: email on, the channels that
 * need an extra opt-in off.
 */
export const DEFAULT_PREFERENCES: Preferences = {
  emailEnabled: true,
  smsEnabled: false,
  pushEnabled: false,
  phone: '',
};

/** Compared against the last saved snapshot to drive the dirty state. */
const isSamePreferences = (a: Preferences, b: Preferences): boolean =>
  a.emailEnabled === b.emailEnabled &&
  a.smsEnabled === b.smsEnabled &&
  a.pushEnabled === b.pushEnabled &&
  (a.phone ?? '') === (b.phone ?? '');

/**
 * Coerces every channel to a strict boolean so a disabled channel is always
 * sent as an explicit `false`. An `undefined` channel is dropped by
 * JSON.stringify and the API leaves omitted channels unchanged, so without
 * this an "all off" save could leave previous values in place.
 */
export const toPreferencesPayload = (prefs: Partial<Preferences>): Preferences => ({
  emailEnabled: prefs.emailEnabled === true,
  smsEnabled: prefs.smsEnabled === true,
  pushEnabled: prefs.pushEnabled === true,
  phone: prefs.phone ?? '',
});

/** Fills channels the API omitted (or returned as null) with the defaults. */
const normalizePreferences = (
  data: Partial<Record<keyof Preferences, unknown>> | null | undefined,
): Preferences =>
  toPreferencesPayload({
    emailEnabled:
      typeof data?.emailEnabled === 'boolean' ? data.emailEnabled : DEFAULT_PREFERENCES.emailEnabled,
    smsEnabled:
      typeof data?.smsEnabled === 'boolean' ? data.smsEnabled : DEFAULT_PREFERENCES.smsEnabled,
    pushEnabled:
      typeof data?.pushEnabled === 'boolean' ? data.pushEnabled : DEFAULT_PREFERENCES.pushEnabled,
    phone: typeof data?.phone === 'string' ? data.phone : DEFAULT_PREFERENCES.phone,
  });

export const NotificationPreferences: React.FC<NotificationPreferencesProps> = ({
  apiBaseUrl = 'http://localhost:3002',
}) => {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  /** What the server last confirmed; the baseline for "unsaved changes". */
  const [savedPreferences, setSavedPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isDirty = useMemo(
    () => !isSamePreferences(preferences, savedPreferences),
    [preferences, savedPreferences],
  );

  const isDefault = useMemo(
    () => isSamePreferences(preferences, DEFAULT_PREFERENCES),
    [preferences],
  );

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${apiBaseUrl}/api/notifications/preferences`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch preferences');
      }

      const body = await response.json();
      // Merge over the defaults: a response missing a channel would otherwise
      // leave that toggle undefined and make it an uncontrolled input.
      const next = normalizePreferences(body?.data);
      setPreferences(next);
      setSavedPreferences(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching preferences:', err);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const savePreferences = useCallback(
    async (current: Preferences = preferences) => {
      // Always send every channel, including when all of them are off.
      const next = toPreferencesPayload(current);
      setSaving(true);
      setError(null);
      setSuccess(false);

      try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${apiBaseUrl}/api/notifications/preferences`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(next),
        });

        if (!response.ok) {
          throw new Error('Failed to save preferences');
        }

        // Only now is this the persisted state, so the form stops reading dirty.
        setSavedPreferences(next);
        setSuccess(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        console.error('Error saving preferences:', err);
      } finally {
        setSaving(false);
      }
    },
    [apiBaseUrl, preferences],
  );

  // Clear the confirmation on a timer the unmount can cancel, rather than
  // leaving a setTimeout to fire into an unmounted component.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(false), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  const handleToggle = (key: keyof Preferences) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    setSuccess(false);
  };

  /**
   * Restores the shipping defaults and persists them, so the button is a
   * complete action rather than one that leaves the form dirty.
   */
  const handleReset = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    setSuccess(false);
    void savePreferences(DEFAULT_PREFERENCES);
  }, [savePreferences]);

  const handlePhoneChange = (phone: string) => {
    setSuccess(false);
    setPreferences((prev) => ({
      ...prev,
      phone,
    }));
  };

  if (loading) {
    return (
      <div className="glass-card p-8">
        <div className="flex items-center justify-center" role="status" aria-label="Loading preferences">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <h3 className="mb-6 text-xl font-bold text-slate-100">Notification Preferences</h3>

        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-500/10 p-2">
                <Mail size={20} className="text-blue-400" />
              </div>
              <div>
                <h4 className="font-medium text-slate-100">Email Notifications</h4>
                <p className="mt-1 text-sm text-slate-400">
                  Receive transaction updates and webhook events via email
                </p>
              </div>
            </div>
            <button
              onClick={() => handleToggle('emailEnabled')}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                preferences.emailEnabled ? 'bg-primary' : 'bg-slate-700'
              }`}
              role="switch"
              aria-checked={preferences.emailEnabled}
              aria-label="Toggle email notifications"
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-primary-foreground transition-transform ${
                  preferences.emailEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2">
                <MessageSquare size={20} className="text-emerald-400" />
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-slate-100">SMS Notifications</h4>
                <p className="mt-1 text-sm text-slate-400">
                  Receive critical alerts via text message
                </p>
                {preferences.smsEnabled && (
                  <div className="mt-3">
                    <label htmlFor="phone" className="mb-1 block text-xs font-medium text-slate-400">
                      Phone Number
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      value={preferences.phone || ''}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      placeholder="+1 (555) 123-4567"
                      className="input-field w-full max-w-xs"
                    />
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => handleToggle('smsEnabled')}
              className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                preferences.smsEnabled ? 'bg-primary' : 'bg-slate-700'
              }`}
              role="switch"
              aria-checked={preferences.smsEnabled}
              aria-label="Toggle SMS notifications"
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-primary-foreground transition-transform ${
                  preferences.smsEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2">
                <Bell size={20} className="text-purple-400" />
              </div>
              <div>
                <h4 className="font-medium text-slate-100">Push Notifications</h4>
                <p className="mt-1 text-sm text-slate-400">
                  Receive real-time notifications in your browser
                </p>
              </div>
            </div>
            <button
              onClick={() => handleToggle('pushEnabled')}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                preferences.pushEnabled ? 'bg-primary' : 'bg-slate-700'
              }`}
              role="switch"
              aria-checked={preferences.pushEnabled}
              aria-label="Toggle push notifications"
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-primary-foreground transition-transform ${
                  preferences.pushEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {/* One live region for both outcomes, so a save result is announced
              once rather than racing two separate regions. */}
          <div role="status" aria-live="polite" className="min-h-5">
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle size={16} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            {!error && success && (
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <CheckCircle size={16} aria-hidden="true" />
                <span>Preferences saved successfully</span>
              </div>
            )}
            {!error && !success && isDirty && (
              <span className="text-sm text-slate-400">Unsaved changes</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving || isDefault}
              aria-label="Reset notification preferences to defaults"
              className="action-button flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={16} aria-hidden="true" />
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={() => void savePreferences()}
              disabled={saving || !isDirty}
              className="action-button flex items-center gap-2 rounded-lg bg-primary px-6 py-2 font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={18} aria-hidden="true" />
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </div>
      </div>

      <div className="glass-card p-6">
        <h4 className="mb-3 font-medium text-slate-100">About Webhook Notifications</h4>
        <div className="space-y-2 text-sm text-slate-400">
          <p>Webhook notifications keep you informed about important events in your account:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Transaction status changes (pending, completed, failed)</li>
            <li>Deposit and withdrawal confirmations</li>
            <li>KYC verification updates</li>
            <li>Multisig transaction approvals</li>
            <li>Security alerts and account activity</li>
          </ul>
          <p className="mt-4">
            You can customize which channels receive notifications based on your preferences. Email notifications are
            recommended for important updates.
          </p>
        </div>
      </div>
    </div>
  );
};

export default NotificationPreferences;
