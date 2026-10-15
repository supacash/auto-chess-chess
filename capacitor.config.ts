import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the production build (dist/) in a WebView. `npm run android` builds and syncs it.
// The app ID is permanent once published on Google Play.
const config: CapacitorConfig = {
  appId: 'com.pawnedup.app',
  appName: 'Pawned Up',
  webDir: 'dist',
  android: { backgroundColor: '#1a1035' },
};

export default config;
