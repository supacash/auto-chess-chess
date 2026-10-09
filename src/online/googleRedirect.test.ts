import { afterEach, describe, expect, it, vi } from 'vitest';
import { takeGoogleRedirect, tokenNonce } from './googleRedirect';

const jwt = (payload: object) =>
  `x.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.y`;

describe('Google redirect', () => {
  // takeGoogleRedirect tidies the address bar and session storage; give it stand-ins.
  vi.stubGlobal('history', { replaceState: () => {} });
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/app/', hash: '' });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  afterEach(() => vi.clearAllMocks());

  it('ignores ordinary page loads', () => {
    expect(takeGoogleRedirect('', 'n')).toBeNull();
    expect(takeGoogleRedirect('#something', 'n')).toBeNull();
  });

  it('returns the ID token when the nonce matches', () => {
    const token = jwt({ nonce: 'abc', sub: '1' });
    expect(tokenNonce(token)).toBe('abc');
    expect(takeGoogleRedirect(`#id_token=${token}&state=x`, 'abc')).toEqual({ idToken: token });
  });

  it('rejects a token from another sign-in attempt', () => {
    const token = jwt({ nonce: 'other' });
    expect(takeGoogleRedirect(`#id_token=${token}`, 'abc')).toMatchObject({
      error: expect.stringContaining('try again'),
    });
  });

  it('reports cancelling and errors', () => {
    expect(takeGoogleRedirect('#error=access_denied', 'abc')).toEqual({ error: 'Sign-in was cancelled.' });
    expect(takeGoogleRedirect('#error=server_error', 'abc')).toMatchObject({
      error: expect.stringContaining('server_error'),
    });
  });
});
