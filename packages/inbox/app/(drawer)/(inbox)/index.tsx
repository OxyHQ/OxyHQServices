/**
 * Index route for the (inbox) group.
 *
 * Desktop: rendered in the Slot (right pane) — shows empty state.
 * Mobile: rendered as the main screen — shows the inbox list.
 */

import React from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { InboxList } from '@/components/InboxList';
import { MessageDetailEmpty } from '@/components/MessageDetailEmpty';

export default function InboxIndex() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;

  if (isDesktop) {
    return <MessageDetailEmpty />;
  }

  return <InboxList />;
}
