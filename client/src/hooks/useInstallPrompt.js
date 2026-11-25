import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * useInstallPrompt — captures the browser's `beforeinstallprompt` event so the
 * app can show its own "Install" button (instead of relying on the browser's
 * default mini-infobar).
 *
 * Installability requires a secure origin (http://localhost counts) plus a
 * registered service worker and a linked web app manifest — so this only ever
 * fires in production/preview builds. While the prompt is available,
 * `canInstall` is true; calling `install()` shows the native confirm UI, and
 * once the app is placed on the home screen `installed` flips to true (which
 * hides the button).
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault(); // we render our own install button
      setDeferred(e);
    };
    const onInstalled = () => {
      setDeferred(null);
      setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    try {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') setInstalled(true);
    } catch {
      /* prompt dismissed by the user or unsupported — ignore */
    } finally {
      setDeferred(null);
    }
  }, [deferred]);

  return useMemo(
    () => ({ canInstall: Boolean(deferred), installed, install }),
    [deferred, installed, install]
  );
}
