# Oxy Accounts

Expo app for managing your Oxy identity. The equivalent of Google MyAccount — settings, security, sessions, payments, privacy.

## Development

```bash
cd packages/accounts
bun install
bun run start        # Expo dev server
bun run ios          # iOS simulator
bun run android      # Android emulator
bun run web          # Web (Vite)
bun run test         # Jest (216 tests)
bun run typecheck    # tsc --noEmit
```

## Architecture

- **Router**: `expo-router` v3 with `typedRoutes: true` — all `router.push()` calls must use typed path strings, no `as any`.
- **Auth SDK**: `@oxyhq/services` (RN) + `@oxyhq/core` (types, KeyManager)
- **UI**: `@oxyhq/bloom` component library; BloomThemeProvider sets Inter globally — do NOT set `fontFamily: 'Inter-*'` manually.
- **i18n**: `LocaleProvider` + `useTranslation` in `lib/i18n/`; 11 locales; device locale via `Intl.DateTimeFormat()` (no `expo-localization` needed).

## Web vs Native Split

Identity **creation** is native-only. Web is for managing an existing account (sign-in only).

- Web sign-in screen: `app/(auth)/sign-in.tsx` — uses `signInWithFedCM()` + `handleWebSession()`.
- Web blocks identity creation via `.web.tsx` layout redirects: `app/(auth)/create-identity/_layout.web.tsx`, `import-identity/_layout.web.tsx`, `welcome.web.tsx`, `index.web.tsx` — all redirect to `/(auth)/sign-in`.
- `useOnboardingStatus.needsAuth` is platform-agnostic — do NOT add a `Platform.OS === 'web'` clamp (causes redirect deadlock).

## Key Routes

```
app/
  (auth)/
    index.tsx             — auth router (complete→tabs, in_progress→create-identity, checking→blank)
    sign-in.tsx           — web sign-in via FedCM / popup
    create-identity/      — native-only identity creation flow
    import-identity/      — native-only identity import flow
    welcome.tsx           — native onboarding welcome
  (tabs)/
    index.tsx             — home / account overview
    security.tsx          — sessions, devices, 2FA, recovery phrase
    activity.tsx          — security activity (infinite scroll, GET /security/activity)
    payments.tsx          — subscription, wallet, transactions (reads `timestamp` field)
    privacy.tsx           — privacy settings
    settings.tsx          — app settings, locale
```

## Shared Modules (use these, don't duplicate)

| Module | Purpose |
|--------|---------|
| `utils/relative-time.ts` + `hooks/useRelativeTime.ts` | i18n-aware relative timestamps |
| `utils/device-utils.ts` | `getDeviceIcon`, `getDeviceDisplayName`, `DeviceRecord`, `groupDevicesByType` |
| `hooks/useAvatarUrl.ts` | Avatar URL with fallback |
| `hooks/useDebounce.ts` | Debounce hook |
| `constants/payments.ts` | `FAIRCOIN_WALLET_URL` and other payment constants |
| `constants/drawer-screens.ts` | Typed `DrawerScreenConfig[]` — data-drives 18 Drawer.Screen in `_layout` |
| `lib/account/delete-account-flow.ts` | Safe account deletion (deleteAccount → purgeIdentity → signOutAll) |
| `hooks/identity/useIdentitySync.ts` | Identity auto-sync (byte-identical semantics) |

## Delete Account Flow

Strict order enforced in `lib/account/delete-account-flow.ts`:
1. `oxyServices.deleteAccount(...)` — signed deletion with username confirmation
2. On SUCCESS ONLY: `KeyManager.deleteIdentity(skipBackup=true, force=true, userConfirmed=true)` — purges primary AND backup to prevent zombie identity auto-restore
3. `signOutAll()`
Local-purge failure is non-fatal (logged, not thrown).

## Routing Invariants

- **`(auth)/index.tsx`**: `status === 'complete'` → `/(tabs)`; `hasIdentity && status === 'in_progress'` → `/(auth)/create-identity`; blank backdrop during `status === 'checking'`. Always clean up timers.
- **`useOnboardingStatus`**: when `isAuthenticated && user`, status is always `'complete'` or `'in_progress'`, never stale. Re-checks `KeyManager.hasIdentity()` on `isAuthenticated` transitions.

## Error Boundaries

Error boundaries at root, `(tabs)`, and `(auth)` layout levels using `ErrorFallback` component.

## expo-router v56 Notes

- No `@react-navigation/*` direct imports.
- Synthesize `{ type: 'OPEN_DRAWER' }` drawer payloads inline.
- `constants/drawer-screens.ts` must live in `constants/`, not `app/` — otherwise expo-router registers it as a route.
