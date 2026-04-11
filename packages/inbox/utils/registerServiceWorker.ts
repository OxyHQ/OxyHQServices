/**
 * Service Worker registration utility.
 *
 * Only runs on web. Registers the service worker and handles update prompts.
 */

import { Platform } from 'react-native';

/**
 * Register the service worker and set up update detection.
 *
 * @param onUpdate - Called when a new SW version is waiting to activate.
 */
export function registerServiceWorker(onUpdate?: () => void): void {
  if (Platform.OS !== 'web') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');

      // Check for updates periodically (every 60 minutes)
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);

      // Detect when a new service worker is waiting
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (
            newWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            // New version available
            onUpdate?.();
          }
        });
      });
    } catch (err) {
      console.warn('[SW] Registration failed:', err);
    }
  });
}

/**
 * Tell the waiting service worker to skip waiting and take over.
 */
export function applyServiceWorkerUpdate(): void {
  if (Platform.OS !== 'web') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready.then((registration) => {
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });

  // Reload after the new SW takes over
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
