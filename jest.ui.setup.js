/* UI test setup — mocks native modules for Jest / jest-expo */
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => false),
  isEnrolledAsync: jest.fn(async () => false),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  setNotificationChannelAsync: jest.fn(async () => null),
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationPriority: { HIGH: 'high' },
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string;
    exists = false;
    constructor(...parts: any[]) {
      this.uri = `file:///${parts.map(String).join('/')}`;
    }
    create() {
      this.exists = true;
    }
    write() {}
    delete() {
      this.exists = false;
    }
  }
  return {
    File: FakeFile,
    Paths: { cache: 'cache' },
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    getCustomerInfo: jest.fn(async () => ({ entitlements: { active: {} } })),
    getOfferings: jest.fn(async () => ({ current: null, all: {} })),
    purchasePackage: jest.fn(async () => ({
      customerInfo: { entitlements: { active: {} } },
    })),
    restorePurchases: jest.fn(async () => ({ entitlements: { active: {} } })),
  },
}));

jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props) => React.createElement(View, { testID: props.testID }),
  };
});

jest.mock(
  '@shopify/flash-list',
  () => {
    const React = require('react');
    const { FlatList } = require('react-native');
    return {
      FlashList: (props) => React.createElement(FlatList, props),
    };
  },
  { virtual: true }
);
jest.mock('react-native-screens', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    enableScreens: jest.fn(),
    Screen: View,
    ScreenContainer: View,
    NativeScreen: View,
    NativeScreenContainer: View,
  };
});

const inset = { top: 0, right: 0, bottom: 0, left: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ctx = React.createContext({ insets: inset, frame });
  return {
    SafeAreaProvider: ({ children }) =>
      React.createElement(ctx.Provider, { value: { insets: inset, frame } }, children),
    SafeAreaConsumer: ({ children }) => children(inset),
    SafeAreaView: View,
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets: inset, frame },
    SafeAreaInsetsContext: ctx,
    SafeAreaFrameContext: React.createContext(frame),
  };
});
