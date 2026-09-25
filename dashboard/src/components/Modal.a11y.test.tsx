import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
import { ConfirmModal } from './ConfirmModal';
import { WalletModal } from './WalletModal';

expect.extend(toHaveNoViolations);

beforeAll(() => {
  // Presence transitions resolve synchronously so assertions see final markup.
  MotionGlobalConfig.skipAnimations = true;
});

beforeEach(() => {
  // The Modal defers its initial focus to the next animation frame.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

const BasicModal = ({ onClose = () => {} }: { onClose?: () => void }) => (
  <Modal isOpen title="Transfer funds" description="Review before confirming." onClose={onClose}>
    <input aria-label="Amount" />
    <button type="button">Continue</button>
  </Modal>
);

describe('Modal accessibility', () => {
  it('exposes role="dialog", aria-modal and a programmatic accessible name', () => {
    render(<BasicModal />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Transfer funds');

    const describedBy = dialog.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      'Review before confirming.',
    );
  });

  it('moves focus into the dialog when it opens', () => {
    render(<BasicModal />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<BasicModal onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wraps Tab from the last focusable element back to the first', () => {
    render(<BasicModal />);

    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, input'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first focusable element back to the last', () => {
    render(<BasicModal />);

    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, input'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('pulls focus back into the dialog when it has drifted to the page behind', () => {
    render(
      <>
        <button type="button">Outside</button>
        <BasicModal />
      </>,
    );

    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('restores focus to the triggering element on close', async () => {
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open dialog
          </button>
          <Modal isOpen={open} title="Transfer funds" onClose={() => setOpen(false)}>
            <button type="button">Continue</button>
          </Modal>
        </>
      );
    };

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('locks background scroll while open', async () => {
    const { unmount } = render(<BasicModal />);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
  });

  it('has no axe violations', async () => {
    const { container } = render(<BasicModal />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ConfirmModal accessibility', () => {
  it('has no axe violations, including the typed-confirmation field', async () => {
    const { container } = render(
      <ConfirmModal
        isOpen
        title="Delete anchor"
        message="This permanently removes the anchor configuration."
        requireTypingConfirm
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it('closes on Escape via the shared dialog', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmModal
        isOpen
        title="Delete anchor"
        message="This permanently removes the anchor configuration."
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('WalletModal accessibility', () => {
  beforeEach(() => {
    (window as any).freighterApi = {
      isConnected: async () => true,
      getPublicKey: async () => 'GB...',
      getNetwork: async () => 'PUBLIC',
      signTransaction: async () => '',
    };
  });

  afterEach(() => {
    delete (window as any).freighterApi;
  });

  it('renders as a labelled modal dialog', () => {
    render(<WalletModal isOpen onClose={() => {}} onSelect={() => {}} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Choose your provider');
  });

  it('traps Tab within the provider list', () => {
    render(<WalletModal isOpen onClose={() => {}} onSelect={() => {}} />);

    const dialog = screen.getByRole('dialog');
    const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button'));
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(buttons[0]);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<WalletModal isOpen onClose={onClose} onSelect={() => {}} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports the chosen provider', async () => {
    const onSelect = vi.fn();
    render(<WalletModal isOpen onClose={() => {}} onSelect={onSelect} />);

    const button = await screen.findByRole('button', { name: /Freighter/ });
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith('freighter');
  });

  it('has no axe violations', async () => {
    const { container } = render(<WalletModal isOpen onClose={() => {}} onSelect={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
