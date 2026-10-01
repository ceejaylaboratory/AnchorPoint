import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { 
  KycFileUpload, 
  validateKycFile 
} from './KycFileUpload';

describe('KycFileUpload - Dynamic KYC Document Upload Component with Drag-and-Drop', () => {
  beforeEach(() => {
    // Mock URL.createObjectURL and URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:http://localhost:3000/mock-thumbnail');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateKycFile', () => {
    it('accepts valid JPEG, PNG, and PDF files within size limits', () => {
      const jpegFile = new File(['mock content'], 'id_card.jpg', { type: 'image/jpeg' });
      const pngFile = new File(['mock content'], 'passport.png', { type: 'image/png' });
      const pdfFile = new File(['mock content'], 'utility_bill.pdf', { type: 'application/pdf' });

      expect(validateKycFile(jpegFile).isValid).toBe(true);
      expect(validateKycFile(pngFile).isValid).toBe(true);
      expect(validateKycFile(pdfFile).isValid).toBe(true);
    });

    it('rejects unsupported file formats like .exe or text/plain', () => {
      const exeFile = new File(['binary'], 'virus.exe', { type: 'application/x-msdownload' });
      const textFile = new File(['text'], 'notes.txt', { type: 'text/plain' });

      const exeRes = validateKycFile(exeFile);
      expect(exeRes.isValid).toBe(false);
      expect(exeRes.error).toContain('Only JPEG, PNG, and PDF');

      const txtRes = validateKycFile(textFile);
      expect(txtRes.isValid).toBe(false);
      expect(txtRes.error).toContain('Only JPEG, PNG, and PDF');
    });

    it('rejects files exceeding the specified maximum size limit', () => {
      // 6MB file with 5MB limit
      const bigBuffer = new Uint8Array(6 * 1024 * 1024);
      const largeFile = new File([bigBuffer], 'large_passport.png', { type: 'image/png' });

      const res = validateKycFile(largeFile, 5 * 1024 * 1024);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('exceeds the 5MB limit');
    });
  });

  describe('KycFileUpload component UI & Interactions', () => {
    it('renders initial dropzone with supported format tags', () => {
      render(<KycFileUpload documentTypeLabel="Proof of Address" />);

      expect(screen.getByTestId('kyc-dropzone')).toBeInTheDocument();
      expect(screen.getByText(/Proof of Address/i)).toBeInTheDocument();
      expect(screen.getAllByText(/JPEG/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/PNG/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/PDF/i).length).toBeGreaterThanOrEqual(1);
    });

    it('handles image selection, invokes onFileSelect, and shows thumbnail preview', () => {
      const handleSelect = vi.fn();
      render(<KycFileUpload onFileSelect={handleSelect} autoUpload={false} />);

      const fileInput = screen.getByTestId('kyc-file-input');
      const testImage = new File(['image data'], 'my_id.jpeg', { type: 'image/jpeg' });

      fireEvent.change(fileInput, { target: { files: [testImage] } });

      expect(handleSelect).toHaveBeenCalledWith(testImage);
      expect(screen.getByTestId('kyc-file-preview-card')).toBeInTheDocument();
      expect(screen.getByTestId('kyc-filename')).toHaveTextContent('my_id.jpeg');
      expect(screen.getByTestId('kyc-image-thumbnail')).toBeInTheDocument();
    });

    it('handles PDF selection and shows PDF document badge instead of image thumbnail', () => {
      render(<KycFileUpload autoUpload={false} />);

      const fileInput = screen.getByTestId('kyc-file-input');
      const testPdf = new File(['pdf data'], 'bank_statement.pdf', { type: 'application/pdf' });

      fireEvent.change(fileInput, { target: { files: [testPdf] } });

      expect(screen.getByTestId('kyc-pdf-icon')).toBeInTheDocument();
      expect(screen.getByTestId('kyc-filename')).toHaveTextContent('bank_statement.pdf');
    });

    it('shows validation error when selecting an invalid file format', () => {
      render(<KycFileUpload />);

      const fileInput = screen.getByTestId('kyc-file-input');
      const badFile = new File(['data'], 'script.sh', { type: 'application/x-sh' });

      fireEvent.change(fileInput, { target: { files: [badFile] } });

      expect(screen.getByTestId('kyc-validation-error')).toBeInTheDocument();
      expect(screen.getByText(/Only JPEG, PNG, and PDF/i)).toBeInTheDocument();
    });

    it('handles drag and drop file upload correctly', () => {
      const handleSelect = vi.fn();
      render(<KycFileUpload onFileSelect={handleSelect} autoUpload={false} />);

      const dropzone = screen.getByTestId('kyc-dropzone');
      const droppedFile = new File(['photo'], 'passport_scan.png', { type: 'image/png' });

      fireEvent.dragOver(dropzone);
      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [droppedFile]
        }
      });

      expect(handleSelect).toHaveBeenCalledWith(droppedFile);
      expect(screen.getByTestId('kyc-file-preview-card')).toBeInTheDocument();
    });

    it('displays progress indicator and invokes onUploadComplete', async () => {
      const handleComplete = vi.fn();
      render(<KycFileUpload onUploadComplete={handleComplete} autoUpload={true} />);

      const fileInput = screen.getByTestId('kyc-file-input');
      const validFile = new File(['doc'], 'gov_id.png', { type: 'image/png' });

      fireEvent.change(fileInput, { target: { files: [validFile] } });

      // Progress bar should appear
      expect(screen.getByTestId('kyc-upload-progress-container')).toBeInTheDocument();

      // Wait for simulated upload to finish
      await waitFor(() => {
        expect(handleComplete).toHaveBeenCalled();
      }, { timeout: 3000 });

      expect(screen.getByTestId('kyc-upload-verified-badge')).toBeInTheDocument();
    });

    it('allows removing the selected file and returning to dropzone', () => {
      render(<KycFileUpload autoUpload={false} />);

      const fileInput = screen.getByTestId('kyc-file-input');
      const file = new File(['sample'], 'id.png', { type: 'image/png' });

      fireEvent.change(fileInput, { target: { files: [file] } });
      expect(screen.getByTestId('kyc-file-preview-card')).toBeInTheDocument();

      const removeBtn = screen.getByTestId('kyc-remove-file-btn');
      fireEvent.click(removeBtn);

      expect(screen.getByTestId('kyc-dropzone')).toBeInTheDocument();
    });
  });
});
