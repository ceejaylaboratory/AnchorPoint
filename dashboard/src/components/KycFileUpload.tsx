import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  UploadCloud, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Eye, 
  FileCheck, 
  ShieldCheck, 
  Lock,
  ArrowRight
} from 'lucide-react';

export const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const DEFAULT_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf'
];
export const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];

/**
 * Validates file size and format against allowed KYC document specifications.
 */
export function validateKycFile(
  file: File,
  maxSizeBytes: number = DEFAULT_MAX_SIZE_BYTES,
  acceptedTypes: string[] = DEFAULT_ACCEPTED_TYPES
): { isValid: boolean; error?: string } {
  if (!file) {
    return { isValid: false, error: 'No file provided' };
  }

  // Check file type or extension
  const fileName = file.name.toLowerCase();
  const hasValidExtension = ACCEPTED_EXTENSIONS.some(ext => fileName.endsWith(ext));
  const hasValidMime = acceptedTypes.includes(file.type);

  if (!hasValidMime && !hasValidExtension) {
    return {
      isValid: false,
      error: 'Invalid file format. Only JPEG, PNG, and PDF documents are supported.'
    };
  }

  // Check file size
  if (file.size > maxSizeBytes) {
    const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
    return {
      isValid: false,
      error: `File size exceeds the ${maxMb}MB limit. (Current: ${(file.size / (1024 * 1024)).toFixed(2)}MB)`
    };
  }

  return { isValid: true };
}

export interface KycFileUploadProps {
  documentTypeLabel?: string;
  maxSizeBytes?: number;
  acceptedTypes?: string[];
  autoUpload?: boolean;
  onFileSelect?: (file: File) => void;
  onUploadComplete?: (file: File, uploadId: string) => void;
  onUploadError?: (error: string) => void;
}

export const KycFileUpload: React.FC<KycFileUploadProps> = ({
  documentTypeLabel = 'Government-issued ID or Passport',
  maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
  autoUpload = true,
  onFileSelect,
  onUploadComplete,
  onUploadError
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isUploaded, setIsUploaded] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up object URLs to avoid memory leaks
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const processFile = useCallback((file: File) => {
    setValidationError(null);
    setUploadProgress(0);
    setIsUploaded(false);

    const validation = validateKycFile(file, maxSizeBytes, acceptedTypes);
    if (!validation.isValid) {
      setValidationError(validation.error || 'Invalid file');
      if (onUploadError) onUploadError(validation.error || 'Invalid file');
      return;
    }

    setSelectedFile(file);
    if (onFileSelect) onFileSelect(file);

    // Generate preview for image files
    if (file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png)$/i)) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }

    // Auto upload with simulated progress
    if (autoUpload) {
      startUpload(file);
    }
  }, [maxSizeBytes, acceptedTypes, autoUpload, onFileSelect, onUploadError]);

  const startUpload = (file: File) => {
    setIsUploading(true);
    setUploadProgress(10);

    let progress = 10;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 20) + 15;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setUploadProgress(100);
        setIsUploading(false);
        setIsUploaded(true);
        if (onUploadComplete) {
          const fakeUploadId = `KYC-DOC-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
          onUploadComplete(file, fakeUploadId);
        }
      } else {
        setUploadProgress(progress);
      }
    }, 150);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setUploadProgress(0);
    setIsUploading(false);
    setIsUploaded(false);
    setValidationError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4" data-testid="kyc-file-upload-component">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Lock size={14} className="text-primary" /> {documentTypeLabel}
          </h4>
          <p className="text-xs text-slate-400 mt-0.5">
            SEP-12 Compliant • Accepted formats: JPEG, PNG, PDF (Max {(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB)
          </p>
        </div>
        {isUploaded && (
          <span 
            data-testid="kyc-upload-verified-badge"
            className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full uppercase tracking-wider"
          >
            <ShieldCheck size={13} /> Verified
          </span>
        )}
      </div>

      {/* Hidden native input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
        onChange={handleInputChange}
        className="hidden"
        data-testid="kyc-file-input"
      />

      {/* Drag & Drop Area */}
      {!selectedFile ? (
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="kyc-dropzone"
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
            isDragging 
              ? 'border-primary bg-primary/10 scale-[1.01]' 
              : 'border-slate-700 bg-slate-900/60 hover:border-primary/60 hover:bg-slate-900'
          }`}
        >
          <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
            <UploadCloud size={28} />
          </div>

          <h5 className="text-sm font-semibold text-slate-200">
            Click to upload or drag & drop document
          </h5>
          <p className="text-xs text-slate-400 mt-1">
            Drag your file here, or click to browse files from your device.
          </p>

          <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-slate-500 font-medium">
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">JPEG</span>
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">PNG</span>
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">PDF</span>
          </div>
        </div>
      ) : (
        /* Selected File Card & Preview */
        <div 
          data-testid="kyc-file-preview-card"
          className="glass-card p-5 border border-slate-800 space-y-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {previewUrl ? (
                <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-700 bg-slate-950 flex-shrink-0">
                  <img
                    src={previewUrl}
                    alt="Document Thumbnail Preview"
                    data-testid="kyc-image-thumbnail"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <Eye size={16} className="text-white" />
                  </div>
                </div>
              ) : (
                <div 
                  data-testid="kyc-pdf-icon"
                  className="w-16 h-16 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex flex-col items-center justify-center flex-shrink-0"
                >
                  <FileText size={24} />
                  <span className="text-[10px] font-bold font-mono uppercase mt-0.5">PDF</span>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-200 truncate max-w-xs md:max-w-md" data-testid="kyc-filename">
                  {selectedFile.name}
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                  <span>{(selectedFile.size / 1024).toFixed(1)} KB</span>
                  <span>•</span>
                  <span>{selectedFile.type || 'application/pdf'}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleRemoveFile}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
              title="Remove file"
              data-testid="kyc-remove-file-btn"
            >
              <X size={18} />
            </button>
          </div>

          {/* Progress Indicator */}
          {isUploading && (
            <div className="space-y-2" data-testid="kyc-upload-progress-container">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                  Encrypting & Uploading to Anchor Vault...
                </span>
                <span className="font-mono font-bold text-primary" data-testid="kyc-progress-percent">
                  {uploadProgress}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Upload Complete state */}
          {isUploaded && (
            <div className="p-3 bg-emerald-950/20 border border-emerald-500/20 rounded-lg flex items-center justify-between text-xs">
              <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                <CheckCircle2 size={16} /> Document successfully validated and attached to SEP-12 session.
              </span>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-slate-400 hover:text-white underline text-[11px]"
              >
                Replace
              </button>
            </div>
          )}
        </div>
      )}

      {/* Validation Error Banner */}
      {validationError && (
        <div 
          data-testid="kyc-validation-error"
          className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-rose-400 flex-shrink-0" />
            <span>{validationError}</span>
          </div>
          <button 
            onClick={() => setValidationError(null)} 
            className="text-rose-400 hover:text-rose-200 ml-2"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default KycFileUpload;
