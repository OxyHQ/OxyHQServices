import type { ReactNode } from 'react';
import type { AccountDialogView } from '@oxyhq/core';
import type { RouteName } from './routes';

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
  FileManagement: SurfaceRoute;
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
  AvatarCrop: SurfaceRoute;
  Notifications: SurfaceRoute;
  ConnectedApps: SurfaceRoute;
  Preferences: SurfaceRoute;
  /** Unified account switcher + sign-in surface (folded `OxyAccountDialog` body). */
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
 * NOTE: `scrollable` / `manualActivation` / `dynamicBackdrop` / `handleComponent`
 * describe the in-tree bottom-sheet's pan + scroll behaviour. On Bloom's `Dialog`
 * surface those concerns are now owned by the shared `DialogBottomSheet` (it opts
 * pure custom children OUT of its internal ScrollView and manages the pan itself),
 * so for P1 these fields are informational — reserved for a future Bloom
 * bottom-placement passthrough. `presentation` (+ `scrollable` for the picker's
 * flush layout) is what actually drives the surface today.
 */
export interface SurfaceRouteConfig {
  /** Which surface hosts the route. */
  presentation: SurfacePresentation;
  /**
   * When `false`, the route owns its own scroll container (a FlatList /
   * SectionList / VirtualizedList) and the host must not wrap it in a ScrollView.
   */
  scrollable: boolean;
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
  manualActivation: true,
  dynamicBackdrop: true,
};

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
 * Resolve the surface configuration for a route + props. Defaults to the
 * responsive sheet; the image-only FileManagement picker upgrades to a full-bleed
 * `'fullScreen'` surface that owns its own scrolling.
 */
export const getSurfaceConfig = (
  route: RouteName,
  props: Record<string, unknown>,
): SurfaceRouteConfig => {
  if (route === 'FileManagement' && isFileManagementImageOnlyPicker(props)) {
    return { ...DEFAULT_SURFACE_CONFIG, presentation: 'fullScreen', scrollable: false };
  }
  return DEFAULT_SURFACE_CONFIG;
};

/** Convenience: just the presentation taxonomy for a route + props. */
export const getSurfacePresentation = (
  route: RouteName,
  props: Record<string, unknown>,
): SurfacePresentation => getSurfaceConfig(route, props).presentation;
