import type { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  signInWithCredential,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { deleteDoc, doc, runTransaction } from 'firebase/firestore';
import { CLOUD_VERSION, type CloudData, parseCloudData } from '../game/cloudSave';
import { firebase, isNative } from './firebase';
import { startGoogleSignIn } from './googleRedirect';

// Accounts: Google sign-in and the account's saved progress (users/{uid}, see cloudSave.ts and
// firestore.rules). Loaded lazily, like the rest of Firebase. In the Android app Google's own sign-in
// sheet gives the ID token (the @capacitor-firebase/authentication plugin); on the web the page
// leaves for Google and comes back with it (googleRedirect.ts). Either way the Firebase web SDK
// signs in with it, so rooms and accounts share one signed-in user.

export interface AccountInfo {
  uid: string;
  /** The email address (or name) the Profile shows. */
  label: string;
}

/** The signed-in Google account, or null (signed out, or only the anonymous one online play makes). */
export async function currentAccount(): Promise<AccountInfo | null> {
  const { auth } = await firebase();
  const user = auth.currentUser;
  return user && !user.isAnonymous ? info(user) : null;
}

/**
 * Starts Google sign-in. In the app it finishes here; on the web the page goes to Google and the
 * sign-in finishes on the way back (signInWithIdToken from cloudSync.ts), so this returns null.
 */
export async function signInWithGoogle(): Promise<AccountInfo | null> {
  if (!isNative()) {
    startGoogleSignIn();
    return null;
  }
  return signInWithIdToken(await nativeIdToken());
}

/**
 * Signs in with a Google ID token. Someone already playing online anonymously keeps their user (the
 * Google account is linked to it); if that Google account already has a user, that one is used.
 */
export async function signInWithIdToken(idToken: string): Promise<AccountInfo> {
  const { auth } = await firebase();
  const credential = GoogleAuthProvider.credential(idToken);
  const user = auth.currentUser;
  if (user?.isAnonymous) {
    try {
      return info((await linkWithCredential(user, credential)).user);
    } catch (e) {
      if ((e as FirebaseError).code !== 'auth/credential-already-in-use') throw e;
      const existing = GoogleAuthProvider.credentialFromError(e as FirebaseError);
      return info((await signInWithCredential(auth, existing ?? credential)).user);
    }
  }
  return info((await signInWithCredential(auth, credential)).user);
}

export async function signOut(): Promise<void> {
  const { auth } = await firebase();
  await firebaseSignOut(auth);
  if (isNative()) {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    await FirebaseAuthentication.signOut().catch(() => {});
  }
}

/**
 * Reads the account's saved progress, merges this device's in (`merge`) and saves the result, in
 * one transaction so two devices syncing at once don't lose each other's changes. Returns what was saved.
 */
export async function syncCloud(uid: string, merge: (cloud: CloudData | null) => CloudData): Promise<CloudData> {
  const { db } = await firebase();
  const ref = doc(db, 'users', uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const raw = snap.exists() ? snap.get('data') : null;
    const cloud = typeof raw === 'string' ? parseCloudData(safeParse(raw)) : null;
    const merged = merge(cloud);
    tx.set(ref, { v: CLOUD_VERSION, updatedAt: Date.now(), data: JSON.stringify(merged) });
    return merged;
  });
}

export type DeleteResult = 'deleted' | 'reauth';

/**
 * Deletes the account and its saved progress. Firebase asks for a fresh sign-in first when the last
 * one was a while ago: the app shows Google's sheet again; on the web this returns 'reauth' and the
 * caller sends the player to Google, finishing with deleteAfterReauth on the way back.
 */
export async function deleteAccount(): Promise<DeleteResult> {
  const { auth, db } = await firebase();
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return 'deleted';
  await deleteDoc(doc(db, 'users', user.uid));
  try {
    await user.delete();
    return 'deleted';
  } catch (e) {
    if ((e as FirebaseError).code !== 'auth/requires-recent-login') throw e;
    if (!isNative()) return 'reauth';
    await deleteAfterReauth(await nativeIdToken());
    return 'deleted';
  }
}

/** Finishes deleteAccount once the player has signed in again with `idToken`. */
export async function deleteAfterReauth(idToken: string): Promise<void> {
  const { auth, db } = await firebase();
  const user = auth.currentUser;
  if (!user) return;
  await reauthenticateWithCredential(user, GoogleAuthProvider.credential(idToken));
  await deleteDoc(doc(db, 'users', user.uid));
  await user.delete();
}

/** Google's sign-in sheet in the app; its ID token (Firebase signs in on the web layer). */
async function nativeIdToken(): Promise<string> {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  if (!idToken) throw new Error('Google sign-in did not return a token.');
  return idToken;
}

function info(user: User): AccountInfo {
  return { uid: user.uid, label: user.email ?? user.displayName ?? 'Google account' };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
