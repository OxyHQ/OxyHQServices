/**
 * Inbox client-side preferences.
 *
 * Stores user preferences that are scoped to this device (density, swipe
 * action bindings, AI feature toggles, notification preferences). Server-
 * backed preferences (signature, vacation responder, forwarding) live in
 * the email settings API and are not duplicated here.
 *
 * Persistence: localStorage on web, AsyncStorage on native. The values are
 * loaded synchronously on web (no flash) and asynchronously on native
 * (defaults are used until the load resolves).
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

export type MessageDensity = 'compact' | 'comfortable' | 'cozy';
export type SwipeAction = 'archive' | 'delete' | 'mark-read' | 'snooze' | 'none';

export interface InboxPrefs {
  /** How tightly to pack message rows in the list. */
  density: MessageDensity;
  /** Group messages into threads in the list view. */
  conversationView: boolean;
  /** Auto-mark messages as read when opened. */
  markReadOnOpen: boolean;
  /** Show senders' avatars in the list. */
  showAvatars: boolean;
  /** Show message previews (snippets) in the list. */
  showPreviews: boolean;

  /** Action triggered by a left-to-right swipe in the list. */
  leftSwipeAction: SwipeAction;
  /** Action triggered by a right-to-left swipe in the list. */
  rightSwipeAction: SwipeAction;

  /** Enable push notifications. */
  pushNotifications: boolean;
  /** Enable email-digest summary notifications. */
  emailDigest: boolean;
  /** Play a sound when a new message arrives. */
  notificationSound: boolean;

  /** Enable the Alia daily Brief feature. */
  aiBrief: boolean;
  /** Enable Smart Reply suggestions. */
  aiSmartReply: boolean;
  /** Enable automatic categorization of messages. */
  aiCategorization: boolean;
}

const DEFAULT_PREFS: InboxPrefs = {
  density: 'comfortable',
  conversationView: true,
  markReadOnOpen: true,
  showAvatars: true,
  showPreviews: true,
  leftSwipeAction: 'archive',
  rightSwipeAction: 'delete',
  pushNotifications: true,
  emailDigest: false,
  notificationSound: true,
  aiBrief: true,
  aiSmartReply: true,
  aiCategorization: true,
};

interface InboxPrefsContextValue {
  prefs: InboxPrefs;
  setPref: <K extends keyof InboxPrefs>(key: K, value: InboxPrefs[K]) => void;
  /** True after persisted values have been loaded (always true on web). */
  loaded: boolean;
}

const STORAGE_KEY = 'inbox_user_prefs_v1';
const InboxPrefsContext = createContext<InboxPrefsContextValue | undefined>(undefined);

function loadSync(): InboxPrefs {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<InboxPrefs>;
        return { ...DEFAULT_PREFS, ...parsed };
      }
    } catch (err) {
      // Reading localStorage can throw in sandboxed/private contexts. Fall
      // back to defaults; a re-write on first update will recover.
      console.warn('[inbox-prefs] failed to load prefs', err);
    }
  }
  return DEFAULT_PREFS;
}

export function InboxPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<InboxPrefs>(loadSync);
  const [loaded, setLoaded] = useState(Platform.OS === 'web');

  // Native: hydrate from AsyncStorage.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    (async () => {
      try {
        const AsyncStorage = await import('@react-native-async-storage/async-storage').then(
          (m) => m.default,
        );
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<InboxPrefs>;
          setPrefs((curr) => ({ ...curr, ...parsed }));
        }
      } catch (err) {
        console.warn('[inbox-prefs] failed to load prefs', err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on change once loaded so we don't overwrite stored values with
  // defaults before the initial load resolves on native.
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        if (Platform.OS === 'web') {
          window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
        } else {
          const AsyncStorage = await import('@react-native-async-storage/async-storage').then(
            (m) => m.default,
          );
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
        }
      } catch (err) {
        console.warn('[inbox-prefs] failed to persist prefs', err);
      }
    })();
  }, [prefs, loaded]);

  const setPref = useCallback(<K extends keyof InboxPrefs>(key: K, value: InboxPrefs[K]) => {
    setPrefs((curr) => ({ ...curr, [key]: value }));
  }, []);

  return (
    <InboxPrefsContext.Provider value={{ prefs, setPref, loaded }}>
      {children}
    </InboxPrefsContext.Provider>
  );
}

export function useInboxPrefs(): InboxPrefsContextValue {
  const ctx = useContext(InboxPrefsContext);
  if (!ctx) {
    throw new Error('useInboxPrefs must be used within an InboxPrefsProvider');
  }
  return ctx;
}
