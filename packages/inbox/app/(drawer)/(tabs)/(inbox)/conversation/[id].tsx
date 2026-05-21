/**
 * Conversation (message detail) route — /conversation/:id
 *
 * Desktop: rendered in Slot (right pane of split-view), embedded mode.
 * Mobile: pushed onto Stack, standalone mode with back button.
 */

import React, { useEffect } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';

import { MessageDetail } from '@/components/MessageDetail';
import { useEmailStore } from '@/hooks/useEmail';
import { useThread } from '@/hooks/queries/useThread';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;

  const { data: thread } = useThread(id);
  const subject = thread?.[0]?.subject;
  const pageTitle = subject ? `${subject} · Oxy` : 'Message · Inbox · Oxy';

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

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <MessageDetail mode={isDesktop ? 'embedded' : 'standalone'} messageId={id} />
    </>
  );
}
