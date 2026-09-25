import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { SwapCalculator, type SwapQuote } from './SwapCalculator';

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
