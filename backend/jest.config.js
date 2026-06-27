/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  collectCoverage: true,
  coverageDirectory: "coverage",
  collectCoverageFrom: [
    "src/**/*.ts",
    // Tracing module tests are added in later tasks (Tasks 6-13)
    "!src/tracing/**/*.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 49,
      lines: 50,
      statements: 50,
    },
  },
};
