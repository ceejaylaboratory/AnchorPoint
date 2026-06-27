import { generateStorageKey } from './storage-key';

describe('generateStorageKey', () => {
  const account = 'GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K';
  const fieldName = 'id_photo_front';
  const uploadId = '550e8400-e29b-41d4-a716-446655440000';

  it('produces deterministic keys from account, fieldName, and uploadId', () => {
    const key1 = generateStorageKey(account, fieldName, uploadId);
    const key2 = generateStorageKey(account, fieldName, uploadId);
    expect(key1).toBe(key2);
    expect(key1).toBe(`${account}/${fieldName}/${uploadId}`);
  });

  it('produces unique keys for different uploadIds', () => {
    const key1 = generateStorageKey(account, fieldName, uploadId);
    const key2 = generateStorageKey(account, fieldName, '660e8400-e29b-41d4-a716-446655440001');
    expect(key1).not.toBe(key2);
  });

  it('separates segments with forward slashes', () => {
    const key = generateStorageKey(account, fieldName, uploadId);
    const parts = key.split('/');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(account);
    expect(parts[1]).toBe(fieldName);
    expect(parts[2]).toBe(uploadId);
  });
});
