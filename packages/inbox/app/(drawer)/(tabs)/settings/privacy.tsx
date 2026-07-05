/**
 * /settings/privacy — tracking protection and sender trust defaults.
 * Requires authentication; otherwise renders the standard `SettingsAuthGate`.
 */

import React from 'react';
import Head from 'expo-router/head';
import { useOxy } from '@oxyhq/services';

import { SettingsAuthGate } from '@/components/settings/SettingsAuthGate';
import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { PrivacySection } from '@/components/settings/sections/PrivacySection';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionDef,
} from '@/components/settings/sections-catalog';

function findSection(key: SettingsSectionDef['key']): SettingsSectionDef {
  const match = SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!match) throw new Error(`Unknown settings section: ${key}`);
  return match;
}

export default function PrivacyScreen() {
  const { isAuthenticated } = useOxy();
  const section = findSection('privacy');

  return (
    <>
      <Head>
        <title>Privacy · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Privacy">
        {isAuthenticated ? (
          <PrivacySection />
        ) : (
          <SettingsAuthGate sectionLabel={section.label} icon={section.icon} />
        )}
      </SettingsScreenShell>
    </>
  );
}
