import type { LocaleDict } from '../types';

/**
 * English (en-US) translation dictionary for the auth web app.
 *
 * Keys are namespaced by feature area. `signin.*`, `signup.*`, `recover.*`
 * etc. live in `@oxyhq/core` so they can be shared across web and native
 * surfaces; this dict only carries auth-app-specific strings (settings,
 * sessions, linked accounts, language picker, etc.).
 */
const en: LocaleDict = {
  common: {
    cancel: 'Cancel',
    save: 'Save',
    continue: 'Continue',
    back: 'Back',
    signOut: 'Sign out',
    delete: 'Delete',
    loading: 'Loading…',
    error: 'Error',
    success: 'Done',
  },

  app: {
    name: 'Oxy',
    title: 'Sign in · Oxy',
  },

  language: {
    picker: {
      label: 'Language',
      ariaLabel: 'Choose language',
    },
  },

  footer: {
    terms: 'Terms',
    privacy: 'Privacy',
    help: 'Help',
    copyright: '© {{year}} Oxy',
  },

  settings: {
    title: 'Account settings',
    sections: {
      password: 'Password',
      sessions: 'Sessions',
      linkedAccounts: 'Linked accounts',
      language: 'Language',
    },
    password: {
      title: 'Change password',
      currentLabel: 'Current password',
      newLabel: 'New password',
      confirmLabel: 'Confirm new password',
      submit: 'Change password',
      success: 'Password changed.',
      error: 'Could not change password.',
    },
    sessions: {
      title: 'Active sessions',
      subtitle: 'Devices currently signed in to your account.',
      currentBadge: 'This device',
      revoke: 'Sign out',
      revokeAll: 'Sign out everywhere else',
      revokedToast: 'Session ended.',
      empty: 'No other active sessions.',
    },
    linkedAccounts: {
      title: 'Linked accounts',
      subtitle: 'Third-party providers connected to your Oxy account.',
      link: 'Link',
      unlink: 'Unlink',
      none: 'No linked accounts.',
    },
  },

  fedcm: {
    status: {
      signedInAs: 'Signed in as {{name}}',
      signedOut: 'Signed out',
    },
  },
};

export default en;
