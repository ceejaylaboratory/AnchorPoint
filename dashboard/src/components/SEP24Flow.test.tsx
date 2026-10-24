import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEP24Flow } from './SEP24Flow';
import type { UiConfig } from '../types';

// Stand-in for the real uploader: exposes buttons that drive the in-flight
// state through the same callback the real component uses.
vi.mock('./KycDocumentUpload', () => ({
  KycDocumentUpload: ({
    onUploadingChange,
    onComplete,
  }: {
    onUploadingChange?: (uploading: boolean) => void;
    onComplete?: (ids: Record<string, string>) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onUploadingChange?.(true)}>
        Start upload
      </button>
      <button type="button" onClick={() => onUploadingChange?.(false)}>
        Finish upload
      </button>
      <button type="button" onClick={() => onComplete?.({ id_document: 'upload-1' })}>
        Submit documents
      </button>
    </div>
  ),
}));

const uiConfig: UiConfig = {
  brandName: 'AnchorPoint',
  primaryColor: '#3b82f6',
  accentColor: '#14b8a6',
  fieldRequirements: {
    deposit: [{ key: 'amount', label: 'Amount', required: true }],
    withdraw: [{ key: 'amount', label: 'Amount', required: true }],
    kyc: [{ key: 'id_document', label: 'ID Document', required: true, type: 'file' }],
  },
};

const ACCOUNT = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

const openUploadModal = async () => {
  render(<SEP24Flow type="deposit" uiConfig={uiConfig} apiBaseUrl="http://localhost:3002" account={ACCOUNT} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue with USDC' }));
  // The step transition mounts the next step after the previous one exits.
  fireEvent.click(await screen.findByRole('button', { name: /Upload KYC documents/ }));
  return screen.getByRole('dialog', { name: 'Upload KYC Documents' });
};

const backdrop = () => document.querySelector('.backdrop-blur-sm') as HTMLElement;

describe('SEP24Flow document upload modal (#1528)', () => {
  it('hides the upload entry point when no account is connected', async () => {
    render(<SEP24Flow type="deposit" uiConfig={uiConfig} apiBaseUrl="http://localhost:3002" />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with USDC' }));
    await screen.findByRole('heading', { name: 'Deposit Details' });

    expect(screen.queryByRole('button', { name: /Upload KYC documents/ })).toBeNull();
  });

  it('closes on backdrop click when no upload is running', async () => {
    await openUploadModal();

    fireEvent.click(backdrop());

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload KYC Documents' })).toBeNull());
  });

  it('keeps the modal open and asks for confirmation on backdrop click during an upload', async () => {
    await openUploadModal();
    fireEvent.click(screen.getByRole('button', { name: 'Start upload' }));

    fireEvent.click(backdrop());

    expect(screen.getByRole('dialog', { name: 'Upload KYC Documents' })).toBeTruthy();
    expect(screen.getByRole('alertdialog', { name: 'Upload in progress' })).toBeTruthy();
    // The uploader stays mounted, so the in-flight upload is not torn down.
    expect(screen.getByRole('button', { name: 'Start upload' })).toBeTruthy();
  });

  it('also guards Escape during an upload', async () => {
    await openUploadModal();
    fireEvent.click(screen.getByRole('button', { name: 'Start upload' }));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByRole('dialog', { name: 'Upload KYC Documents' })).toBeTruthy();
    expect(screen.getByRole('alertdialog', { name: 'Upload in progress' })).toBeTruthy();
  });

  it('"Keep uploading" dismisses the confirmation only', async () => {
    await openUploadModal();
    fireEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    fireEvent.click(backdrop());

    fireEvent.click(screen.getByRole('button', { name: 'Keep uploading' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Upload KYC Documents' })).toBeTruthy();
  });

  it('closes when the user confirms discarding the upload', async () => {
    await openUploadModal();
    fireEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    fireEvent.click(backdrop());

    fireEvent.click(screen.getByRole('button', { name: 'Close and discard upload' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload KYC Documents' })).toBeNull());
  });

  it('drops the confirmation and allows closing once the upload finishes', async () => {
    await openUploadModal();
    fireEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    fireEvent.click(backdrop());
    fireEvent.click(screen.getByRole('button', { name: 'Finish upload' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.click(backdrop());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload KYC Documents' })).toBeNull());
  });

  it('closes after the documents are submitted', async () => {
    await openUploadModal();

    fireEvent.click(screen.getByRole('button', { name: 'Submit documents' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload KYC Documents' })).toBeNull());
  });
});
