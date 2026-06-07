import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.yourscore.app',
  appName: 'YourScore',
  webDir: 'public',
  server: {
    url: 'https://yourscore.app',
    cleartext: false,
    androidScheme: 'https',
    iosScheme: 'https',
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#0a0a14',
  },
  android: {
    backgroundColor: '#0a0a14',
  },
};

export default config;
