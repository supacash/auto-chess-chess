import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the production build (dist/) in a WebView. `npm run android` builds and syncs it.
// The app ID is permanent once published on Google Play.
const config: CapacitorConfig = {
  appId: 'com.pawnedup.app',
  appName: 'Pawned Up',
  webDir: 'dist',
  android: { backgroundColor: '#1a1035' },
  plugins: {
    // The game is always dark: light status bar icons, whatever the phone's own theme (by default
    // they follow it, and come out dark grey on the violet in light mode). The page is edge to edge.
    SystemBars: { style: 'DARK', initialViewportFitValueHint: 'cover' },
    // Google's native sign-in sheet gives an ID token; the Firebase web SDK signs in with it
    // (src/online/account.ts), so the native layer doesn't sign in to Firebase itself.
    FirebaseAuthentication: { skipNativeAuth: true, providers: ['google.com'] },
  },
};

export default config;
