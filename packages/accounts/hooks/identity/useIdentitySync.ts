import { useCallback, useEffect, useState } from 'react';
import { toast } from '@oxyhq/bloom';
import { useIdentity } from '@/hooks/useIdentity';
import { useTranslation } from '@/lib/i18n';
import { isUsernameRequiredError } from '@/utils/auth/errorUtils';

export interface UseIdentitySyncResult {
  /** Whether the "username required" modal should be visible. */
  showUsernameModal: boolean;
  /** Hide the modal and re-attempt the identity sync after a username is set. */
  handleUsernameModalComplete: () => Promise<void>;
  /** Dismiss the modal without retrying (user cancelled). */
  dismissUsernameModal: () => void;
  /** Whether the local identity is currently considered synced with the server. */
  isSynced: boolean;
  /** Trigger an identity sync (used by pull-to-refresh). Undefined until ready. */
  syncIdentity: (() => Promise<unknown>) | undefined;
}

/**
 * Home-screen identity auto-sync.
 *
 * Encapsulates the on-mount check-and-sync behaviour and the "username
 * required" modal flow that previously lived inline on the home screen. The
 * effect semantics are preserved exactly:
 *
 *   - On mount (and whenever `isIdentitySynced` / `syncIdentity` change), it
 *     calls `isIdentitySynced()` — which updates the identity store as a side
 *     effect — and, if the identity is not yet synced, fires `syncIdentity()`.
 *   - A `USERNAME_REQUIRED` error surfaces the username modal; any other error
 *     is swallowed (the sync retries on the next mount/focus) and logged only
 *     in development.
 *   - Completing the modal hides it and retries the sync, toasting on failure.
 *
 * This is identity-sensitive code: the trigger conditions, the guard against
 * re-running, and the error handling are intentionally identical to the
 * original screen-level effect.
 */
export function useIdentitySync(): UseIdentitySyncResult {
  const { syncIdentity, isIdentitySynced, identitySyncState } = useIdentity();
  const { t } = useTranslation();

  const [showUsernameModal, setShowUsernameModal] = useState(false);

  // Use reactive state from identity store (with defaults)
  const { isSynced } = identitySyncState || { isSynced: true };

  // Check sync status on mount and auto-sync if needed
  useEffect(() => {
    const checkAndSync = async () => {
      if (isIdentitySynced) {
        // This updates the identity store internally
        const synced = await isIdentitySynced();

        // Auto-sync if not synced (store will update isSyncing)
        if (!synced && syncIdentity) {
          try {
            await syncIdentity();
          } catch (err: unknown) {
            // Check if error is username required - show modal
            if (isUsernameRequiredError(err)) {
              setShowUsernameModal(true);
            } else if (__DEV__) {
              // Silent fail for other errors - auto-sync retries on next
              // mount/focus; surface for diagnostics in development only.
              console.warn('[Home] Auto-sync failed:', err);
            }
          }
        }
      }
    };
    checkAndSync();
  }, [isIdentitySynced, syncIdentity]);

  const handleUsernameModalComplete = useCallback(async () => {
    setShowUsernameModal(false);
    // Retry sync after username is set
    if (syncIdentity) {
      try {
        await syncIdentity();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('home.syncFailedMessage');
        toast.error(message);
      }
    }
  }, [syncIdentity, t]);

  const dismissUsernameModal = useCallback(() => {
    setShowUsernameModal(false);
  }, []);

  return {
    showUsernameModal,
    handleUsernameModalComplete,
    dismissUsernameModal,
    isSynced,
    syncIdentity,
  };
}
