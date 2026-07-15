import type { ReactNode } from 'react';
import type { OxyServices, User, SessionLoginResponse, AccountNode, CreateAccountInput, ClientSession, AccountDialogController, AccountDialogView, ApiError, SessionClient } from '@oxyhq/core';
import type { SecurityAlert } from '@oxyhq/contracts';
import type { UseFollowHook } from '../hooks/useFollow.types';
import type { useLanguageManagement } from '../hooks/useLanguageManagement';
import type { RouteName } from '../navigation/routes';

export interface OxyContextState {
  user: User | null;
  sessions: ClientSession[];
  activeSessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isTokenReady: boolean;
  hasAccessToken: boolean;
  canUsePrivateApi: boolean;
  isPrivateApiPending: boolean;
  /**
   * Whether the initial auth determination has concluded.
   *
   * `false` from mount until the FIRST device-first cold boot resolves —
   * during that window `isAuthenticated: false` is UNDETERMINED, not a
   * definitive "logged out". Flips to `true` exactly once the boot concludes
   * (a session was committed OR none exists) and never reverts. Consumers should
   * defer their first auth-dependent fetch until this is `true` so a cold-boot
   * web reload with an existing session does not fetch anonymous data.
   */
  isAuthResolved: boolean;
  isStorageReady: boolean;
  error: string | null;
  /** Active UI locale (`language-REGION`): the account's primary locale when signed in, else the guest/device locale. */
  currentLanguage: string;
  /** Ordered account locales (primary first) when signed in, or the single guest override when signed out. */
  currentLanguages: string[];
  currentLanguageMetadata: ReturnType<typeof useLanguageManagement>['metadata'];
  currentLanguageName: string;
  currentNativeLanguageName: string;

  hasIdentity: () => Promise<boolean>;
  getPublicKey: () => Promise<string | null>;

  signIn: (publicKey: string, deviceName?: string) => Promise<User>;

  signInWithPassword: (
    identifier: string,
    password: string,
    opts?: { deviceName?: string; deviceFingerprint?: string },
  ) => Promise<PasswordSignInResult>;

  completeTwoFactorSignIn: (params: {
    loginToken: string;
    token?: string;
    backupCode?: string;
    deviceName?: string;
  }) => Promise<{ securityAlert?: SecurityAlert }>;

  /**
   * Sign in with a passkey (WebAuthn). With no `username` this is the
   * usernameless / discoverable-credential flow: the browser prompts for any
   * resident Oxy passkey. Pass `username` for the username-first flow — the
   * server scopes `allowCredentials` to that user's passkeys so a
   * NON-discoverable hardware key (e.g. a U2F/security key) can be used.
   * WEB-ONLY — throws on native or an unsupported browser (native passkeys are
   * Commons' job). On `useOxy()`, NOT re-exposed on `useAuth()`.
   */
  signInWithPasskey: (opts?: {
    username?: string;
    deviceName?: string;
    deviceFingerprint?: string;
  }) => Promise<void>;

  /**
   * Create a brand-new account whose first authentication method is a passkey.
   * WEB-ONLY — throws on native or an unsupported browser.
   */
  registerWithPasskey: (params: { username: string; deviceName?: string }) => Promise<void>;

  /**
   * Add a passkey to the already-signed-in account (bearer present). Does NOT
   * commit a new session; refreshes the linked auth-methods list on success.
   * WEB-ONLY — throws on native or an unsupported browser.
   */
  addPasskey: (params?: { deviceName?: string }) => Promise<void>;

  /**
   * Remove a passkey from the current account by its credential id
   * (`AuthMethodEntry.credentialId`). Refreshes the linked auth-methods list on
   * success. Works on any platform (it is a plain unlink, not a WebAuthn
   * ceremony) but is only reachable from surfaces that list passkeys.
   */
  removePasskey: (credentialId: string) => Promise<void>;

  revokeSuspiciousSignIn: () => Promise<void>;
  handleWebSession: (session: SessionLoginResponse) => Promise<void>;

  logout: (targetSessionId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<User>;
  removeSession: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  setLanguage: (languageId: string) => Promise<void>;
  getDeviceSessions: () => Promise<
    Array<{
      sessionId: string;
      deviceId: string;
      deviceName?: string;
      lastActive?: string;
      expiresAt?: string;
    }>
  >;
  logoutAllDeviceSessions: () => Promise<void>;
  updateDeviceName: (deviceName: string) => Promise<void>;
  clearSessionState: () => Promise<void>;
  clearAllAccountData: () => Promise<void>;
  storageKeyPrefix: string;
  clientId: string | null;
  oxyServices: OxyServices;
  /** Server-authoritative device session client. `null` before an `OxyProvider` is mounted. */
  sessionClient: SessionClient | null;
  useFollow?: UseFollowHook;
  showBottomSheet?: (screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> }) => void;
  openAvatarPicker: () => void;

  accountDialogController: AccountDialogController | null;
  isAccountDialogOpen: boolean;
  openAccountDialog: (view?: AccountDialogView) => void;
  closeAccountDialog: () => void;

  accounts: AccountNode[];
  switchToAccount: (accountId: string) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  createAccount: (data: CreateAccountInput) => Promise<AccountNode>;
}

/**
 * Result of {@link OxyContextState.signInWithPassword}.
 */
export type PasswordSignInResult =
  | { status: 'ok'; securityAlert?: SecurityAlert }
  | { status: '2fa_required'; loginToken: string };

export interface OxyContextProviderProps {
  children: ReactNode;
  oxyServices?: OxyServices;
  baseURL?: string;
  authWebUrl?: string;
  authRedirectUri?: string;
  /**
   * Authorize endpoint override for silent cross-origin session restore
   * (web cross-app SSO). Defaults to the production Oxy IdP when unset; a
   * local/staging deployment points it at its own IdP so cold boot never
   * bounces the tab to production `auth.oxy.so`.
   */
  authorizeBaseUrl?: string;
  storageKeyPrefix?: string;
  clientId?: string;
  /** Sync device credentials to auth.oxy.so after interactive sign-in. @default true */
  hubSync?: boolean;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: ApiError) => void;
}

/** Internal commit input — session plus zero-cookie device credential. */
export interface CommitInput {
  sessionId: string;
  accessToken?: string;
  deviceId?: string;
  deviceSecret?: string;
  expiresAt?: string;
  userId?: string;
  user?: { id: string; username?: string; avatar?: string };
}
