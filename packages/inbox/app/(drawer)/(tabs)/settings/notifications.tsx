/**
 * /settings/notifications — push, digest, and sound preferences.
 * Requires authentication; otherwise renders the standard `SettingsAuthGate`.
 */

import React from 'react';
import Head from 'expo-router/head';
import { useOxy } from '@oxyhq/services';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { SettingsAuthGate } from '@/components/settings/SettingsAuthGate';
import { NotificationsSection } from '@/components/settings/sections/NotificationsSection';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionDef,
} from '@/components/settings/sections-catalog';

function findSection(key: SettingsSectionDef['key']): SettingsSectionDef {
  const match = SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!match) throw new Error(`Unknown settings section: ${key}`);
  return match;
}

export default function NotificationsScreen() {
  const { isAuthenticated } = useOxy();
  const section = findSection('notifications');

  return (
    <>
      <Head>
        <title>Notifications · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Notifications">
        {isAuthenticated ? (
          <NotificationsSection />
        ) : (
          <SettingsAuthGate sectionLabel={section.label} icon={section.icon} />
        )}
      </SettingsScreenShell>
    </>
  );
}
