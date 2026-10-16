// Android's back button, in the app. Without the App plugin, back closes the app whatever screen it's
// on. Like ads.ts, this checks for the native app through the global Capacitor sets, so the web build
// doesn't load the plugin at all.

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

/**
 * Calls `back` for each press of the back button: it closes whatever is on top or steps back toward
 * the menu, and returns false on the menu itself, where the app goes to the background like any other.
 */
export async function listenForBack(back: () => boolean): Promise<void> {
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (cap?.isNativePlatform?.() !== true) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    if (!back()) void App.minimizeApp();
  });
}
