/**
 * Conversation (message detail) route — /conversation/:id
 *
 * Desktop: rendered in Slot (right pane of split-view), embedded mode.
 * Mobile: pushed onto Stack, standalone mode with back button.
 */

import React, { useEffect } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { MessageDetail } from '@/components/MessageDetail';
import { useEmailStore } from '@/hooks/useEmail';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;

  // Sync selected message ID for list highlighting
  useEffect(() => {
    if (id) {
      useEmailStore.setState({ selectedMessageId: id });
    }
    return () => {
      useEmailStore.setState({ selectedMessageId: null });
    };
  }, [id]);

  if (!id) return null;

  return <MessageDetail mode={isDesktop ? 'embedded' : 'standalone'} messageId={id} />;
}
