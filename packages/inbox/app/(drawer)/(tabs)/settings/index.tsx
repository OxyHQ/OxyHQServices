/**
 * Settings landing screen.
 *
 * Mobile / native: a `SettingsListGroup`-based list of sections (with a
 * hero card at the top) that navigates into each subscreen.
 *
 * Desktop: the `_layout.tsx` renders a permanent sidebar (`SettingsNav`) +
 * a content pane. The bare `/settings` URL has no section selected, so we
 * redirect to the first reasonable default (Account when authenticated,
 * Appearance otherwise) so the content pane is never blank.
 */

import React from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { Redirect } from 'expo-router';
import Head from 'expo-router/head';
import { useOxy } from '@oxyhq/services';

import { SettingsLanding } from '@/components/settings/SettingsLanding';

const DESKTOP_BREAKPOINT = 900;

export default function SettingsIndex() {
  const { width } = useWindowDimensions();
  const { isAuthenticated } = useOxy();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;

  if (isDesktop) {
    return (
      <Redirect href={isAuthenticated ? '/settings/account' : '/settings/appearance'} />
    );
  }

  return (
    <>
      <Head>
        <title>Settings · Inbox · Oxy</title>
      </Head>
      <SettingsLanding />
    </>
  );
}
