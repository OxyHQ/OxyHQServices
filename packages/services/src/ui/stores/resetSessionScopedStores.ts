import { useFollowStore } from './followStore';
import { useFileStore } from './fileStore';

/** Drop session-scoped Zustand slices so the next user/account never inherits stale UI state. */
export function resetSessionScopedStores(): void {
  useFollowStore.getState().resetFollowState();
  useFileStore.getState().reset();
}
