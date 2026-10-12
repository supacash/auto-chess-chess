import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the production build (dist/) in a WebView. `npm run android` builds and syncs it.
// The app ID is permanent once published on Google Play.
const config: CapacitorConfig = {
  appId: 'io.github.supacash.autochess',
  appName: 'Auto Chess²',
  webDir: 'dist',
  android: { backgroundColor: '#1d1f24' },
};

export default config;
