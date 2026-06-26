/**
 * Lightweight `expo-router` stub for component tests in the accounts package.
 *
 * `Redirect` renders a marker element carrying its `href` so tests can assert
 * *where* a guard redirects without standing up the real router runtime.
 * `useRouter`/`usePathname` return inert defaults for screens that read them.
 */
import React from 'react';

export interface RedirectProps {
  href: string;
}

export function Redirect({ href }: RedirectProps): React.ReactElement {
  return React.createElement('Redirect', { href, testID: 'redirect' });
}

export interface MockRouter {
  push: jest.Mock;
  replace: jest.Mock;
  back: jest.Mock;
  navigate: jest.Mock;
}

const router: MockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
};

export function useRouter(): MockRouter {
  return router;
}

export function usePathname(): string {
  return '/';
}

export function __getMockRouter(): MockRouter {
  return router;
}
