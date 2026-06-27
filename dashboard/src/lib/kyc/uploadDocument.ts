import axios from 'axios';

export type UploadProgressCallback = (percent: number) => void;

export type UploadDocumentParams = {
  apiBaseUrl: string;
  account: string;
  fieldName: string;
  file: File;
  onProgress?: UploadProgressCallback;
};

export type UploadDocumentResult = {
  uploadId: string;
  fieldName: string;
};

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('authToken');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

export async function uploadDocument({
  apiBaseUrl,
  account,
  fieldName,
  file,
  onProgress,
}: UploadDocumentParams): Promise<UploadDocumentResult> {
  const urlResponse = await fetch(`${apiBaseUrl}/sep12/customer/upload-url`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      account,
      field_name: fieldName,
      content_type: file.type,
      file_size: String(file.size),
    }),
  });

  if (!urlResponse.ok) {
    const body = (await urlResponse.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to request upload URL (${urlResponse.status})`);
  }

  const { upload_id, url } = (await urlResponse.json()) as { upload_id: string; url: string };

  await axios.put(url, file, {
    headers: { 'Content-Type': file.type },
    onUploadProgress: (event: { loaded: number; total?: number }) => {
      if (!onProgress) {
        return;
      }
      const total = event.total ?? file.size;
      const percent = total > 0 ? Math.round((event.loaded * 100) / total) : 0;
      onProgress(percent);
    },
  });

  const confirmResponse = await fetch(`${apiBaseUrl}/sep12/customer/upload-confirm`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ upload_id, account }),
  });

  if (!confirmResponse.ok) {
    const body = (await confirmResponse.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to confirm upload (${confirmResponse.status})`);
  }

  return { uploadId: upload_id, fieldName };
}
