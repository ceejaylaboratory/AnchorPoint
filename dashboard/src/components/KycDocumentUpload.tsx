import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Upload, AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import clsx from 'clsx';
import type { FieldRequirement } from '../types';
import { UploadProgressBar } from './UploadProgressBar';
import { uploadDocument } from '../lib/kyc/uploadDocument';
import {
  ACCEPTED_KYC_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  formatFileSize,
  validateKycFile,
} from '../lib/kyc/fileValidation';

type FileUploadState = {
  progress: number;
  status: 'idle' | 'uploading' | 'complete' | 'error';
  error?: string;
  uploadId?: string;
  fileName?: string;
  previewUrl?: string;
};

type KycDocumentUploadProps = {
  apiBaseUrl: string;
  account: string;
  fields: FieldRequirement[];
  onComplete?: (uploadIds: Record<string, string>) => void;
};

const isFileField = (field: FieldRequirement) => field.type === 'file';

export const KycDocumentUpload = ({ apiBaseUrl, account, fields, onComplete }: KycDocumentUploadProps) => {
  const fileFields = useMemo(() => fields.filter(isFileField), [fields]);
  const [uploadStates, setUploadStates] = useState<Record<string, FileUploadState>>({});
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const dragCounter = useRef<Record<string, number>>({});
  const previewUrls = useRef<Record<string, string>>({});

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const updateFieldState = useCallback((key: string, patch: Partial<FileUploadState>) => {
    setUploadStates((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { progress: 0, status: 'idle' }), ...patch },
    }));
  }, []);

  const assignPreview = useCallback((key: string, file: File): string | undefined => {
    if (!file.type.startsWith('image/')) {
      return undefined;
    }
    const existing = previewUrls.current[key];
    if (existing) {
      URL.revokeObjectURL(existing);
    }
    const url = URL.createObjectURL(file);
    previewUrls.current[key] = url;
    return url;
  }, []);

  const handleFileChange = useCallback(
    async (field: FieldRequirement, file: File | undefined) => {
      if (!file) {
        return;
      }

      const validation = validateKycFile(file);
      if (!validation.valid) {
        updateFieldState(field.key, {
          status: 'error',
          progress: 0,
          error: validation.error,
          uploadId: undefined,
        });
        return;
      }

      updateFieldState(field.key, {
        status: 'uploading',
        progress: 0,
        error: undefined,
        uploadId: undefined,
        fileName: file.name,
        previewUrl: assignPreview(field.key, file),
      });

      try {
        const result = await uploadDocument({
          apiBaseUrl,
          account,
          fieldName: field.key,
          file,
          onProgress: (percent) => updateFieldState(field.key, { progress: percent }),
        });

        updateFieldState(field.key, {
          status: 'complete',
          progress: 100,
          uploadId: result.uploadId,
        });
      } catch (error) {
        updateFieldState(field.key, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    },
    [account, apiBaseUrl, assignPreview, updateFieldState],
  );

  const handleDragEnter = useCallback((event: DragEvent, key: string) => {
    event.preventDefault();
    dragCounter.current[key] = (dragCounter.current[key] ?? 0) + 1;
    setDraggingKey(key);
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
  }, []);

  const handleDragLeave = useCallback((event: DragEvent, key: string) => {
    event.preventDefault();
    dragCounter.current[key] = Math.max(0, (dragCounter.current[key] ?? 0) - 1);
    if (dragCounter.current[key] === 0) {
      setDraggingKey(null);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent, field: FieldRequirement) => {
      event.preventDefault();
      dragCounter.current[field.key] = 0;
      setDraggingKey(null);

      if (uploadStates[field.key]?.status === 'uploading') {
        return;
      }

      const file = event.dataTransfer.files?.[0];
      handleFileChange(field, file);
    },
    [handleFileChange, uploadStates],
  );

  const completedUploads = useMemo(() => {
    const ids: Record<string, string> = {};
    for (const field of fileFields) {
      const state = uploadStates[field.key];
      if (state?.status === 'complete' && state.uploadId) {
        ids[field.key] = state.uploadId;
      }
    }
    return ids;
  }, [fileFields, uploadStates]);

  const allRequiredComplete = fileFields
    .filter((f) => f.required)
    .every((f) => uploadStates[f.key]?.status === 'complete');

  const handleSubmit = () => {
    if (!allRequiredComplete) {
      return;
    }
    onComplete?.(completedUploads);

    // Drop file references and previews once documents are handed off.
    Object.values(previewUrls.current).forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current = {};
    dragCounter.current = {};
    setUploadStates({});
  };

  if (fileFields.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 w-full max-w-xl space-y-4 text-left">
      <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Document Uploads</h4>
      {fileFields.map((field) => {
        const state = uploadStates[field.key] ?? { progress: 0, status: 'idle' as const };
        const isDragging = draggingKey === field.key;

        return (
          <div
            key={field.key}
            className="rounded-xl border border-slate-800/50 bg-slate-900/50 p-4"
          >
            <label htmlFor={`kyc-upload-${field.key}`} className="mb-2 block text-sm font-medium text-slate-200">
              {field.label}
              {field.required && <span className="ml-1 text-rose-400">*</span>}
            </label>
            {field.helpText && <p className="mb-3 text-xs text-slate-500">{field.helpText}</p>}

            <div
              data-testid={`kyc-upload-zone-${field.key}`}
              onDragEnter={(e) => handleDragEnter(e, field.key)}
              onDragOver={handleDragOver}
              onDragLeave={(e) => handleDragLeave(e, field.key)}
              onDrop={(e) => handleDrop(e, field)}
              className={clsx(
                'rounded-lg border-2 border-dashed p-4 transition-colors',
                isDragging
                  ? 'border-primary/60 bg-primary/5'
                  : 'border-slate-700 bg-slate-800/40 hover:border-slate-500',
              )}
            >
              <input
                id={`kyc-upload-${field.key}`}
                type="file"
                accept={field.accept ?? ACCEPTED_KYC_MIME_TYPES.join(',')}
                className="sr-only"
                disabled={state.status === 'uploading'}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  handleFileChange(field, file);
                }}
              />
              <label
                htmlFor={`kyc-upload-${field.key}`}
                className="flex cursor-pointer items-center justify-center gap-3"
              >
                <div className="flex flex-col items-center gap-1">
                  <Upload size={20} className="text-slate-400" aria-hidden="true" />
                  <span className="text-sm text-slate-300">
                    {isDragging ? 'Drop your document here' : 'Drag & drop your document here or browse'}
                  </span>
                  <span className="text-xs text-slate-500">
                    JPEG, PNG, or PDF · up to {formatFileSize(MAX_FILE_SIZE_BYTES)}
                  </span>
                </div>
              </label>
            </div>

            {state.fileName && (
              <div className="mt-3 flex items-center gap-3">
                {state.previewUrl ? (
                  <img
                    src={state.previewUrl}
                    alt={`${field.label} preview`}
                    className="h-14 w-14 rounded-lg object-cover ring-1 ring-slate-700"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-800 ring-1 ring-slate-700">
                    <FileText size={22} className="text-slate-400" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-200">{state.fileName}</p>
                  <p className="text-xs text-slate-500">
                    {state.status === 'complete'
                      ? 'Uploaded successfully'
                      : state.status === 'uploading'
                        ? 'Uploading...'
                        : 'Awaiting upload'}
                  </p>
                </div>
                {state.status === 'complete' && (
                  <CheckCircle2 size={18} className="shrink-0 text-emerald-400" aria-label="Upload complete" />
                )}
                {state.status === 'error' && (
                  <AlertCircle size={18} className="shrink-0 text-rose-400" aria-label="Upload failed" />
                )}
              </div>
            )}

            {state.status === 'uploading' && (
              <div className="mt-3">
                <UploadProgressBar progress={state.progress} label="Uploading..." />
              </div>
            )}

            {state.status === 'error' && state.error && (
              <p className="mt-2 text-xs text-rose-400">{state.error}</p>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!allRequiredComplete}
        className="btn-primary mt-2 w-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        Submit Documents
      </button>
    </div>
  );
};

export default KycDocumentUpload;
