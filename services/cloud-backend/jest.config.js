module = module || {};
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^trading-core$': '<rootDir>/../../packages/trading-core/src/index.ts',
    '^trading-core/(.*)$': '<rootDir>/../../packages/trading-core/src/$1',
  },
};
