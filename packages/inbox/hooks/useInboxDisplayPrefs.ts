/**
 * Typed selector for the message-list *display* preferences.
 *
 * Components that only care about how the list looks (`MessageRow`,
 * `InboxList`) consume this instead of the full `useInboxPrefs` context, so
 * they don't reach into swipe/AI/notification prefs they don't use.
 *
 * Native loads persisted prefs asynchronously; until the load resolves
 * (`loaded === false`) we return the comfortable defaults rather than risk a
 * one-frame flash of a persisted-but-not-yet-applied density. On web the
 * values load synchronously so `loaded` is always true.
 */

import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useInboxPrefs, type MessageDensity } from '@/contexts/inbox-prefs-context';

export interface InboxDisplayPrefs {
  density: MessageDensity;
  showAvatars: boolean;
  showPreviews: boolean;
  conversationView: boolean;
}

const DEFAULT_DISPLAY_PREFS: InboxDisplayPrefs = {
  density: 'comfortable',
  showAvatars: true,
  showPreviews: true,
  conversationView: true,
};

export function useInboxDisplayPrefs(): InboxDisplayPrefs {
  const { prefs, loaded } = useInboxPrefs();

  return useMemo(() => {
    if (Platform.OS !== 'web' && !loaded) {
      return DEFAULT_DISPLAY_PREFS;
    }
    return {
      density: prefs.density,
      showAvatars: prefs.showAvatars,
      showPreviews: prefs.showPreviews,
      conversationView: prefs.conversationView,
    };
  }, [prefs.density, prefs.showAvatars, prefs.showPreviews, prefs.conversationView, loaded]);
}
