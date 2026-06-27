import React from 'react';
import type { UiConfig } from '../types';
import { RequirementList } from './RequirementList';
import AdminControls from './AdminControls';

interface SettingsViewProps {
  uiConfig: UiConfig;
  apiBaseUrl: string;
}

const SettingsView: React.FC<SettingsViewProps> = ({ uiConfig, apiBaseUrl }) => {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-6">
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
