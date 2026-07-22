import type { ReactNode } from 'react';
import type { AccountDialogView, FileMetadata } from '@oxyhq/core';
import type { RouteName } from './routes';
import type { AvatarCropResult } from '../screens/AvatarCropScreen';

/**
 * The SDK's typed surface registry — the contract layer the SDK stacks on top of
 * Bloom's content-agnostic surface stack (`@oxyhq/bloom/surfaces`). One entry per
 * route describing its `props` (what the presenter must pass) and its `result`
 * (what awaiting `present()` resolves with). Hand-maintained, contract-first:
 * adding a route here is the single edit that types it end to end.
 *
 * For P1 most routes keep permissive `Record<string, unknown>` props + a `void`
 * result — the historical grab-bag `showBottomSheet`/`navigate` props are
 * unchanged. Later phases tighten individual routes without changing this shape.
 */

/** One registry entry: the props a route is presented with + its dismissal result. */
type SurfaceRoute<Props = Record<string, unknown>, Result = void> = {
  props: Props;
  result: Result;
};

export interface SurfaceRegistry {
  ManageAccount: SurfaceRoute;
  AccountVerification: SurfaceRoute;
  PaymentGateway: SurfaceRoute;
  Profile: SurfaceRoute;
  LanguageSelector: SurfaceRoute;
  PrivacySettings: SurfaceRoute;
  SearchSettings: SurfaceRoute;
  /**
   * File picker / manager. In single-select picker mode the surface is
   * dismissed with the picked {@link FileMetadata} (the avatar-picker promise
   * flow); legacy callers that pass an `onSelect`/`onConfirmSelection` callback
   * keep their callback behaviour and this result goes unread.
   */
  FileManagement: SurfaceRoute<Record<string, unknown>, FileMetadata>;
  HelpSupport: SurfaceRoute;
  FAQ: SurfaceRoute;
  Feedback: SurfaceRoute;
  LegalDocuments: SurfaceRoute;
  AppInfo: SurfaceRoute;
  PremiumSubscription: SurfaceRoute;
  WelcomeNewUser: SurfaceRoute;
  UserLinks: SurfaceRoute;
  HistoryView: SurfaceRoute;
  SavesCollections: SurfaceRoute;
  EditProfile: SurfaceRoute;
  EditProfileField: SurfaceRoute;
  LearnMoreUsernames: SurfaceRoute;
  TrustCenter: SurfaceRoute;
  TrustLeaderboard: SurfaceRoute;
  TrustRewards: SurfaceRoute;
  TrustRules: SurfaceRoute;
  AboutTrust: SurfaceRoute;
  TrustFAQ: SurfaceRoute;
  FollowersList: SurfaceRoute;
  FollowingList: SurfaceRoute;
  CreateAccount: SurfaceRoute;
  AccountMembers: SurfaceRoute;
  AccountSettings: SurfaceRoute;
  /** Square-crop editor. Dismissed with the cropped {@link AvatarCropResult}. */
  AvatarCrop: SurfaceRoute<Record<string, unknown>, AvatarCropResult>;
  Notifications: SurfaceRoute;
  ConnectedApps: SurfaceRoute;
  Preferences: SurfaceRoute;
  /** Unified account switcher + sign-in surface (folded `OxyAccountDialogScreen` body). */
  AccountDialog: SurfaceRoute<{ initialView?: AccountDialogView }>;
}

/**
 * Compile-time guard: the registry keys must be EXACTLY the route names. If a new
 * `RouteName` is added without a registry entry (or vice-versa) this alias
 * resolves to `never` and the `satisfies` assertion below fails to type-check.
 */
type RegistryCoversRoutes = [RouteName] extends [keyof SurfaceRegistry]
  ? [keyof SurfaceRegistry] extends [RouteName]
    ? true
    : never
  : never;
const _registryCoversRoutes: RegistryCoversRoutes = true;
void _registryCoversRoutes;

/** Typed props a route is presented with. */
export type SurfaceProps<K extends RouteName> = SurfaceRegistry[K]['props'];
/** What awaiting a route's `present()` resolves with when it is dismissed. */
export type SurfaceResult<K extends RouteName> = SurfaceRegistry[K]['result'];

/**
 * How a surface renders — the SDK's presentation taxonomy. Each value maps to a
 * concrete Bloom `Dialog` placement/chrome in `surfaces.ts`:
 *
 *   - `'sheet'`      → responsive `{ base: 'bottom', md: 'center' }` (the default:
 *                      a bottom sheet on narrow viewports, a centered card on wide).
 *   - `'center'`     → a plain centered modal at every width.
 *   - `'drawer'`     → responsive `{ base: 'bottom', md: 'left' }` side drawer.
 *   - `'fullScreen'` → approximated with the shared `Dialog`: a full-height sheet /
 *                      large centered card, flush (`contentPadding: 0`) content, a
 *                      black canvas and programmatic-only dismiss (the flagship
 *                      image picker). A real Bloom `'fullScreen'` placement is a
 *                      follow-up if the approximation reads wrong on device.
 */
export type SurfacePresentation = 'sheet' | 'center' | 'drawer' | 'fullScreen';

/**
 * Per-route surface configuration. Merges the historical `SheetRouteConfig`
 * knobs with the new {@link SurfacePresentation}.
 *
 * NOTE: `scrollable` is LIVE — it is threaded through `bloomOptionsFor` onto the
 * Bloom `Dialog` surface (`scrollable` prop), so a route that owns its own scroll
 * container opts OUT of the Dialog's internal ScrollView. `manualActivation` /
 * `dynamicBackdrop` / `handleComponent` remain informational — reserved for a
 * future Bloom bottom-placement passthrough; the shared `DialogBottomSheet`
 * currently owns pan coordination itself.
 */
export interface SurfaceRouteConfig {
  /** Which surface hosts the route. */
  presentation: SurfacePresentation;
  /**
   * When `false`, the route owns its own scroll container (a FlatList /
   * SectionList / VirtualizedList, or its own ScrollView) and the host must not
   * wrap it in a ScrollView. Threaded onto Bloom's `Dialog` via `bloomOptionsFor`.
   */
  scrollable: boolean;
  /**
   * Whether the surface renders the Dialog's OWN navigation header (sticky
   * gradient nav bar + large collapsing title over the surface's scroll content).
   * `true` for every route screen — screens render NO header of their own and
   * declare their title/subtitle (+ any action slot) via `useSurfaceHeader`.
   * `false` for surfaces with their own chrome (the account dialog, the flagship
   * full-bleed image picker).
   */
  header: boolean;
  /** Body-pan activation strategy — reserved (owned by Bloom's Dialog surface). */
  manualActivation: boolean;
  /** Drag-proportional backdrop dim — reserved (owned by Bloom's Dialog surface). */
  dynamicBackdrop: boolean;
  /** Optional custom drag-handle slot — reserved (owned by Bloom's Dialog surface). */
  handleComponent?: () => ReactNode;
}

/** Defaults shared across all routes — the canonical responsive "sheet". */
const DEFAULT_SURFACE_CONFIG: SurfaceRouteConfig = {
  presentation: 'sheet',
  scrollable: true,
  header: true,
  manualActivation: true,
  dynamicBackdrop: true,
};

/**
 * Routes that render NO Dialog nav header — they own their chrome:
 * - `AvatarCrop` — its own translucent Cancel / title / Done top bar.
 * - `PaymentGateway` — the payment surface owns its controls.
 * - `WelcomeNewUser` — a full-bleed onboarding wizard with its own step chrome.
 * - `Profile` — a full profile view, no nav-header chrome.
 * (The flagship full-bleed image picker is handled separately below.)
 *
 * `AccountDialog` used to be here — it now uses the SHARED Dialog nav header like
 * every other screen (its per-view title/subtitle + view-back go through
 * `useSurfaceHeader`), so the account/sign-in surface no longer feels bespoke.
 */
const HEADERLESS_ROUTES: ReadonlySet<RouteName> = new Set<RouteName>([
  'AvatarCrop',
  'PaymentGateway',
  'WelcomeNewUser',
  'Profile',
]);

/**
 * Predicate matching `FileManagementScreen`'s internal `isImageOnlyPicker`
 * derivation. When the consumer restricts to image MIME types (no videos, no
 * audio, no documents), FileManagement renders the flagship `PhotoPickerView`,
 * which owns its own FlatList and reads best as a full-bleed picker. Kept in sync
 * with `FileManagementScreen` — both check the same disabled MIME type families.
 */
const isFileManagementImageOnlyPicker = (props: Record<string, unknown>): boolean => {
  if (!props.selectMode) return false;
  const disabled = props.disabledMimeTypes;
  if (!Array.isArray(disabled) || disabled.length === 0) return false;
  const has = (predicate: (mt: string) => boolean): boolean =>
    disabled.some((mt) => typeof mt === 'string' && predicate(mt));
  const blocksVideos = has((mt) => mt === 'video/' || mt.startsWith('video/'));
  const blocksAudio = has((mt) => mt === 'audio/' || mt.startsWith('audio/'));
  const blocksDocs = has(
    (mt) => mt === 'application/pdf' || mt === 'application/' || mt.startsWith('application/'),
  );
  return blocksVideos && blocksAudio && blocksDocs;
};

/**
 * Routes whose screen owns its OWN scroll container — a FlatList /
 * VirtualizedList (`ConnectedApps`, `TrustLeaderboard`, `FollowersList` /
 * `FollowingList` via `UserListScreen`) or its own vertical `ScrollView`
 * (`FileManagement`). These MUST opt out of the Dialog's internal ScrollView
 * (`scrollable: false`) so there is exactly ONE scroll container — otherwise a
 * VirtualizedList nests inside a plain ScrollView (RN warning) or a nested
 * vertical scroll-in-scroll breaks windowing. Screens with only a HORIZONTAL
 * ScrollView (FAQ's category row, Premium's plan carousel) are NOT listed — a
 * horizontal scroller does not conflict with the Dialog's vertical scroll.
 */
const OWN_SCROLL_CONTAINER_ROUTES: ReadonlySet<RouteName> = new Set<RouteName>([
  'FileManagement',
  'ConnectedApps',
  'TrustLeaderboard',
  'FollowersList',
  'FollowingList',
]);

/**
 * Resolve the surface configuration for a route + props. Defaults to the
 * responsive sheet; the image-only FileManagement picker upgrades to a full-bleed
 * `'fullScreen'` surface, and every route that owns its own scroll container is
 * marked `scrollable: false`.
 */
export const getSurfaceConfig = (
  route: RouteName,
  props: Record<string, unknown>,
): SurfaceRouteConfig => {
  if (route === 'FileManagement' && isFileManagementImageOnlyPicker(props)) {
    // The full-bleed image picker owns its own translucent top bar — no nav header.
    return { ...DEFAULT_SURFACE_CONFIG, presentation: 'fullScreen', scrollable: false, header: false };
  }
  if (HEADERLESS_ROUTES.has(route)) {
    return { ...DEFAULT_SURFACE_CONFIG, header: false };
  }
  if (OWN_SCROLL_CONTAINER_ROUTES.has(route)) {
    // Own-scroller list screens keep the nav header (static, non-collapsing —
    // there is no Dialog scroll offset to drive the large-title collapse).
    return { ...DEFAULT_SURFACE_CONFIG, scrollable: false };
  }
  return DEFAULT_SURFACE_CONFIG;
};

/** Convenience: just the presentation taxonomy for a route + props. */
export const getSurfacePresentation = (
  route: RouteName,
  props: Record<string, unknown>,
): SurfacePresentation => getSurfaceConfig(route, props).presentation;
