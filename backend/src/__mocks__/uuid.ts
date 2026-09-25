import crypto from 'crypto';

export const v4 = (): string => crypto.randomUUID();
export const v1 = (): string => crypto.randomUUID();
export const validate = (str: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
export const parse = (str: string): Uint8Array => Buffer.from(str.replace(/-/g, ''), 'hex');
export const stringify = (arr: Uint8Array): string => Buffer.from(arr).toString('hex');

export default {
  v4,
  v1,
  validate,
  parse,
  stringify,
};
