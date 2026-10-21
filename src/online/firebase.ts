import { type FirebaseApp, initializeApp } from 'firebase/app';
import { type Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore, getFirestore } from 'firebase/firestore';

// The Firebase app shared by online rooms (client.ts) and accounts (account.ts). Loaded only when a
// player goes online or has an account, so a signed-out single player never downloads the SDK.

/** The web app's Firebase config. It's public by design: the security rules (firestore.rules) protect the data. */
const CONFIG = {
  apiKey: 'AIzaSyB-cI9n3wnbeoPmL-74jXWKQgZpiGzBnb4',
  authDomain: 'auto-chess-chess.firebaseapp.com',
  projectId: 'auto-chess-chess',
  storageBucket: 'auto-chess-chess.firebasestorage.app',
  messagingSenderId: '570904955189',
  appId: '1:570904955189:web:f410a59a661f8baecaa47c',
};

/** Set VITE_FIREBASE_EMULATOR=1 to use local emulators (npm run e2e:online, development). */
export const USE_EMULATOR = import.meta.env.VITE_FIREBASE_EMULATOR === '1';

/**
 * Firebase App Check (reCAPTCHA Enterprise site key, also public): requests carry proof that they
 * come from this game on its real site, so copies elsewhere can't use the project. Empty = off.
 * Not used with the emulators or in the Android app (its WebView origin is https://localhost; it
 * will need Play Integrity through a native plugin once it's on Google Play). On localhost the SDK
 * prints a debug token to the console, to register in the Firebase console for local testing.
 */
const APP_CHECK_SITE_KEY = '';

export interface Firebase {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let ready: Promise<Firebase> | null = null;

/** The app, signed-in state and database, set up once (with the emulators when USE_EMULATOR). */
export function firebase(): Promise<Firebase> {
  ready ??= (async () => {
    const app = initializeApp(CONFIG);
    await startAppCheck(app);
    const auth = getAuth(app);
    const db = getFirestore(app);
    if (USE_EMULATOR) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    // The saved sign-in (if any) is restored before anything asks who's signed in.
    await auth.authStateReady();
    return { app, auth, db };
  })();
  return ready;
}

/** True in the Android app. */
export function isNative(): boolean {
  return (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;
}

async function startAppCheck(app: FirebaseApp): Promise<void> {
  if (!APP_CHECK_SITE_KEY || USE_EMULATOR || isNative()) return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    (self as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}
