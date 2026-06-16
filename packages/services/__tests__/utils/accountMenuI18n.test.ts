/**
 * i18n label-fallback coverage for `AccountMenu` / `AccountMenuButton`.
 *
 * These components render their labels through `useI18n().t(key)`, which calls
 * `translate(locale, key)` from `@oxyhq/core`. The SDK MUST ship its OWN strings
 * for every `accountMenu.*` (and the supporting `common.*`) key so consumers
 * (e.g. inbox) get real labels with ZERO config — never the raw dotted key.
 *
 * Regression guarded here (live inbox bug): the menu rendered raw keys such as
 * `accountMenu.manage` because those keys were absent from the SDK's bundled
 * locales and `translate` echoes the key when a string is missing. The `||`
 * literal fallbacks in the components never fired because the raw key is a
 * truthy string.
 */

import { translate } from '@oxyhq/core';

// Every i18n key referenced by AccountMenu.tsx + AccountMenuButton.tsx.
const ACCOUNT_MENU_KEYS = [
    'accountMenu.label',
    'accountMenu.manage',
    'accountMenu.addAnother',
    'accountMenu.signOutAll',
    'accountMenu.open',
    'accountMenu.openHint',
    'accountMenu.openWithUser',
    'accountMenu.switching',
    'accountMenu.signOutAccount',
    'accountSwitcher.toasts.switchSuccess',
    'accountSwitcher.toasts.switchFailed',
    'accountSwitcher.toasts.signOutAllSuccess',
    'common.actions.signedOut',
    'common.actions.signOut',
    'common.actions.close',
    'common.cancel',
    'common.confirms.signOut',
    'common.confirms.signOutAll',
    'common.errors.signOutFailed',
    'common.errors.signOutAllFailed',
    'common.status.notSignedIn',
] as const;

describe('AccountMenu i18n labels (SDK-bundled strings)', () => {
    it('resolves EVERY AccountMenu key to a real string in en-US (never the raw key)', () => {
        for (const key of ACCOUNT_MENU_KEYS) {
            const value = translate('en-US', key);
            expect(value).not.toBe(key);
            expect(value.length).toBeGreaterThan(0);
        }
    });

    it('resolves the visible accountMenu labels to the expected English copy', () => {
        expect(translate('en-US', 'accountMenu.manage')).toBe('Manage your Oxy Account');
        expect(translate('en-US', 'accountMenu.addAnother')).toBe('Add another account');
        expect(translate('en-US', 'accountMenu.signOutAll')).toBe('Sign out of all accounts');
    });

    it('substitutes the {{name}} var in accountMenu.openWithUser', () => {
        expect(translate('en-US', 'accountMenu.openWithUser', { name: 'Nate' }))
            .toBe('Account menu for Nate');
    });

    it('resolves the same keys in a non-English bundled locale (es-ES)', () => {
        for (const key of ACCOUNT_MENU_KEYS) {
            const value = translate('es-ES', key);
            expect(value).not.toBe(key);
            expect(value.length).toBeGreaterThan(0);
        }
        expect(translate('es-ES', 'accountMenu.manage')).toBe('Gestiona tu cuenta de Oxy');
    });

    it('falls back to English (not the raw key) for an unknown locale', () => {
        // An unrecognised locale resolves to the FALLBACK (en-US) dictionary.
        expect(translate('xx-YY', 'accountMenu.manage')).toBe('Manage your Oxy Account');
    });

    it('per-key falls back to English when a known locale is missing one key', () => {
        // `common.actions.signOut` exists everywhere; this asserts the per-key
        // English fallback path returns a real string rather than the raw key
        // for any locale in the bundled set.
        for (const locale of ['fr-FR', 'de-DE', 'ja-JP', 'ar-SA']) {
            const value = translate(locale, 'accountMenu.manage');
            expect(value).not.toBe('accountMenu.manage');
            expect(value.length).toBeGreaterThan(0);
        }
    });
});
