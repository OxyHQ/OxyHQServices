/**
 * Imperative controls for the unified {@link OxyAccountDialog}.
 */

import type { AccountDialogView } from '@oxyhq/core';

/** Live open/close handles registered by the mounted provider. */
export interface AccountDialogControls {
  open: (view?: AccountDialogView) => void;
  close: () => void;
}

let controls: AccountDialogControls | null = null;
const visibilityListeners = new Set<(visible: boolean) => void>();

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

/** Subscribe to account dialog visibility changes. */
export function subscribeToAccountDialog(listener: (visible: boolean) => void): () => void {
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
  };
}
