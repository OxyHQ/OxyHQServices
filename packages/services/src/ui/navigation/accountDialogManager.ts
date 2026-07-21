/**
 * Imperative, outside-React entry points for the unified `OxyAccountDialog`.
 *
 * These delegate to the live handles the mounted `OxyProvider` registers via
 * {@link registerAccountDialogControls}. Under the hood `open`/`close` present
 * and dismiss the `AccountDialog` surface on the shared Bloom surface stack
 * (`OxyContext.openAccountDialog` → `presentDetached('AccountDialog', …)`), so
 * whether the dialog is open is owned by that stack — this module is only the
 * thin bridge that reaches the provider's controller (which sets the dialog
 * view) from a non-React call site.
 */

import type { AccountDialogView } from '@oxyhq/core';

/**
 * Live open/close handles registered by the mounted provider. `open` presents
 * the `AccountDialog` surface (and points its view); `close` dismisses it. Both
 * are stack operations — this interface never carries visibility state.
 */
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
