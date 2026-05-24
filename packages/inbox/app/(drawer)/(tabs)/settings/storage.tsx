/**
 * /settings/storage — quota usage and local cache management.
 * Requires authentication; otherwise renders the standard `SettingsAuthGate`.
 */

import React from 'react';
import Head from 'expo-router/head';
import { useOxy } from '@oxyhq/services';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { SettingsAuthGate } from '@/components/settings/SettingsAuthGate';
import { StorageSection } from '@/components/settings/sections/StorageSection';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionDef,
} from '@/components/settings/sections-catalog';

function findSection(key: SettingsSectionDef['key']): SettingsSectionDef {
  const match = SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!match) throw new Error(`Unknown settings section: ${key}`);
  return match;
}

export default function StorageScreen() {
  const { isAuthenticated } = useOxy();
  const section = findSection('storage');

  return (
    <>
      <Head>
        <title>Storage · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Storage">
        {isAuthenticated ? (
          <StorageSection />
        ) : (
          <SettingsAuthGate sectionLabel={section.label} icon={section.icon} />
        )}
      </SettingsScreenShell>
    </>
  );
}
