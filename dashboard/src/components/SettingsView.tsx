import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { UiConfig } from '../types';
import { RequirementList } from './RequirementList';
import AdminControls from './AdminControls';
import { PauseControlsWidget } from './AdminWidgets';
import { THEME_PREFERENCES, useTheme } from '../contexts/ThemeContext';
import type { ThemePreference } from '../contexts/ThemeContext';

const THEME_OPTIONS: Record<ThemePreference, { label: string; hint: string; Icon: typeof Sun }> = {
  light: { label: 'Light', hint: 'High-contrast light palette', Icon: Sun },
  dark: { label: 'Dark', hint: 'Default dark palette', Icon: Moon },
  system: { label: 'System', hint: 'Follow the operating system', Icon: Monitor },
};

/** Persistent light / dark / system selector backed by ThemeContext. */
const ThemeSelector: React.FC = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <div className="glass-card p-8">
      <h3 className="mb-1 text-xl font-bold">Appearance</h3>
      <p className="mb-4 text-sm text-slate-400">
        Your choice is saved on this device. Currently showing the {resolvedTheme} palette.
      </p>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

interface SettingsViewProps {
  uiConfig: UiConfig;
  apiBaseUrl: string;
}

const SettingsView: React.FC<SettingsViewProps> = ({ uiConfig, apiBaseUrl }) => {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-6">
        <ThemeSelector />
        <div className="glass-card p-8">
          <h3 className="mb-4 text-xl font-bold">Branding Configuration</h3>
          <div className="space-y-6">
            <div>
              <label htmlFor="brand-name" className="mb-2 block text-sm font-medium text-slate-400">
                Brand Name
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
                Logo URL
              </label>
              <input
                id="logo-url"
                type="text"
                value={uiConfig.logoUrl ?? 'Not configured'}
                readOnly
                aria-readonly="true"
                className="input-field w-full"
              />
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label htmlFor="primary-color-hex" className="mb-2 block text-sm font-medium text-slate-400">
                  Primary Color
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
                  Accent Color
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
