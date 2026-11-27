import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView, {
  AutoLockSettingsSection,
  BiometricSettingsSection,
  CurrencySelector,
  LanguageSelector,
} from './SettingsView';
import { usePreferencesStore } from '../store/walletStore';
import { formatFiat } from '../lib/fiat';
import { AUTOLOCK_STORAGE_KEY } from '../lib/sessionLock';
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

describe('AutoLockSettingsSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers 5 / 15 / 30 minutes and Never, defaulting to 15 minutes', () => {
    render(<AutoLockSettingsSection />);
    const group = screen.getByRole('radiogroup', { name: /auto-lock after inactivity/i });
    expect(group).toBeTruthy();
    expect(screen.getByRole('radio', { name: '15 minutes' })).toHaveAttribute('aria-checked', 'true');
    ['5 minutes', '30 minutes', 'Never'].forEach((name) =>
      expect(screen.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'false'),
    );
  });

  it('persists the chosen duration and warns when set to Never', () => {
    render(<AutoLockSettingsSection />);

    fireEvent.click(screen.getByRole('radio', { name: '5 minutes' }));
    expect(localStorage.getItem(AUTOLOCK_STORAGE_KEY)).toBe('5');
    expect(screen.getByRole('radio', { name: '5 minutes' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'Never' }));
    expect(localStorage.getItem(AUTOLOCK_STORAGE_KEY)).toBe('never');
    expect(screen.getByRole('note')).toHaveTextContent(/shared computers/i);
  });
});

describe('CurrencySelector', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => usePreferencesStore.getState().resetPreferences());
  });

  const liveRates = (rates: Record<string, number>) =>
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          rates: Object.entries(rates).map(([buy_asset, rate]) => ({ sell_asset: 'USD', buy_asset, rate })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

  const renderSelector = (fetchImpl?: typeof fetch) =>
    render(
      <I18nProvider>
        <CurrencySelector apiBaseUrl={fetchImpl ? 'http://fx.test' : undefined} fetchImpl={fetchImpl} />
      </I18nProvider>,
    );

  it('lists every supported fiat currency, defaulting to USD', () => {
    renderSelector();
    const select = screen.getByLabelText('Display Currency') as HTMLSelectElement;
    expect(select.value).toBe('USD');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['USD', 'EUR', 'GBP', 'NGN', 'BRL']);
  });

  it('switches currency, persists it to the preferences store and converts with live rates', async () => {
    const fetchImpl = liveRates({ EUR: 0.9, GBP: 0.8, NGN: 1600, BRL: 5 });
    renderSelector(fetchImpl);
    await waitFor(() => expect(screen.getByText('Live rate')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Display Currency'), { target: { value: 'EUR' } });

    expect(usePreferencesStore.getState().preferences.fiatCurrency).toBe('EUR');
    expect(screen.getByTestId('currency-preview')).toHaveTextContent(formatFiat(900, 'EUR').replace(/\s/g, ' '));

    fireEvent.change(screen.getByLabelText('Display Currency'), { target: { value: 'NGN' } });
    expect(screen.getByTestId('currency-preview')).toHaveTextContent(formatFiat(1_600_000, 'NGN').replace(/\s/g, ' '));
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://fx.test/sep40/rates',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falls back to estimated rates and says so when the FX service fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    act(() => usePreferencesStore.getState().setFiatCurrency('GBP'));
    renderSelector(fetchImpl);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(screen.getByText(/Estimated rate/)).toBeInTheDocument();
    expect(screen.getByTestId('currency-preview')).toHaveTextContent(formatFiat(790, 'GBP').replace(/\s/g, ' '));
  });
});
