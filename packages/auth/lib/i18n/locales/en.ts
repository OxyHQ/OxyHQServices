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

  authorize: {
    title: 'Continue to {{app}}',
    subtitle:
      'Use your Oxy account to sign in to {{app}}. Review what this connection means before you continue.',
    benefits: {
      title: 'What this means',
      secure: 'Sign in securely with your Oxy account — no new password needed',
      oneAccount: 'One account across every Oxy app',
      youControl: 'You choose what you share, and you can revoke access anytime',
    },
    provenance: {
      title: 'Who is requesting access',
      official: 'Official Oxy application',
      internal: 'Internal Oxy application',
      developer: 'Published by {{developer}}',
      thirdParty: 'Third-party application',
    },
    permissions: {
      title: 'Permissions requested',
      basic: 'Sign you in and read your basic profile',
    },
    continue: 'Continue to {{app}}',
    cancel: 'Cancel',
    notYou: 'Not you?',
    switchAccount: 'Use a different account',
    disclaimer:
      'By continuing, {{app}} will be able to sign in with your Oxy account. You can manage connected apps anytime in your Oxy account settings.',
    expiresAt: 'Request expires at {{time}}.',
    requestTitle: 'Authorization request',
    requestUnavailable: "We couldn't load the details of this request.",
    completeTitle: 'Authorization complete',
    deniedTitle: 'Authorization denied',
    completeChild: 'This window will close automatically.',
    completeDesc: 'You can close this window.',
    deniedDesc: 'The request was denied. You can close this window.',
    noRequestTitle: 'No authorization request',
    noRequestDesc:
      'Open the app you want to sign in to and try again. The authorization request starts there.',
    goToSignIn: 'Go to sign in',
  },
};

export default en;
