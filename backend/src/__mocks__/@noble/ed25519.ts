module.exports = {
  sign: jest.fn(),
  signAsync: jest.fn(),
  verify: jest.fn(),
  verifyAsync: jest.fn(),
  getPublicKey: jest.fn(),
  getPublicKeyAsync: jest.fn(),
  hashes: {
    sha512: undefined,
  },
  utils: {
    sha512: undefined,
    randomPrivateKey: jest.fn(),
  },
  etc: {
    sha512: undefined,
    sha512Sync: undefined,
  },
  Point: class {},
};
