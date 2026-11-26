import React, { useId, useState } from 'react';
import { Fingerprint, Globe, Lock, Monitor, Moon, Sun } from 'lucide-react';
import type { UiConfig } from '../types';
import { loadBiometricSettings, sanitizeThreshold, saveBiometricSettings } from '../lib/biometricSettings';
import { RequirementList } from './RequirementList';
import AdminControls from './AdminControls';
import { PauseControlsWidget } from './AdminWidgets';
import { THEME_PREFERENCES, useTheme } from '../contexts/ThemeContext';
import type { ThemePreference } from '../contexts/ThemeContext';
import { useTranslation, type Language } from '../i18n/config';
import { AUTOLOCK_OPTIONS, useAutoLockSetting } from '../lib/sessionLock';

const THEME_OPTIONS: Record<ThemePreference, { label: string; hint: string; Icon: typeof Sun }> = {
  light: { label: 'Light', hint: 'High-contrast light palette', Icon: Sun },
  dark: { label: 'Dark', hint: 'Default dark palette', Icon: Moon },
  system: { label: 'System Default', hint: 'Follow the operating system', Icon: Monitor },
};

/** Persistent light / dark / system selector backed by ThemeContext. */
const ThemeSelector: React.FC = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <div className="glass-card p-8">
      <h3 className="mb-1 text-xl font-bold">{t('settings.appearance')}</h3>
      <p className="mb-4 text-sm text-slate-400">
        {t('settings.appearanceSubtitle', { theme: resolvedTheme })}
      </p>
      <div role="radiogroup" aria-label={t('settings.theme')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {THEME_PREFERENCES.map((preference) => {
          const { label, hint, Icon } = THEME_OPTIONS[preference];
          const selected = theme === preference;

          return (
            <button
              key={preference}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(preference)}
              className={`action-button flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                selected
                  ? 'border-primary bg-primary/10 text-slate-100'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon size={16} aria-hidden="true" />
                {label}
              </span>
              <span className="text-xs">{hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Language switcher supporting English, Spanish, Portuguese, French, and RTL stubbed languages (Arabic, Hebrew). */
export const LanguageSelector: React.FC = () => {
  const { language, changeLanguage, isRtl, t } = useTranslation();

  const LANGUAGE_OPTIONS: { code: Language; label: string; nativeName: string; isRtl?: boolean }[] = [
    { code: 'en', label: t('language.en'), nativeName: 'English' },
    { code: 'es', label: t('language.es'), nativeName: 'Español' },
    { code: 'pt', label: t('language.pt'), nativeName: 'Português' },
    { code: 'fr', label: t('language.fr'), nativeName: 'Français' },
    { code: 'ar', label: t('language.ar'), nativeName: 'العربية', isRtl: true },
    { code: 'he', label: t('language.he'), nativeName: 'עברית', isRtl: true },
  ];

  return (
    <div className="glass-card p-8">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xl font-bold">{t('settings.language')}</h3>
        {isRtl && (
          <span
            data-testid="rtl-badge"
            className="rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-medium text-primary-text"
          >
            {t('language.rtlNotice')}
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-slate-400">
        {t('settings.languageSubtitle')}
      </p>
      <div
        role="radiogroup"
        aria-label={t('settings.language')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        {LANGUAGE_OPTIONS.map(({ code, label, nativeName, isRtl: optionRtl }) => {
          const selected = language === code;

          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${label} (${nativeName})`}
              onClick={() => changeLanguage(code)}
              className={`action-button flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                selected
                  ? 'border-primary bg-primary/10 text-slate-100'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Globe size={16} aria-hidden="true" />
                {label}
              </span>
              <span className="text-xs text-slate-400">
                {nativeName} {optionRtl ? '(RTL)' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Inactivity auto-lock duration (5 / 15 / 30 minutes or Never). */
export const AutoLockSettingsSection: React.FC = () => {
  const [setting, setSetting] = useAutoLockSetting();

  return (
    <div className="glass-card p-8" data-testid="autolock-settings">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold">Auto-lock</h3>
          <p className="mt-1 text-sm text-slate-400">
            Lock the session and disconnect your wallet after a period of inactivity. You get a
            60-second warning first.
          </p>
        </div>
        <Lock size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
      </div>
      <div
        role="radiogroup"
        aria-label="Auto-lock after inactivity"
        className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {AUTOLOCK_OPTIONS.map(({ value, label }) => {
          const selected = setting === value;
          return (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setSetting(value)}
              className={`action-button rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                selected
                  ? 'border-primary bg-primary/10 text-slate-100'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {setting === 'never' ? (
        <p className="mt-3 text-xs text-amber-400" role="note">
          Your session will stay unlocked until you sign out. Avoid this on shared computers.
        </p>
      ) : null}
    </div>
  );
};

/** Opt-in security setting shared by the deposit and withdrawal flows. */
export const BiometricSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(loadBiometricSettings);
  const [thresholdDraft, setThresholdDraft] = useState(() => String(settings.thresholdUsd));
  const thresholdId = useId();

  const update = (next: { enabled: boolean; thresholdUsd: number }) => {
    setSettings(next);
    saveBiometricSettings(next);
  };

  const commitThreshold = () => {
    const thresholdUsd = sanitizeThreshold(thresholdDraft);
    setThresholdDraft(String(thresholdUsd));
    update({ ...settings, thresholdUsd });
  };

  return (
    <div className="glass-card p-8" data-testid="biometric-settings">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold">{t('biometric.settingsTitle')}</h3>
          <p className="mt-1 text-sm text-slate-400">{t('biometric.settingsDescription')}</p>
        </div>
        <Fingerprint size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-slate-300">{t('biometric.toggle')}</span>
        <button
          type="button"
          role="switch"
          aria-label={t('biometric.toggle')}
          aria-checked={settings.enabled}
          onClick={() => update({ ...settings, enabled: !settings.enabled })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
            settings.enabled ? 'bg-primary' : 'bg-slate-700'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-primary-foreground transition-transform ${
              settings.enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      <div className="mt-4 space-y-1.5">
        <label htmlFor={thresholdId} className="block text-sm font-medium text-slate-300">
          {t('biometric.thresholdLabel')}
        </label>
        <input
          id={thresholdId}
          type="number"
          min={1}
          step="0.01"
          inputMode="decimal"
          value={thresholdDraft}
          onChange={(event) => setThresholdDraft(event.target.value)}
          onBlur={commitThreshold}
          className="input-field w-full text-sm"
        />
        <p className="text-xs text-slate-400">{t('biometric.thresholdHint')}</p>
      </div>
    </div>
  );
};

export interface SettingsViewProps {
  uiConfig: UiConfig;
  apiBaseUrl: string;
}

const SettingsView: React.FC<SettingsViewProps> = ({ uiConfig, apiBaseUrl }) => {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-6">
        <ThemeSelector />
        <LanguageSelector />
        <BiometricSettingsSection />
        <AutoLockSettingsSection />
        <div className="glass-card p-8">
          <h3 className="mb-4 text-xl font-bold">{t('settings.branding')}</h3>
          <div className="space-y-6">
            <div>
              <label htmlFor="brand-name" className="mb-2 block text-sm font-medium text-slate-400">
                {t('settings.brandName')}
              </label>
              <input
                id="brand-name"
                type="text"
                value={uiConfig.brandName}
                readOnly
                aria-readonly="true"
                className="input-field w-full"
              />
            </div>
            <div>
              <label htmlFor="logo-url" className="mb-2 block text-sm font-medium text-slate-400">
                {t('settings.logoUrl')}
              </label>
              <input
                id="logo-url"
                type="text"
                value={uiConfig.logoUrl ?? t('settings.notConfigured')}
                readOnly
                aria-readonly="true"
                className="input-field w-full"
              />
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label htmlFor="primary-color-hex" className="mb-2 block text-sm font-medium text-slate-400">
                  {t('settings.primaryColor')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={uiConfig.primaryColor}
                    readOnly
                    aria-label={`Primary color preview: ${uiConfig.primaryColor}`}
                    className="h-10 w-10 cursor-default border-0 bg-transparent"
                  />
                  <input
                    id="primary-color-hex"
                    type="text"
                    value={uiConfig.primaryColor}
                    readOnly
                    aria-readonly="true"
                    className="input-field flex-1"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="accent-color-hex" className="mb-2 block text-sm font-medium text-slate-400">
                  {t('settings.accentColor')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={uiConfig.accentColor}
                    readOnly
                    aria-label={`Accent color preview: ${uiConfig.accentColor}`}
                    className="h-10 w-10 cursor-default border-0 bg-transparent"
                  />
                  <input
                    id="accent-color-hex"
                    type="text"
                    value={uiConfig.accentColor}
                    readOnly
                    aria-readonly="true"
                    className="input-field flex-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <AdminControls apiBaseUrl={apiBaseUrl} />
        <PauseControlsWidget apiBaseUrl={apiBaseUrl} />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <RequirementList
          title="Deposit Fields"
          fields={uiConfig.fieldRequirements.deposit}
        />
        <RequirementList
          title="Withdrawal Fields"
          fields={uiConfig.fieldRequirements.withdraw}
        />
      </div>
    </div>
  );
};

export default SettingsView;
