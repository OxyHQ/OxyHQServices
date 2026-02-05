/**
 * Keyboard shortcuts hook for web.
 *
 * Gmail-like keyboard shortcuts:
 * - c: Compose new email
 * - r: Reply to selected email
 * - a: Reply all to selected email
 * - f: Forward selected email
 * - e: Archive selected email
 * - #: Delete selected email
 * - j: Next email
 * - k: Previous email
 * - s: Star/unstar selected email
 * - u: Mark as unread
 * - /: Focus search
 */

import { useEffect, useCallback } from 'react';
import { Platform } from 'react-native';

interface KeyboardShortcutsConfig {
  onCompose?: () => void;
  onReply?: () => void;
  onReplyAll?: () => void;
  onForward?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onNextMessage?: () => void;
  onPrevMessage?: () => void;
  onToggleStar?: () => void;
  onMarkUnread?: () => void;
  onFocusSearch?: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcuts(config: KeyboardShortcutsConfig) {
  const {
    onCompose,
    onReply,
    onReplyAll,
    onForward,
    onArchive,
    onDelete,
    onNextMessage,
    onPrevMessage,
    onToggleStar,
    onMarkUnread,
    onFocusSearch,
    enabled = true,
  } = config;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Don't trigger shortcuts with modifier keys (except shift for some)
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'c':
          event.preventDefault();
          onCompose?.();
          break;

        case 'r':
          event.preventDefault();
          if (event.shiftKey) {
            // Shift+R = Reply All (alternative)
            onReplyAll?.();
          } else {
            onReply?.();
          }
          break;

        case 'a':
          event.preventDefault();
          onReplyAll?.();
          break;

        case 'f':
          event.preventDefault();
          onForward?.();
          break;

        case 'e':
          event.preventDefault();
          onArchive?.();
          break;

        case '#':
        case 'delete':
        case 'backspace':
          if (event.key === '#' || event.shiftKey) {
            event.preventDefault();
            onDelete?.();
          }
          break;

        case 'j':
          event.preventDefault();
          onNextMessage?.();
          break;

        case 'k':
          event.preventDefault();
          onPrevMessage?.();
          break;

        case 's':
          event.preventDefault();
          onToggleStar?.();
          break;

        case 'u':
          event.preventDefault();
          onMarkUnread?.();
          break;

        case '/':
          event.preventDefault();
          onFocusSearch?.();
          break;

        default:
          break;
      }
    },
    [
      onCompose,
      onReply,
      onReplyAll,
      onForward,
      onArchive,
      onDelete,
      onNextMessage,
      onPrevMessage,
      onToggleStar,
      onMarkUnread,
      onFocusSearch,
    ],
  );

  useEffect(() => {
    // Only enable on web
    if (Platform.OS !== 'web' || !enabled) {
      return;
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}
