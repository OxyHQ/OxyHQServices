/**
 * Imperative controls for the unified {@link OxyAccountDialog}.
 *
 * Mirrors `bottomSheetManager` — a module-level indirection so any caller
 * (even outside React) can open the account dialog without a ref. `OxyContext`
 * registers live open/close controls on mount via {@link registerAccountDialogControls}.
 */

import type { AccountDialogView } from '@oxyhq/core';

/** Live open/close handles registered by the mounted provider. */
export interface AccountDialogControls {
  open: (view?: AccountDialogView) => void;
  close: () => void;
}

let controls: AccountDialogControls | null = null;
const visibilityListeners = new Set<(visible: boolean) => void>();

/**
 * Register the provider's live open/close controls. Returns an unregister
 * function that only clears the slot if it still owns it (guards against a late
 * unmount clobbering a newer provider).
 */
export function registerAccountDialogControls(next: AccountDialogControls): () => void {
  controls = next;
  return () => {
    if (controls === next) {
      controls = null;
    }
  };
}

/** Open the account dialog on `view` (default `accounts`). No-op before mount. */
export function openAccountDialog(view?: AccountDialogView): void {
  controls?.open(view);
}

/** Close the account dialog. No-op before mount. */
export function closeAccountDialog(): void {
  controls?.close();
}

/** Report dialog visibility to subscribers (e.g. `OxySignInButton` loading state). */
export function notifyAccountDialogVisibility(visible: boolean): void {
  for (const listener of visibilityListeners) {
    listener(visible);
  }
}

/** Subscribe to dialog visibility changes. */
export function subscribeToSignInModal(listener: (visible: boolean) => void): () => void {
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
  };
}

/** Open the account dialog on its sign-in view. */
export function showSignInModal(): void {
  openAccountDialog('signin');
}

/** Close the account dialog. */
export function hideSignInModal(): void {
  closeAccountDialog();
}
