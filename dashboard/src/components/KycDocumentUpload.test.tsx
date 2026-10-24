import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KycDocumentUpload } from './KycDocumentUpload';
import { uploadDocument } from '../lib/kyc/uploadDocument';
import { MAX_FILE_SIZE_BYTES } from '../lib/kyc/fileValidation';
import type { FieldRequirement } from '../types';

vi.mock('../lib/kyc/uploadDocument', () => ({
  uploadDocument: vi.fn(),
}));

const mockedUpload = vi.mocked(uploadDocument);

const fields: FieldRequirement[] = [
  {
    key: 'id_photo_front',
    label: 'Government ID (Front)',
    required: true,
    type: 'file',
    accept: 'image/jpeg,image/png,application/pdf',
  },
];

const renderUpload = () =>
  render(
    <KycDocumentUpload apiBaseUrl="http://localhost:3002" account="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567" fields={fields} />,
  );

const createFile = (name: string, type: string, size = 1024): File => new File([new Uint8Array(size)], name, { type });

describe('KycDocumentUpload', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-preview'),
      revokeObjectURL: vi.fn(),
    });
    mockedUpload.mockResolvedValue({ uploadId: 'upload-1', fieldName: 'id_photo_front' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('accepts a valid image file through the file input and shows a thumbnail preview', async () => {
    renderUpload();

    fireEvent.change(screen.getByLabelText(/browse/i), {
      target: { files: [createFile('id-front.jpg', 'image/jpeg')] },
    });

    expect(await screen.findByText('Uploaded successfully')).toBeTruthy();
    expect(mockedUpload).toHaveBeenCalledTimes(1);

    const preview = screen.getByAltText('Government ID (Front) preview') as HTMLImageElement;
    expect(preview.src).toContain('mock-preview');
  });

  it('rejects a file with an unsupported format', async () => {
    renderUpload();

    fireEvent.change(screen.getByLabelText(/browse/i), {
      target: { files: [createFile('notes.txt', 'text/plain')] },
    });

    expect(await screen.findByText('Invalid file type. Accepted formats: JPEG, PNG, or PDF.')).toBeTruthy();
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('rejects a file larger than the 10MB limit', async () => {
    renderUpload();

    fireEvent.change(screen.getByLabelText(/browse/i), {
      target: { files: [createFile('huge.pdf', 'application/pdf', MAX_FILE_SIZE_BYTES + 1)] },
    });

    expect(await screen.findByText('File exceeds the 10MB size limit.')).toBeTruthy();
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('accepts a valid PDF dropped onto the upload zone and uploads it', async () => {
    renderUpload();
    const zone = screen.getByTestId('kyc-upload-zone-id_photo_front');

    fireEvent.dragEnter(zone, { dataTransfer: { files: [] } });
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [createFile('proof.pdf', 'application/pdf')] } });

    expect(await screen.findByText('Uploaded successfully')).toBeTruthy();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].file.name).toBe('proof.pdf');
  });

  it('rejects an invalid file dropped onto the upload zone', async () => {
    renderUpload();
    const zone = screen.getByTestId('kyc-upload-zone-id_photo_front');

    fireEvent.drop(zone, { dataTransfer: { files: [createFile('script.exe', 'application/x-msdownload')] } });

    expect(await screen.findByText('Invalid file type. Accepted formats: JPEG, PNG, or PDF.')).toBeTruthy();
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('clears uploaded file references after documents are submitted', async () => {
    const onComplete = vi.fn();
    render(
      <KycDocumentUpload
        apiBaseUrl="http://localhost:3002"
        account="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567"
        fields={fields}
        onComplete={onComplete}
      />,
    );

    fireEvent.change(screen.getByLabelText(/browse/i), {
      target: { files: [createFile('id-front.jpg', 'image/jpeg')] },
    });
    expect(await screen.findByText('Uploaded successfully')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Submit Documents' }));

    expect(onComplete).toHaveBeenCalledWith({ id_photo_front: 'upload-1' });
    expect(screen.queryByText('id-front.jpg')).toBeNull();
    expect(screen.queryByAltText('Government ID (Front) preview')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview');
    expect((screen.getByRole('button', { name: 'Submit Documents' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
