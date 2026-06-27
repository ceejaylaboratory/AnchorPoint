import { useCallback, useMemo, useState } from 'react';
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { FieldRequirement } from '../types';
import { UploadProgressBar } from './UploadProgressBar';
import { uploadDocument } from '../lib/kyc/uploadDocument';

type FileUploadState = {
  progress: number;
  status: 'idle' | 'uploading' | 'complete' | 'error';
  error?: string;
  uploadId?: string;
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

  const updateFieldState = useCallback((key: string, patch: Partial<FileUploadState>) => {
    setUploadStates((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { progress: 0, status: 'idle' }), ...patch },
    }));
  }, []);

  const handleFileChange = async (field: FieldRequirement, file: File | undefined) => {
    if (!file) {
      return;
    }

    updateFieldState(field.key, { status: 'uploading', progress: 0, error: undefined });

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
  };

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
    if (allRequiredComplete) {
      onComplete?.(completedUploads);
    }
  };

  if (fileFields.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 w-full max-w-xl space-y-4 text-left">
      <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Document Uploads</h4>
      {fileFields.map((field) => {
        const state = uploadStates[field.key] ?? { progress: 0, status: 'idle' as const };

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

            <div className="flex items-center gap-3">
              <label
                htmlFor={`kyc-upload-${field.key}`}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2 text-sm text-slate-300 transition hover:border-primary/50 hover:text-slate-100"
              >
                <Upload size={16} aria-hidden="true" />
                Choose file
              </label>
              <input
                id={`kyc-upload-${field.key}`}
                type="file"
                accept={field.accept ?? 'image/jpeg,image/png,application/pdf'}
                className="sr-only"
                disabled={state.status === 'uploading'}
                onChange={(e) => handleFileChange(field, e.target.files?.[0])}
              />
              {state.status === 'complete' && (
                <CheckCircle2 size={18} className="text-emerald-400" aria-label="Upload complete" />
              )}
              {state.status === 'error' && (
                <AlertCircle size={18} className="text-rose-400" aria-label="Upload failed" />
              )}
            </div>

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
