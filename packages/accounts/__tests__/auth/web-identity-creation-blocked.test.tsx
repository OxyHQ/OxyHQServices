import React from 'react';
import { render } from '@testing-library/react';
import CreateIdentityWebLayout from '@/app/(auth)/create-identity/_layout.web';
import ImportIdentityWebLayout from '@/app/(auth)/import-identity/_layout.web';
import WelcomeWebScreen from '@/app/(auth)/welcome.web';

/**
 * Web platform guards: identity CREATION must be impossible on web.
 *
 * Each of these route files SHADOWS its native counterpart on web (expo-router
 * resolves `*.web.tsx` over `*.tsx`). They must render nothing but a redirect
 * to the sign-in screen — the redirect fires at the layout level before any
 * child route (key generation, recovery-phrase reveal, import) can mount, so
 * no key material is ever created in a browser.
 *
 * The mocked `Redirect` (see `__mocks__/expo-router.tsx`) renders a
 * `<redirect href=...>` marker node; we read its `href` attribute from the DOM
 * to assert the redirect target.
 */
function redirectHref(container: HTMLElement): string | null {
  return container.querySelector('redirect')?.getAttribute('href') ?? null;
}

describe('web identity-creation guards', () => {
  it('create-identity layout redirects to sign-in on web (no key generation)', () => {
    const { container } = render(<CreateIdentityWebLayout />);
    expect(redirectHref(container)).toBe('/(auth)/sign-in');
  });

  it('import-identity layout redirects to sign-in on web (no key import)', () => {
    const { container } = render(<ImportIdentityWebLayout />);
    expect(redirectHref(container)).toBe('/(auth)/sign-in');
  });

  it('welcome (create-identity terms gate) redirects to sign-in on web', () => {
    const { container } = render(<WelcomeWebScreen />);
    expect(redirectHref(container)).toBe('/(auth)/sign-in');
  });
});
