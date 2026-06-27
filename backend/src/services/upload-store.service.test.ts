import { uploadStore } from './upload-store.service';

describe('uploadStore', () => {
  beforeEach(() => {
    // Clear in-memory maps or stale records if any
    const recordsMap = (uploadStore as any).records;
    if (recordsMap) {
      recordsMap.clear();
    }
  });

  it('should create and retrieve an upload record', () => {
    const expiresAt = new Date(Date.now() + 60000);
    const record = uploadStore.create(
      'GD3...123',
      'id_front',
      'kyc/GD3...123/id_front/1',
      'image/png',
      expiresAt
    );

    expect(record.uploadId).toBeDefined();
    expect(record.status).toBe('PENDING');
    expect(record.account).toBe('GD3...123');

    const fetched = uploadStore.get(record.uploadId);
    expect(fetched).toEqual(record);
  });

  it('should set the status of a record', () => {
    const expiresAt = new Date(Date.now() + 60000);
    const record = uploadStore.create(
      'GD3...123',
      'id_front',
      'kyc/GD3...123/id_front/1',
      'image/png',
      expiresAt
    );

    uploadStore.setStatus(record.uploadId, 'COMPLETED');
    expect(uploadStore.get(record.uploadId)?.status).toBe('COMPLETED');
  });

  it('should expire stale records', () => {
    const pastDate = new Date(Date.now() - 10000);
    const record = uploadStore.create(
      'GD3...123',
      'id_front',
      'kyc/GD3...123/id_front/1',
      'image/png',
      pastDate
    );

    const expiredCount = uploadStore.expireStale();
    expect(expiredCount).toBe(1);
    expect(uploadStore.get(record.uploadId)?.status).toBe('EXPIRED');
  });
});
