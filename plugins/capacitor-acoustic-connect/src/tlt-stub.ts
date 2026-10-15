/**
 * The Connect SDK for Android runs a DOM-capture script in the WebView at every screen transition. It logs
 * `TLT is undefined!` when the page has no Tealeaf script and calls `tlBridge.setDCID(...)` regardless (the plugin
 * gives the page an inert `tlBridge`, see TlBridgeShim.kt). This gives the page an inert `TLT` as well, so the script
 * finds what it looks for: it then gets no DOM capture id and "not initialised", which is what it gets without a `TLT`.
 * Android only; a page that has a real `TLT` keeps it. It never throws: it runs when the plugin module loads, and a
 * failure here (a frozen `window`, a missing platform) must not stop the plugin from loading.
 */
export function installTltStub(page: object | undefined, platform: string): void {
  try {
    const win = page as { TLT?: unknown } | undefined;
    if (!win || platform !== 'android' || typeof win.TLT !== 'undefined') return;
    win.TLT = {
      isInitialized: () => false,
      logDOMCapture: () => null,
      registerBridgeCallbacks: () => undefined,
      destroy: () => undefined,
    };
  } catch {
    // The stub only quiets the SDK's script; without it the plugin works as before.
  }
}
