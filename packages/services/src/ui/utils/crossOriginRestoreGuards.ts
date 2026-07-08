import {
  OXY_CROSS_ORIGIN_RESTORE_ATTEMPTED_KEY,
  OXY_IDP_BRIDGE_ATTEMPTED_KEY,
  OXY_SILENT_OAUTH_ATTEMPTED_KEY,
  OXY_IDP_HANDOFF_ATTEMPTED_KEY,
} from '@oxyhq/core';

function sessionStore(): Storage | undefined {
  return (globalThis as { sessionStorage?: Storage }).sessionStorage;
}

/** True when this tab already attempted cross-origin restore (bridge or silent OAuth). */
export function isCrossOriginRestoreBlocked(): boolean {
  const store = sessionStore();
  if (!store) return false;
  return Boolean(
    store.getItem(OXY_CROSS_ORIGIN_RESTORE_ATTEMPTED_KEY) ||
      store.getItem(OXY_SILENT_OAUTH_ATTEMPTED_KEY) ||
      store.getItem(OXY_IDP_BRIDGE_ATTEMPTED_KEY),
  );
}

/** Mark restore as attempted — never auto-retry until sign-out clears guards. */
export function markCrossOriginRestoreAttempted(): void {
  const store = sessionStore();
  if (!store) return;
  store.setItem(OXY_CROSS_ORIGIN_RESTORE_ATTEMPTED_KEY, '1');
  store.setItem(OXY_SILENT_OAUTH_ATTEMPTED_KEY, '1');
  store.setItem(OXY_IDP_BRIDGE_ATTEMPTED_KEY, '1');
}

/** Clear all cross-origin restore loop guards (call on sign-out). */
export function clearCrossOriginRestoreGuards(): void {
  const store = sessionStore();
  if (!store) return;
  for (const key of [
    OXY_CROSS_ORIGIN_RESTORE_ATTEMPTED_KEY,
    OXY_SILENT_OAUTH_ATTEMPTED_KEY,
    OXY_IDP_BRIDGE_ATTEMPTED_KEY,
    OXY_IDP_HANDOFF_ATTEMPTED_KEY,
  ]) {
    store.removeItem(key);
  }
}
