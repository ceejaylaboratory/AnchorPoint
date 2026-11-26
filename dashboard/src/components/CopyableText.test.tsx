import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY_FEEDBACK_MS, CopyableText } from './CopyableText';

const HASH = '0x9f4a1234567890abcdef1234';

describe('CopyableText', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('copies the full value while showing a shortened display value', async () => {
    render(<CopyableText value={HASH} label="Transaction hash" />);

    expect(screen.getByTestId('copyable-text-value').textContent).toBe('0x9f4a12...ef1234');

    fireEvent.click(screen.getByTestId('copyable-text-btn'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH));
    expect(screen.getByText('Transaction hash copied to clipboard.')).toBeTruthy();
  });

  it('shows a checkmark and "Copied!" tooltip for two seconds', async () => {
    vi.useFakeTimers();
    render(<CopyableText value={HASH} label="Transaction hash" />);

    fireEvent.click(screen.getByTestId('copyable-text-btn'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('.lucide-check')).toBeTruthy();
    const tooltip = screen.getByTestId('copy-tooltip');
    expect(tooltip.textContent).toBe('Copied!');
    expect(tooltip.getAttribute('data-state')).toBe('copied');
    expect(tooltip.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });

    expect(screen.queryByTestId('copy-tooltip')).toBeNull();
    expect(screen.queryByText('Transaction hash copied to clipboard.')).toBeNull();
  });

  it('announces success through a polite live region', async () => {
    render(<CopyableText value={HASH} label="Transaction hash" />);

    fireEvent.click(screen.getByTestId('copyable-text-btn'));

    const announcement = await screen.findByText('Transaction hash copied to clipboard.');
    expect(announcement.getAttribute('aria-live')).toBe('polite');
  });

  it('announces clipboard failures without throwing', async () => {
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    render(<CopyableText value={HASH} label="Transaction hash" />);

    fireEvent.click(screen.getByTestId('copyable-text-btn'));

    expect(await screen.findByText('Unable to copy transaction hash.')).toBeTruthy();
    expect(screen.getByTestId('copy-tooltip').getAttribute('data-state')).toBe('failed');
  });
});
