/**
 * Imperative bridge for the unified {@link OxyAccountDialog}.
 *
 * Mirrors `bottomSheetManager` — a tiny module-level indirection so any caller
 * (even outside React, e.g. an app's imperative "sign in" handler) can open the
 * single account dialog without a ref. `OxyContext` registers the live open/close
 * controls on mount via {@link registerAccountDialogControls} and reports the
 * dialog's visibility here via {@link notifyAccountDialogVisibility}; the exported
 * `openAccountDialog` / `closeAccountDialog` drive those controls.
 *
 * `showSignInModal` / `hideSignInModal` / `subscribeToSignInModal` are the stable
 * public surface the previous `SignInModal` module owned — kept so existing
 * consumers (inbox, accounts) keep working while the sign-in surface is now the
 * unified dialog opened on its `signin` view.
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

/**
 * Report the dialog's current visibility so subscribers (e.g. `OxySignInButton`)
 * can reflect an in-flight "Signing in…" state. Called by the provider whenever
 * the open flag changes, so listeners stay accurate regardless of what triggered
 * the change (imperative open, backdrop dismiss, completed sign-in).
 */
export function notifyAccountDialogVisibility(visible: boolean): void {
  for (const listener of visibilityListeners) {
    listener(visible);
  }
}

/**
 * Subscribe to dialog visibility changes. Returns an unsubscribe function.
 * Retains the name the old `SignInModal` exposed so `OxySignInButton` keeps its
 * "Signing in…" affordance.
 */
export function subscribeToSignInModal(listener: (visible: boolean) => void): () => void {
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
  };
}

/** Open the unified dialog on its sign-in view. Public back-compat entry point. */
export function showSignInModal(): void {
  openAccountDialog('signin');
}

/** Close the unified dialog. Public back-compat entry point. */
export function hideSignInModal(): void {
  closeAccountDialog();
}
