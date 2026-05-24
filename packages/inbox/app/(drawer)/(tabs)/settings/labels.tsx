/**
 * /settings/labels — manage custom labels.
 * Requires authentication; otherwise renders the standard `SettingsAuthGate`.
 */

import React from 'react';
import Head from 'expo-router/head';
import { useOxy } from '@oxyhq/services';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { SettingsAuthGate } from '@/components/settings/SettingsAuthGate';
import { LabelsSection } from '@/components/settings/sections/LabelsSection';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionDef,
} from '@/components/settings/sections-catalog';

function findSection(key: SettingsSectionDef['key']): SettingsSectionDef {
  const match = SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!match) throw new Error(`Unknown settings section: ${key}`);
  return match;
}

export default function LabelsScreen() {
  const { isAuthenticated } = useOxy();
  const section = findSection('labels');

  return (
    <>
      <Head>
        <title>Labels · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Labels">
        {isAuthenticated ? (
          <LabelsSection />
        ) : (
          <SettingsAuthGate sectionLabel={section.label} icon={section.icon} />
        )}
      </SettingsScreenShell>
    </>
  );
}
