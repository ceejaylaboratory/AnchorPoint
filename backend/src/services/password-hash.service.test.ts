import { hashPassword, verifyPassword } from './password-hash.service';

describe('Password hash service', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('StrongPassword123');

    await expect(verifyPassword('StrongPassword123', hash)).resolves.toBe(true);
    await expect(verifyPassword('WrongPassword123', hash)).resolves.toBe(false);
  });

  it('returns false for malformed hash formats', async () => {
    await expect(verifyPassword('irrelevant', 'bad-format')).resolves.toBe(false);
  });
});
