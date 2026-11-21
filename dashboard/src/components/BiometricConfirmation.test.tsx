import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BiometricConfirmation } from './BiometricConfirmation';
import { I18nProvider } from '../i18n/config';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      className,
      ref,
    }: {
      children?: ReactNode;
      className?: string;
      ref?: Ref<HTMLDivElement>;
    }) => (
      <div ref={ref} className={className}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

type GetCredential = (options: CredentialRequestOptions) => Promise<Credential | null>;

const stubCredentials = (get: GetCredential) => {
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get } });
};

const stubAuthenticator = (available: boolean) => {
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(available),
    },
  });
};

const makeAssertion = (): PublicKeyCredential => {
  const authenticatorData = new Uint8Array(37);
  authenticatorData[32] = 0x04;
  return {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    response: {
      authenticatorData: authenticatorData.buffer,
      clientDataJSON: new Uint8Array([123, 125]).buffer,
      signature: new Uint8Array([9, 8, 7]).buffer,
    },
  } as unknown as PublicKeyCredential;
};

const setup = (overrides: Partial<Parameters<typeof BiometricConfirmation>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <I18nProvider>
      <BiometricConfirmation
        isOpen
        amount="1,500.00"
        assetCode="USDC"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onConfirm, onCancel };
};

beforeEach(() => {
  stubAuthenticator(true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'credentials');
  Reflect.deleteProperty(window, 'PublicKeyCredential');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<BiometricConfirmation />', () => {
  it('shows the amount and confirms after a successful WebAuthn assertion', async () => {
    const get = vi.fn().mockResolvedValue(makeAssertion());
    stubCredentials(get);
    const { onConfirm, onCancel } = setup();

    expect(await screen.findByTestId('biometric-amount')).toHaveTextContent('1,500.00 USDC');
    fireEvent.click(await screen.findByTestId('biometric-verify-button'));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onCancel).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
    const { publicKey } = get.mock.calls[0][0] as { publicKey: PublicKeyCredentialRequestOptions };
    expect(publicKey.userVerification).toBe('required');
  });

  it('stops the transfer and explains a cancelled ceremony', async () => {
    stubCredentials(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
    const { onConfirm } = setup();

    fireEvent.click(await screen.findByTestId('biometric-verify-button'));

    expect(
      await screen.findByText('Biometric verification was cancelled. No transfer was submitted.'),
    ).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('stops the transfer when credential resolution fails', async () => {
    stubCredentials(vi.fn().mockRejectedValue(new Error('authenticator failure')));
    const { onConfirm } = setup();

    fireEvent.click(await screen.findByTestId('biometric-verify-button'));

    expect(await screen.findByText('Biometric verification failed. No transfer was submitted.')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('falls back straight to password/PIN on devices without biometrics', async () => {
    Reflect.deleteProperty(navigator, 'credentials');
    Reflect.deleteProperty(window, 'PublicKeyCredential');
    const { onConfirm } = setup();

    const input = await screen.findByTestId('biometric-fallback-input');
    fireEvent.change(input, { target: { value: '1234' } });
    fireEvent.click(screen.getByTestId('biometric-fallback-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not confirm an empty fallback code', async () => {
    Reflect.deleteProperty(navigator, 'credentials');
    Reflect.deleteProperty(window, 'PublicKeyCredential');
    const { onConfirm } = setup();

    fireEvent.click(await screen.findByTestId('biometric-fallback-confirm'));

    expect(await screen.findByText('Enter your password or PIN to confirm the transfer.')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('lets the user choose the fallback after a biometric failure', async () => {
    stubCredentials(vi.fn().mockRejectedValue(new Error('no sensor')));
    const { onConfirm } = setup();

    fireEvent.click(await screen.findByTestId('biometric-verify-button'));
    expect(await screen.findByText(/verification failed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('biometric-use-fallback'));
    fireEvent.change(screen.getByTestId('biometric-fallback-input'), { target: { value: 'pin' } });
    fireEvent.click(screen.getByTestId('biometric-fallback-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel without confirming when the user dismisses the prompt', async () => {
    stubCredentials(vi.fn());
    const { onConfirm, onCancel } = setup();

    fireEvent.click(await screen.findByTestId('biometric-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
