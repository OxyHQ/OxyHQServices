/**
 * Dynamic route for label views — /label/<name>.
 *
 * Syncs the URL label name into the email store (Zustand) so `InboxList`
 * fetches messages filtered by the matching label.
 *
 * Desktop: shows empty detail pane (list lives in the layout).
 * Mobile: shows the inbox list filtered to the label.
 *
 * When the URL points to a label that doesn't exist (no match on
 * lowercased name), we surface the empty-detail component with a "not
 * found" page title rather than 404'ing — the user can pick another
 * label from the drawer.
 */

import React, { useEffect, useMemo } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';

import { InboxList } from '@/components/InboxList';
import { MessageDetailEmpty } from '@/components/MessageDetailEmpty';
import { useEmailStore } from '@/hooks/useEmail';
import { useLabels } from '@/hooks/queries/useLabels';
import { useMessages } from '@/hooks/queries/useMessages';

export default function LabelViewRoute() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const { name } = useLocalSearchParams<{ name: string }>();
  const { data: labels = [] } = useLabels();

  const selectLabel = useEmailStore((s) => s.selectLabel);

  const label = useMemo(() => {
    if (!name) return null;
    const target = name.toLowerCase();
    return labels.find((l) => l.name.toLowerCase() === target) ?? null;
  }, [name, labels]);

  // Fetch messages for the label so we can compute the unread count for the
  // page title; the list itself is rendered by `InboxList`, which reads the
  // same options from the store.
  const { data: messagesData } = useMessages({ label: label?.name });

  const viewLabel = useMemo(() => {
    if (label) return label.name;
    if (!name) return 'Label';
    return name.charAt(0).toUpperCase() + name.slice(1);
  }, [label, name]);

  const unreadCount = useMemo(() => {
    const messages = messagesData?.pages.flatMap((p) => p.data) ?? [];
    return messages.filter((m) => !m.flags?.seen).length;
  }, [messagesData]);

  const pageTitle = useMemo(() => {
    if (!label) return `Label not found · Oxy`;
    if (unreadCount > 0) return `(${unreadCount}) ${viewLabel} · Oxy`;
    return `${viewLabel} · Oxy`;
  }, [label, unreadCount, viewLabel]);

  // Sync URL → Zustand once we have a resolved label. While labels are still
  // loading we skip so we don't blow away another view's selection.
  useEffect(() => {
    if (!label) return;
    selectLabel(label._id, label.name);
  }, [label, selectLabel]);

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      {isDesktop ? <MessageDetailEmpty /> : <InboxList />}
    </>
  );
}
