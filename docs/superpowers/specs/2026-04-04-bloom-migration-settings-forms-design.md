# Bloom Migration: Settings & Forms Components

## Context

@oxyhq/services has ~60 custom UI components, many of which duplicate functionality already available in @oxyhq/bloom. This creates inconsistent styling, double maintenance, and prevents the Oxy ecosystem from having a unified design system.

This is Phase 1 of a full migration. It focuses on settings and form components because:
- 4 screens already use Bloom's `SettingsListGroup`/`SettingsListItem`
- The remaining settings screens use custom equivalents (`GroupedSection`, `GroupedItem`, `SettingRow`, `Section`)
- Unifying these gives immediate visual consistency across all settings screens

## Component Mapping

| Services component | Bloom replacement | Notes |
|---|---|---|
| `GroupedSection` | `SettingsListGroup` | Direct replacement. Both wrap children in a grouped container with optional header. |
| `GroupedItem` | `SettingsListItem` | Direct replacement. Map `iconName` → Bloom icon prop, `onPress` → `onPress`, `selected` → check state. |
| `SettingRow` | `SettingsListItem` | Map `label` → title text, `value` → trailing content, toggle → Bloom `Switch` as trailing element. |
| `Section` / `SectionTitle` | `SettingsListGroup` with `label` prop | Section wraps content with optional title. SettingsListGroup already supports this via its `label` prop. |
| `GroupedPillButtons` | `SegmentedControl` from `@oxyhq/bloom/segmented-control` | Different API: map items array to SegmentedControl options, `onSelect` → `onSelect`. |

## Screens to Update

### Already on Bloom (reference patterns):
- `AppInfoScreen.tsx` — imports `SettingsListGroup, SettingsListItem` from `@oxyhq/bloom/settings-list`
- `AccountCenterScreen.tsx` — same
- `HelpSupportScreen.tsx` — same

### Need migration (GroupedSection):
1. `AccountOverviewScreen.tsx` — mixed (already has Bloom imports + old GroupedSection/GroupedItem)
2. `FeedbackScreen.tsx` — uses GroupedSection
3. `SessionManagementScreen.tsx` — uses GroupedSection
4. `HistoryViewScreen.tsx` — uses Section + GroupedSection
5. `UserLinksScreen.tsx` — uses GroupedSection
6. `FileManagementScreen.tsx` — uses GroupedSection
7. `LanguageSelectorScreen.tsx` — uses GroupedSection
8. `LegalDocumentsScreen.tsx` — uses Section + GroupedSection
9. `AccountSwitcherScreen.tsx` — uses GroupedSection
10. `SavesCollectionsScreen.tsx` — uses Section + GroupedSection
11. `AccountVerificationScreen.tsx` — uses Section

### Need migration (SettingRow → SettingsListItem):
12. `SearchSettingsScreen.tsx` — uses Section + SettingRow
13. `PrivacySettingsScreen.tsx` — uses Section + SettingRow + GroupedSection

### Need migration (GroupedPillButtons → SegmentedControl):
14. `WelcomeNewUserScreen.tsx` — uses GroupedPillButtons
15. `PaymentGatewayScreen.tsx` — uses GroupedPillButtons

## Migration Steps (per screen)

1. Replace import from `../components/GroupedSection` → `import { SettingsListGroup } from '@oxyhq/bloom/settings-list'`
2. Replace import from `../components/GroupedItem` → `import { SettingsListItem } from '@oxyhq/bloom/settings-list'`
3. Replace import from `../components/SettingRow` → `import { SettingsListItem } from '@oxyhq/bloom/settings-list'` + `import { Switch } from '@oxyhq/bloom/switch'` (for toggle rows)
4. Replace import from `../components/Section` → `import { SettingsListGroup } from '@oxyhq/bloom/settings-list'`
5. Replace import from `../components/internal/GroupedPillButtons` → `import { SegmentedControl } from '@oxyhq/bloom/segmented-control'`
6. Update JSX: map old component props to Bloom component props
7. Remove any StyleSheet references that were only used for the replaced components

## Cleanup After All Screens Migrated

Delete from `packages/services/src/ui/components/`:
- `GroupedItem.tsx`
- `GroupedSection.tsx`
- `SettingRow.tsx`
- `Section.tsx`
- `SectionTitle.tsx`
- `internal/GroupedPillButtons.tsx`

Remove from:
- `packages/services/src/ui/components/index.ts` (barrel export)
- `packages/services/src/index.ts` (if any are publicly exported)

## Files to Reference

### Bloom components (read for API/props):
- `/home/nate/Bloom/src/settings-list/SettingsList.tsx` — SettingsListGroup, SettingsListItem, SettingsListDivider
- `/home/nate/Bloom/src/segmented-control/index.tsx` — SegmentedControl
- `/home/nate/Bloom/src/switch/index.tsx` — Switch (for toggle rows)

### Services components being replaced (read for current behavior):
- `/home/nate/OxyHQServices/packages/services/src/ui/components/GroupedItem.tsx`
- `/home/nate/OxyHQServices/packages/services/src/ui/components/GroupedSection.tsx`
- `/home/nate/OxyHQServices/packages/services/src/ui/components/SettingRow.tsx`
- `/home/nate/OxyHQServices/packages/services/src/ui/components/Section.tsx`
- `/home/nate/OxyHQServices/packages/services/src/ui/components/SectionTitle.tsx`
- `/home/nate/OxyHQServices/packages/services/src/ui/components/internal/GroupedPillButtons.tsx`

### Screens already using Bloom (reference patterns):
- `/home/nate/OxyHQServices/packages/services/src/ui/screens/AppInfoScreen.tsx`
- `/home/nate/OxyHQServices/packages/services/src/ui/screens/AccountCenterScreen.tsx`

## Verification

1. Build @oxyhq/services: `cd ~/OxyHQServices/packages/services && bun run build`
2. Check no remaining imports of deleted components: `grep -r "GroupedItem\|GroupedSection\|SettingRow\|SectionTitle" packages/services/src/`
3. Verify consuming apps (Mention, Allo, Homiio) still build after the services package update
4. Visual check: settings screens should look consistent with the screens already on Bloom
