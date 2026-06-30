import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyablePublicKey } from './CopyablePublicKey';

const PUBLIC_KEY = 'GBRPYHIL2DZA7B2TNNK3H53ZLMFTN7ZSG6EVM4RGICXKWRB3YAMPLE';

describe('CopyablePublicKey', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });
    writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('copies the full public key while displaying a shortened value', async () => {
    render(<CopyablePublicKey publicKey={PUBLIC_KEY} />);

    expect(screen.getByText('GBRPYHIL...B3YAMPLE')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /copy public key/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PUBLIC_KEY));

    expect(screen.getByText('Public key copied to clipboard.')).toBeTruthy();
  });

  it('announces clipboard failures without throwing', async () => {
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    render(<CopyablePublicKey publicKey={PUBLIC_KEY} />);

    fireEvent.click(screen.getByRole('button', { name: /copy public key/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PUBLIC_KEY));

    expect(screen.getByText('Unable to copy public key.')).toBeTruthy();
  });
});
