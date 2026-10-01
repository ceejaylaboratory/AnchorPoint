/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: [
    "<rootDir>/src/**/*.test.ts",
    "<rootDir>/src/**/__tests__/**/*.ts",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/dist/",
    "<rootDir>/node_modules/",
    ".*\\.d\\.ts$",
  ],
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  moduleNameMapper: {
    "^uuid$": "<rootDir>/src/__mocks__/uuid.ts",
  },
  globalSetup: "<rootDir>/jest.setup.js",
  globalTeardown: "<rootDir>/jest.teardown.js",
};


