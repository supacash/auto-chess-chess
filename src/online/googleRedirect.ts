// Google sign-in by redirect: the page goes to Google's sign-in screen and comes back with an ID
// token in the URL fragment, which Firebase then accepts (src/online/account.ts). Popups and
// embedded frames don't work here: the engine needs the page to be cross-origin isolated, which
// cuts popups off from the page and blocks Google's frames.

/** The Google OAuth web client (Google Cloud → APIs & Services → Credentials). Public by design. */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

const NONCE_KEY = 'acc.signin.nonce';

export function googleSignInAvailable(): boolean {
  return GOOGLE_CLIENT_ID !== '';
}

/** Where Google sends the player back: the app's own page, without any fragment or query. */
function returnUrl(): string {
  return `${location.origin}${location.pathname}`;
}

/** Leaves for Google's sign-in screen. The page reloads on the way back. */
export function startGoogleSignIn(): void {
  const nonce = randomString();
  try {
    sessionStorage.setItem(NONCE_KEY, nonce);
  } catch {
    // Without session storage the nonce can't be checked on return; Google still signs the token.
  }
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: returnUrl(),
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
    prompt: 'select_account',
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export type RedirectResult = { idToken: string } | { error: string } | null;

/**
 * Reads (and removes from the address bar) a sign-in result Google sent back, if this page load is
 * one. Checks the token is for this sign-in attempt (the nonce).
 */
export function takeGoogleRedirect(hash = location.hash, expectedNonce = readNonce()): RedirectResult {
  if (!hash.includes('id_token=') && !hash.includes('error=')) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  history.replaceState(null, '', returnUrl());
  try {
    sessionStorage.removeItem(NONCE_KEY);
  } catch {
    // ignore
  }
  const error = params.get('error');
  if (error)
    return { error: error === 'access_denied' ? 'Sign-in was cancelled.' : `Google sign-in failed (${error}).` };
  const idToken = params.get('id_token');
  if (!idToken) return { error: 'Google sign-in failed (no token).' };
  const nonce = tokenNonce(idToken);
  // The emulator's test tokens aren't real JWTs and carry no nonce.
  if (nonce !== null && expectedNonce !== null && nonce !== expectedNonce) {
    return { error: 'Google sign-in failed (it may have been started in another tab). Please try again.' };
  }
  return { idToken };
}

function readNonce(): string | null {
  try {
    return sessionStorage.getItem(NONCE_KEY);
  } catch {
    return null;
  }
}

/** The nonce inside a JWT ID token (unverified: Firebase verifies the token itself). */
export function tokenNonce(idToken: string): string | null {
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.nonce === 'string' ? json.nonce : null;
  } catch {
    return null;
  }
}

function randomString(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
