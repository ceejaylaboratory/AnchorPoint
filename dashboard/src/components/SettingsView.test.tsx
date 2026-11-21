import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView, { BiometricSettingsSection, LanguageSelector } from './SettingsView';
import { I18nProvider } from '../i18n/config';
import { ThemeProvider } from '../contexts/ThemeContext';
import { loadBiometricSettings } from '../lib/biometricSettings';
import type { UiConfig } from '../types';

const mockUiConfig: UiConfig = {
  brandName: 'TestAnchor',
  primaryColor: '#3b82f6',
  accentColor: '#10b981',
  supportEmail: 'support@example.com',
  fieldRequirements: {
    deposit: [{ key: 'amount', label: 'Amount', required: true }],
    withdraw: [{ key: 'iban', label: 'IBAN', required: true }],
    kyc: [],
  },
};

describe('SettingsView and LanguageSelector', () => {
  beforeEach(() => {
    document.documentElement.dir = 'ltr';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders LanguageSelector with available language choices', () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <LanguageSelector />
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Language' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /English/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Español/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /العربية/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /עברית/ })).toBeTruthy();
  });

  it('switches to Spanish in settings', () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <LanguageSelector />
        </ThemeProvider>
      </I18nProvider>,
    );

    const spanishRadio = screen.getByRole('radio', { name: /Español/ });
    fireEvent.click(spanishRadio);

    expect(spanishRadio.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Idioma' })).toBeTruthy();
  });

  it('activates RTL mode and displays RTL badge when Arabic is selected', () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <LanguageSelector />
        </ThemeProvider>
      </I18nProvider>,
    );

    const arabicRadio = screen.getByRole('radio', { name: /العربية/ });
    fireEvent.click(arabicRadio);

    expect(arabicRadio.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByTestId('rtl-badge')).toBeTruthy();
  });

  it('renders complete SettingsView with branding configuration', () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <SettingsView uiConfig={mockUiConfig} apiBaseUrl="http://localhost:3002" />
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByDisplayValue('TestAnchor')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Language' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Branding Configuration' })).toBeTruthy();
  });
});

describe('BiometricSettingsSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is opt-out by default and persists the opt-in toggle', () => {
    render(
      <I18nProvider>
        <BiometricSettingsSection />
      </I18nProvider>,
    );

    const toggle = screen.getByRole('switch', {
      name: 'Require Biometrics for High-Value Transactions',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(loadBiometricSettings().enabled).toBe(false);

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(loadBiometricSettings()).toEqual({ enabled: true, thresholdUsd: 1_000 });
  });

  it('persists a custom high-value threshold on blur', () => {
    render(
      <I18nProvider>
        <BiometricSettingsSection />
      </I18nProvider>,
    );

    const threshold = screen.getByLabelText('High-value threshold (USD)');
    fireEvent.change(threshold, { target: { value: '2500' } });
    fireEvent.blur(threshold);

    expect(loadBiometricSettings()).toEqual({ enabled: false, thresholdUsd: 2_500 });
  });
});
