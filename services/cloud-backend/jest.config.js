module = module || {};
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^trading-core$': '<rootDir>/../../packages/trading-core/src/index.ts',
  },
};
