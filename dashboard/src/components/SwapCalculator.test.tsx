import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import {
  DEFAULT_SLIPPAGE,
  SLIPPAGE_STORAGE_KEY,
  SwapCalculator,
  calculatePriceImpact,
  loadSlippage,
  minimumReceived,
  priceImpactLevel,
  slippageAdvisory,
  validateSlippage,
  type SwapQuote,
} from './SwapCalculator';

describe('SwapCalculator Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders initial swap calculator with inputs and asset dropdowns', () => {
    render(<SwapCalculator initialSellAmount="100" />);

    expect(screen.getByText(/Asset Swap & FX Calculator/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sell Amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Receive Amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sell Asset/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Buy Asset/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Swap currencies/i })).toBeInTheDocument();
  });

  it('debounces input changes before requesting quote', async () => {
    const mockQuote: SwapQuote = {
      id: 'quote-test-1',
      sourceAsset: 'USDC',
      destinationAsset: 'EURC',
      sourceAmount: '200.00',
      destinationAmount: '184.0000',
      price: '0.920000',
      fee: '0.6000',
      expirationTime: Math.floor(Date.now() / 1000) + 30,
      totalValiditySeconds: 30,
      confidence: 0.99,
    };

    const mockFetch = vi.fn().mockResolvedValue(mockQuote);

    render(
      <SwapCalculator
        onFetchQuote={mockFetch}
        debounceMs={300}
        initialSellAmount=""
      />
    );

    const sellInput = screen.getByLabelText(/Sell Amount/i);

    // Type 2
    fireEvent.change(sellInput, { target: { value: '2' } });
    // Advance less than debounceMs
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(mockFetch).not.toHaveBeenCalled();

    // Type 20
    fireEvent.change(sellInput, { target: { value: '20' } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(mockFetch).not.toHaveBeenCalled();

    // Type 200
    fireEvent.change(sellInput, { target: { value: '200' } });
    
    // Now advance past debounceMs
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith({
      sellAsset: 'USDC',
      buyAsset: 'EURC',
      sellAmount: '200',
    });
  });

  it('displays calculated quote details, exchange rate, and fee breakdown', async () => {
    const mockQuote: SwapQuote = {
      id: 'quote-rate-1',
      sourceAsset: 'USDC',
      destinationAsset: 'EURC',
      sourceAmount: '100.00',
      destinationAmount: '92.1600',
      price: '0.921600',
      fee: '0.3000',
      expirationTime: Math.floor(Date.now() / 1000) + 30,
      totalValiditySeconds: 30,
      confidence: 0.99,
      routingPath: ['USDC', 'EURC'],
    };

    const mockFetch = vi.fn().mockResolvedValue(mockQuote);

    render(
      <SwapCalculator
        onFetchQuote={mockFetch}
        initialSellAmount="100"
        debounceMs={100}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByText(/1 USDC = 0.921600 EURC/i)).toBeInTheDocument();
    expect(screen.getByText(/0.3000 USDC/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('92.1600')).toBeInTheDocument();
  });

  it('flips sell and buy assets when flip button is clicked', async () => {
    render(<SwapCalculator initialSellAsset="USDC" initialBuyAsset="EURC" debounceMs={100} />);

    const flipBtn = screen.getByRole('button', { name: /Swap currencies/i });

    await act(async () => {
      fireEvent.click(flipBtn);
    });

    const sellSelect = screen.getByLabelText(/Sell Asset/i) as HTMLSelectElement;
    const buySelect = screen.getByLabelText(/Buy Asset/i) as HTMLSelectElement;

    expect(sellSelect.value).toBe('EURC');
    expect(buySelect.value).toBe('USDC');
  });

  it('updates countdown timer and displays expiry indicator', async () => {
    const mockQuote: SwapQuote = {
      id: 'quote-countdown-test',
      sourceAsset: 'USDC',
      destinationAsset: 'EURC',
      sourceAmount: '100.00',
      destinationAmount: '92.0000',
      price: '0.920000',
      fee: '0.3000',
      expirationTime: Math.floor(Date.now() / 1000) + 30,
      totalValiditySeconds: 30,
    };

    const mockFetch = vi.fn().mockResolvedValue(mockQuote);

    render(
      <SwapCalculator
        onFetchQuote={mockFetch}
        initialSellAmount="100"
        debounceMs={50}
        autoRefresh={false}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    const progressbar = screen.getByRole('progressbar', { name: /Quote validity countdown/i });
    expect(progressbar).toBeInTheDocument();
    expect(progressbar).toHaveAttribute('aria-valuenow', '30');

    // Advance 10 seconds
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(progressbar).toHaveAttribute('aria-valuenow', '20');
    expect(screen.getByText(/20s remaining/i)).toBeInTheDocument();

    // Advance remaining 20 seconds to expire
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });

    expect(screen.getByText(/^Expired$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quote Expired - Refresh to Swap/i })).toBeDisabled();
  });

  it('allows clicking quick preset amounts', async () => {
    render(<SwapCalculator initialSellAmount="50" debounceMs={100} />);

    const preset250 = screen.getByRole('button', { name: '$250' });

    await act(async () => {
      fireEvent.click(preset250);
    });

    const sellInput = screen.getByLabelText(/Sell Amount/i) as HTMLInputElement;
    expect(sellInput.value).toBe('250');
  });

  it('executes swap successfully and invokes onSwapSuccess callback', async () => {
    const mockQuote: SwapQuote = {
      id: 'quote-swap-exec',
      sourceAsset: 'USDC',
      destinationAsset: 'EURC',
      sourceAmount: '100.00',
      destinationAmount: '92.0000',
      price: '0.920000',
      fee: '0.3000',
      expirationTime: Math.floor(Date.now() / 1000) + 30,
      totalValiditySeconds: 30,
    };

    const mockSuccess = vi.fn();
    const mockFetch = vi.fn().mockResolvedValue(mockQuote);

    render(
      <SwapCalculator
        onFetchQuote={mockFetch}
        onSwapSuccess={mockSuccess}
        initialSellAmount="100"
        debounceMs={50}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    const swapBtn = screen.getByRole('button', { name: /Swap USDC for EURC/i });
    expect(swapBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(swapBtn);
      vi.advanceTimersByTime(700);
    });

    expect(mockSuccess).toHaveBeenCalledWith(mockQuote);
    expect(screen.getByText(/Successfully converted 100.00 USDC to 92.0000 EURC!/i)).toBeInTheDocument();
  });
});

const baseQuote = (overrides: Partial<SwapQuote> = {}): SwapQuote => ({
  id: 'q-1',
  sourceAsset: 'USDC',
  destinationAsset: 'EURC',
  sourceAmount: '100',
  destinationAmount: '92.0000',
  price: '0.920000',
  fee: '0.3000',
  expirationTime: Math.floor(Date.now() / 1000) + 30,
  totalValiditySeconds: 30,
  ...overrides,
});

describe('slippage helpers', () => {
  afterEach(() => localStorage.clear());

  it('accepts tolerances in (0, 50] and rejects negative, zero, >50 and NaN', () => {
    expect(validateSlippage(0.1)).toBe('');
    expect(validateSlippage(50)).toBe('');
    expect(validateSlippage(-1)).toMatch(/greater than 0/);
    expect(validateSlippage(0)).toMatch(/greater than 0/);
    expect(validateSlippage(50.01)).toMatch(/cannot exceed 50/);
    expect(validateSlippage(NaN)).toMatch(/valid/);
  });

  it('advises on unusually low or high but valid tolerances', () => {
    expect(slippageAdvisory(0.01)).toMatch(/may fail/);
    expect(slippageAdvisory(0.5)).toBe('');
    expect(slippageAdvisory(10)).toMatch(/front-run/);
    expect(slippageAdvisory(80)).toBe('');
  });

  it('loads the persisted tolerance and ignores invalid stored values', () => {
    expect(loadSlippage()).toBe(DEFAULT_SLIPPAGE);
    localStorage.setItem(SLIPPAGE_STORAGE_KEY, '1');
    expect(loadSlippage()).toBe(1);
    localStorage.setItem(SLIPPAGE_STORAGE_KEY, '99');
    expect(loadSlippage()).toBe(DEFAULT_SLIPPAGE);
  });

  it('computes minimum received after slippage', () => {
    expect(minimumReceived('100', 0.5)).toBeCloseTo(99.5);
    expect(minimumReceived('92', 1)).toBeCloseTo(91.08);
  });
});

describe('price impact', () => {
  it('uses the constant-product formula when pool reserves are present', () => {
    // 100 in against a 900 reserve: 100 / (900 + 100) = 10%
    const q = baseQuote({ poolReserves: { source: '900', destination: '828' } });
    expect(calculatePriceImpact(q)).toBeCloseTo(10);
  });

  it('is negligible for a deep pool', () => {
    const q = baseQuote({ poolReserves: { source: '10000000', destination: '9200000' } });
    expect(calculatePriceImpact(q)).toBeLessThan(0.01);
  });

  it('falls back to execution vs mid price without reserves', () => {
    expect(calculatePriceImpact(baseQuote())).toBeCloseTo(0);
    expect(calculatePriceImpact(baseQuote({ destinationAmount: '87.4' }))).toBeCloseTo(5);
  });

  it('classifies impact into low / warning (>2%) / high (>5%)', () => {
    expect(priceImpactLevel(1)).toBe('low');
    expect(priceImpactLevel(2)).toBe('low');
    expect(priceImpactLevel(2.5)).toBe('warning');
    expect(priceImpactLevel(5)).toBe('warning');
    expect(priceImpactLevel(5.1)).toBe('high');
  });
});

describe('SwapCalculator slippage settings & impact warnings', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  const renderWithQuote = async (quote: SwapQuote) => {
    render(<SwapCalculator onFetchQuote={vi.fn().mockResolvedValue(quote)} debounceMs={10} autoRefresh={false} />);
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
  };

  it('selects a preset and persists it to localStorage', async () => {
    await renderWithQuote(baseQuote());
    fireEvent.click(screen.getByRole('button', { name: 'Slippage settings' }));
    fireEvent.click(screen.getByRole('button', { name: '1%' }));

    expect(localStorage.getItem(SLIPPAGE_STORAGE_KEY)).toBe('1');
    expect(screen.getByTestId('slippage-display')).toHaveTextContent('1%');
    expect(screen.getByTestId('minimum-received')).toHaveTextContent('91.0800 EURC');
  });

  it('restores the persisted slippage on mount', async () => {
    localStorage.setItem(SLIPPAGE_STORAGE_KEY, '0.1');
    await renderWithQuote(baseQuote());
    expect(screen.getByTestId('slippage-display')).toHaveTextContent('0.1%');
  });

  it('rejects out-of-range custom slippage with a warning and keeps the last valid value', async () => {
    await renderWithQuote(baseQuote());
    fireEvent.click(screen.getByRole('button', { name: 'Slippage settings' }));
    const custom = screen.getByLabelText('Custom slippage tolerance');

    fireEvent.change(custom, { target: { value: '75' } });
    expect(screen.getByRole('alert')).toHaveTextContent('cannot exceed 50%');
    expect(custom).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('slippage-display')).toHaveTextContent(`${DEFAULT_SLIPPAGE}%`);

    fireEvent.change(custom, { target: { value: '-2' } });
    expect(screen.getByRole('alert')).toHaveTextContent('greater than 0');

    fireEvent.change(custom, { target: { value: '2.5' } });
    expect(screen.getByTestId('slippage-display')).toHaveTextContent('2.5%');
    expect(localStorage.getItem(SLIPPAGE_STORAGE_KEY)).toBe('2.5');
  });

  it('shows an amber badge for impact between 2% and 5% without blocking', async () => {
    // 3 / 97 ≈ 3.09%
    await renderWithQuote(baseQuote({ sourceAmount: '3', poolReserves: { source: '97', destination: '90' } }));
    expect(screen.getByTestId('price-impact')).toHaveAttribute('data-level', 'warning');
    expect(screen.getByRole('button', { name: /Swap USDC for EURC/ })).toBeEnabled();
  });

  it('requires explicit acknowledgement before a >5% impact swap', async () => {
    const onSwapSuccess = vi.fn();
    const quote = baseQuote({ poolReserves: { source: '900', destination: '828' } });
    render(
      <SwapCalculator
        onFetchQuote={vi.fn().mockResolvedValue(quote)}
        onSwapSuccess={onSwapSuccess}
        debounceMs={10}
        autoRefresh={false}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    expect(screen.getByTestId('price-impact')).toHaveAttribute('data-level', 'high');
    const blocked = screen.getByRole('button', { name: /Acknowledge Price Impact/ });
    expect(blocked).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/I understand and want to swap anyway/));
    const swap = screen.getByRole('button', { name: /Swap USDC for EURC/ });
    expect(swap).toBeEnabled();

    fireEvent.click(swap);
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(onSwapSuccess).toHaveBeenCalledWith(quote);
  });
});
