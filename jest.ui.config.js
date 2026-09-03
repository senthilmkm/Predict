/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testTimeout: 20000,
  setupFilesAfterEnv: ['<rootDir>/jest.ui.setup.js'],
  testMatch: ['**/__tests__/ui/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@shopify/flash-list|@react-native-community/slider|react-native-svg)',
  ],
  moduleNameMapper: {
    '^react-native-reanimated$': 'react-native-reanimated/mock',
  },
};
