/**
 * Index route for the (search) group.
 *
 * Desktop: rendered in the Slot (right pane) — shows empty state.
 * Mobile: rendered as the main screen — shows the search list.
 */

import React from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { SearchList } from '@/components/SearchList';
import { MessageDetailEmpty } from '@/components/MessageDetailEmpty';

export default function SearchIndex() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;

  if (isDesktop) {
    return <MessageDetailEmpty />;
  }

  return <SearchList />;
}
