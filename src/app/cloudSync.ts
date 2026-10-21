import { cloudDiffers, mergeCloud } from '../game/cloudSave';
import { emptyRecords } from '../game/records';
import {
  loadAccount,
  loadSyncBase,
  onSavesChanged,
  readCloudData,
  type SavedAccount,
  saveAccount,
  writeCloudData,
} from '../game/storage';

// Keeps a signed-in player's progress in step with their account. Firebase is only loaded once
// the player has an account (or comes back from signing in), so signed-out play stays offline.

/** How long after a save to upload, so a burst of saves (a round ending) goes up once. */
const UPLOAD_DELAY_MS = 3000;
/** Set while a web sign-in is on its way back to delete the account (Firebase wanted a fresh sign-in). */
const PENDING_DELETE_KEY = 'acc.signin.delete';

export interface SyncHooks {
  /** True while a run or match is being played: the account's copy of the run waits until it ends. */
  playing(): boolean;
  /** The account's data was written to this device: refresh what's on screen (the run too, if `run`). */
  applied(run: boolean): void;
  /** Sign-in state or sync status changed (for the Profile). */
  changed(): void;
}

export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: number }
  | { kind: 'error'; message: string };

export class CloudSync {
  account: SavedAccount | null = loadAccount();
  status: SyncStatus = { kind: 'idle' };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly hooks: SyncHooks) {}

  /** Finishes a web sign-in coming back from Google, then syncs if signed in. Call once at startup. */
  async start(): Promise<void> {
    onSavesChanged(() => this.schedule());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.syncNow();
    });
    const { takeGoogleRedirect } = await import('../online/googleRedirect');
    const redirect = takeGoogleRedirect();
    if (redirect && 'error' in redirect) this.fail(redirect.error);
    else if (redirect) await this.finishWebSignIn(redirect.idToken);
    else if (this.account) await this.syncNow();
  }

  /** Signs in with Google (in the app right away; on the web via a trip to Google). */
  async signIn(): Promise<void> {
    try {
      const account = await import('../online/account');
      const info = await account.signInWithGoogle();
      if (info) await this.signedIn(info);
    } catch (e) {
      this.fail(signInError(e));
    }
  }

  /** Signs out. This device keeps its progress; it just stops syncing. */
  async signOut(): Promise<void> {
    await this.syncNow();
    try {
      await (await import('../online/account')).signOut();
    } catch {
      // Signed out locally either way.
    }
    this.setAccount(null);
    this.status = { kind: 'idle' };
    this.hooks.changed();
  }

  /** Deletes the account and its saved progress (this device keeps its own). */
  async deleteAccount(): Promise<void> {
    try {
      const account = await import('../online/account');
      if ((await account.deleteAccount()) === 'reauth') {
        sessionStorage.setItem(PENDING_DELETE_KEY, '1');
        (await import('../online/googleRedirect')).startGoogleSignIn();
        return;
      }
      this.setAccount(null);
      this.status = { kind: 'idle' };
      this.hooks.changed();
    } catch (e) {
      this.fail(`Couldn't delete the account: ${message(e)}`);
    }
  }

  /** Uploads (and pulls) now; resolves when done. Does nothing when signed out. */
  syncNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.account) return Promise.resolve();
    this.running = this.running.then(() => this.sync());
    return this.running;
  }

  private schedule(): void {
    if (!this.account) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), UPLOAD_DELAY_MS);
  }

  private async finishWebSignIn(idToken: string): Promise<void> {
    try {
      const account = await import('../online/account');
      if (sessionStorage.getItem(PENDING_DELETE_KEY)) {
        sessionStorage.removeItem(PENDING_DELETE_KEY);
        await account.deleteAfterReauth(idToken);
        this.setAccount(null);
        this.hooks.changed();
        return;
      }
      await this.signedIn(await account.signInWithIdToken(idToken));
    } catch (e) {
      this.fail(signInError(e));
    }
  }

  private async signedIn(info: SavedAccount): Promise<void> {
    this.setAccount(info);
    this.hooks.changed();
    await this.syncNow();
  }

  private async sync(): Promise<void> {
    const signedInAs = this.account;
    if (!signedInAs) return;
    this.status = { kind: 'syncing' };
    this.hooks.changed();
    try {
      const account = await import('../online/account');
      const who = await account.currentAccount();
      if (who?.uid !== signedInAs.uid) {
        // Signed out elsewhere, or the sign-in expired: stop syncing until they sign in again.
        this.setAccount(null);
        this.status = { kind: 'idle' };
        this.hooks.changed();
        return;
      }
      const keepRun = this.hooks.playing();
      const local = readCloudData();
      const base = loadSyncBase() ?? emptyRecords();
      const merged = await account.syncCloud(who.uid, (cloud) => mergeCloud(cloud, local, base, keepRun));
      // Anything saved here while the upload was on its way is added on top, not lost; it goes up next time.
      const now = readCloudData();
      const mine = mergeCloud(merged, now, local.records, keepRun);
      writeCloudData(mine, merged.records, !keepRun);
      if (cloudDiffers(mine, now)) this.hooks.applied(!keepRun && JSON.stringify(mine.run) !== JSON.stringify(now.run));
      this.status = { kind: 'synced', at: Date.now() };
    } catch (e) {
      this.status = { kind: 'error', message: `Couldn't sync: ${message(e)}` };
    }
    this.hooks.changed();
  }

  private setAccount(account: SavedAccount | null): void {
    saveAccount(account);
    this.account = account;
  }

  private fail(text: string): void {
    this.status = { kind: 'error', message: text };
    this.hooks.changed();
  }
}

function message(e: unknown): string {
  const code = (e as { code?: string }).code;
  if (code === 'auth/network-request-failed' || code === 'unavailable') return 'no connection.';
  return e instanceof Error ? e.message : String(e);
}

function signInError(e: unknown): string {
  const text = message(e);
  // Closing Google's sheet in the app isn't an error worth showing.
  if (/cancel/i.test(text)) return 'Sign-in was cancelled.';
  return `Sign-in failed: ${text}`;
}
