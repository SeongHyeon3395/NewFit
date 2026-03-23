// Jest setup for React Native project

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');

  const passthrough = (v) => v;

  return {
    __esModule: true,
    default: {
      View,
      // Fallback for other Animated.* usages
      createAnimatedComponent: (Comp) => Comp,
    },
    useSharedValue: (init) => ({ value: init }),
    useAnimatedStyle: (updater) => updater(),
    withTiming: passthrough,
    withSpring: passthrough,
    withSequence: (...values) => values[values.length - 1],
  };
});

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('react-native-image-crop-picker', () => ({
  openCamera: jest.fn(() => Promise.reject(new Error('ImagePicker mocked'))),
  openPicker: jest.fn(() => Promise.reject(new Error('ImagePicker mocked'))),
  openCropper: jest.fn(() => Promise.reject(new Error('cancel'))),
}));

jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(() => Promise.resolve({ didCancel: true })),
  launchImageLibrary: jest.fn(() => Promise.resolve({ didCancel: true })),
}));

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

jest.mock('react-native-image-resizer', () => ({
  createResizedImage: jest.fn(async (uri) => ({ uri, path: uri })),
}));

jest.mock('react-native-vision-camera', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    Camera: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
    useCameraDevice: () => ({ id: 'mock-device' }),
    useCameraPermission: () => ({ hasPermission: true, requestPermission: async () => true }),
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  },
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  useNetInfo: jest.fn(() => ({ isConnected: true, isInternetReachable: true })),
}));

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('react-native-screens', () => ({
  enableScreens: jest.fn(),
  enableFreeze: jest.fn(),
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({ idToken: 'mock-google-id-token' })),
    signOut: jest.fn(async () => undefined),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

jest.mock('@react-native-seoul/kakao-login', () => ({
  login: jest.fn(async () => ({ accessToken: 'mock-kakao-access-token' })),
  loginWithKakaoAccount: jest.fn(async () => ({ accessToken: 'mock-kakao-access-token' })),
  logout: jest.fn(async () => 'ok'),
  unlink: jest.fn(async () => 'ok'),
  getProfile: jest.fn(async () => ({ id: 1, nickname: 'mock' })),
  getAccessToken: jest.fn(async () => ({ accessToken: 'mock-kakao-access-token', expiresIn: '3600' })),
}));
