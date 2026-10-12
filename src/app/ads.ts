// Rewarded ads, in the Android app only (AdMob through Capacitor). The web version has no ads: ad
// networks can't load in a cross-origin-isolated page, which the engine needs.
//
// These are Google's public test ad units. Swap in the real AdMob app ID (AndroidManifest.xml) and
// ad unit before release, and set TESTING to false.
const TESTING = true;
const REWARDED_AD_UNIT = 'ca-app-pub-3940256099942544/5224354917';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

/** True in the native app, where rewarded ads can be shown. */
export function adsAvailable(): boolean {
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

let ready: Promise<typeof import('@capacitor-community/admob')> | null = null;

/** Loads the AdMob plugin and asks for consent where the law requires it (EU/UK), once. */
function admob(): Promise<typeof import('@capacitor-community/admob')> {
  ready ??= (async () => {
    const mod = await import('@capacitor-community/admob');
    await mod.AdMob.initialize({ initializeForTesting: TESTING });
    const consent = await mod.AdMob.requestConsentInfo();
    if (consent.isConsentFormAvailable && consent.status === mod.AdmobConsentStatus.REQUIRED) {
      await mod.AdMob.showConsentForm();
    }
    return mod;
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

/**
 * Shows a rewarded ad. Resolves true only if the player watched it to the reward; false if there
 * was no ad, it failed, or they closed it early.
 */
export async function showRewardedAd(): Promise<boolean> {
  if (!adsAvailable()) return false;
  const handles: { remove: () => Promise<void> }[] = [];
  try {
    const { AdMob, RewardAdPluginEvents } = await admob();
    await AdMob.prepareRewardVideoAd({ adId: REWARDED_AD_UNIT, isTesting: TESTING });
    // showRewardVideoAd only settles when the reward is earned, so closing the ad early is
    // noticed through the Dismissed event instead.
    let earned = false;
    const closed = new Promise<void>((resolve) => {
      void AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
        earned = true;
      }).then((h) => handles.push(h));
      void AdMob.addListener(RewardAdPluginEvents.Dismissed, () => resolve()).then((h) => handles.push(h));
      void AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => resolve()).then((h) => handles.push(h));
    });
    AdMob.showRewardVideoAd().then(
      () => {
        earned = true;
      },
      (err) => console.warn('Rewarded ad failed to show', err),
    );
    await closed;
    return earned;
  } catch (err) {
    console.warn('Rewarded ad failed', err);
    return false;
  } finally {
    for (const h of handles) void h.remove();
  }
}
