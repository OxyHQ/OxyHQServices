import { createElement } from 'react';
import type { ViewStyle } from 'react-native';
import {
  surfaces as bloomSurfaces,
  type PresentOptions,
  type SurfaceControls,
} from '@oxyhq/bloom/surfaces';
import SurfaceScreen from '../components/SurfaceScreen';
import type { RouteName } from './routes';
import {
  getSurfaceConfig,
  getSurfacePresentation,
  type SurfacePresentation,
  type SurfaceProps,
  type SurfaceResult,
  type SurfaceRouteConfig,
} from './surfaceRegistry';
import { createSurfaceNavStack, type SurfaceNavStack } from './surfaceNavStack';

/**
 * The SDK's typed surface API — a route registry layered on top of Bloom's
 * content-agnostic surface stack (`@oxyhq/bloom/surfaces`).
 *
 * `present(route)` opens a NEW Bloom surface (the DEPTH axis) whose content is a
 * {@link SurfaceScreen} driven by the route's own {@link SurfaceNavStack} (the
 * NAV-WITHIN axis). Navigating within that surface mutates its nav stack and
 * re-renders the SAME Bloom surface; presenting stacks another surface on top.
 *
 * Bloom coordinates z-order / backdrop / dismiss across every surface (SDK's and
 * apps'), so nothing clashes.
 */

/** Responsive "sheet": bottom sheet on narrow, centered card on wide. */
const SHEET_PLACEMENT = { base: 'bottom', md: 'center' } as const;

/** Full-bleed black canvas for the `'fullScreen'` approximation (image picker). */
const FULLSCREEN_SURFACE_STYLE: ViewStyle = { backgroundColor: '#000000', overflow: 'hidden' };

/** Map a route's presentation taxonomy onto concrete Bloom `Dialog` options. */
function bloomOptionsFor(config: SurfaceRouteConfig): PresentOptions {
  switch (config.presentation) {
    case 'center':
      return { placement: 'center' };
    case 'drawer':
      return { placement: { base: 'bottom', md: 'left' } };
    case 'fullScreen':
      // Approximate a full-screen surface with the shared `Dialog`: a tall
      // sheet / large centered card, flush content, a black canvas and
      // programmatic-only dismiss — matching the shipped image-picker Dialog.
      return {
        placement: SHEET_PLACEMENT,
        contentPadding: 0,
        maxWidth: 640,
        maxHeightRatio: 0.9,
        dismissOnBackdrop: false,
        style: FULLSCREEN_SURFACE_STYLE,
        panelStyle: FULLSCREEN_SURFACE_STYLE,
      };
    default:
      return { placement: SHEET_PLACEMENT };
  }
}

/**
 * A live handle to a presented SDK surface. Exposes DEPTH controls (`dismiss`,
 * `result`) and NAV-WITHIN controls (`navigate`/`replace`/`goBack`/`setStep`) that
 * drive this surface's own nav stack. Held by the `showBottomSheet` adapter (base
 * surface) and by `OxyContext` (the AccountDialog surface).
 */
export interface SurfaceInstance<K extends RouteName = RouteName> {
  readonly route: RouteName;
  readonly presentation: SurfacePresentation;
  navigate: (route: RouteName, props?: Record<string, unknown>) => void;
  replace: (route: RouteName, props?: Record<string, unknown>) => void;
  goBack: () => boolean;
  canGoBack: () => boolean;
  setStep: (step: number) => void;
  dismiss: (result?: SurfaceResult<K>) => void;
  readonly result: Promise<SurfaceResult<K> | undefined>;
}

/**
 * The type-erased handle the `showBottomSheet` adapter needs from a tracked
 * surface: what it hosts, and how to drive/dismiss it. Kept result-type-free so
 * the (generic) `SurfaceInstance<K>` never has to be widened into a shared array.
 */
interface TrackedSurface {
  readonly route: RouteName;
  readonly presentation: SurfacePresentation;
  navigate: (route: RouteName, props?: Record<string, unknown>) => void;
  goBack: () => boolean;
  dismiss: () => void;
}

/**
 * Active SDK "route" surfaces (the `showBottomSheet` lineage), bottom → top.
 * `present`/`presentRoute` register here; `presentDetached` (AccountDialog) does
 * NOT, so the base-sheet navigation logic never treats the account modal as a
 * navigable base. Entries self-remove when their surface is dismissed.
 */
const activeRouteSurfaces: TrackedSurface[] = [];

function presentInternal<K extends RouteName>(
  route: K,
  props: Record<string, unknown>,
  opts: PresentOptions | undefined,
  track: boolean,
): SurfaceInstance<K> {
  const navStack = createSurfaceNavStack(route, props);
  const config = getSurfaceConfig(route, props);
  const bloomOpts: PresentOptions = { label: route, ...bloomOptionsFor(config), ...opts };

  const result = bloomSurfaces.present<SurfaceResult<K>>((surface: SurfaceControls) =>
    createElement(SurfaceScreen, {
      navStack,
      surface,
      presentation: config.presentation,
      dismissOnBackdrop: bloomOpts.dismissOnBackdrop ?? true,
    }),
    bloomOpts,
  );

  const instance: SurfaceInstance<K> = {
    route,
    presentation: config.presentation,
    navigate: (nextRoute, nextProps) => {
      const top = navStack.getTop();
      if (top.route === nextRoute) navStack.replace(nextRoute, nextProps);
      else navStack.navigate(nextRoute, nextProps);
    },
    replace: (nextRoute, nextProps) => navStack.replace(nextRoute, nextProps),
    goBack: () => navStack.goBack(),
    canGoBack: () => navStack.canGoBack(),
    setStep: (step) => navStack.setStep(step),
    dismiss: (dismissResult) => navStack.requestDismiss(dismissResult),
    result,
  };

  if (track) {
    const tracked: TrackedSurface = {
      route: instance.route,
      presentation: instance.presentation,
      navigate: instance.navigate,
      goBack: instance.goBack,
      dismiss: () => instance.dismiss(),
    };
    activeRouteSurfaces.push(tracked);
    result.finally(() => {
      const index = activeRouteSurfaces.indexOf(tracked);
      if (index >= 0) activeRouteSurfaces.splice(index, 1);
    });
  }

  return instance;
}

/**
 * Present a NEW route surface on top of the stack (the DEPTH axis). Resolves with
 * the value the surface is dismissed with. Registered in the route-surface stack.
 */
export function present<K extends RouteName>(
  route: K,
  props?: SurfaceProps<K>,
  opts?: PresentOptions,
): SurfaceInstance<K> {
  return presentInternal(route, (props ?? {}) as Record<string, unknown>, opts, true);
}

/**
 * Present a surface that is NOT part of the `showBottomSheet` base-navigation
 * lineage (the AccountDialog modal). Otherwise identical to {@link present}.
 */
export function presentDetached<K extends RouteName>(
  route: K,
  props?: SurfaceProps<K>,
  opts?: PresentOptions,
): SurfaceInstance<K> {
  return presentInternal(route, (props ?? {}) as Record<string, unknown>, opts, false);
}

/**
 * Untyped present for the adapter, the nav helpers, and the `SurfaceScreen`
 * binding (where the route is a runtime value and its props are already erased).
 */
export function presentRoute(route: RouteName, props?: Record<string, unknown>): SurfaceInstance {
  return presentInternal(route, props ?? {}, undefined, true);
}

/** The top-most active route surface, or `undefined` when none are open. */
export function topRouteSurface(): TrackedSurface | undefined {
  return activeRouteSurfaces[activeRouteSurfaces.length - 1];
}

/**
 * Dismiss every active route surface (the whole `showBottomSheet` session). The
 * AccountDialog is untracked, so it is untouched. Iterates a snapshot because
 * `dismiss` mutates `activeRouteSurfaces` asynchronously as surfaces settle.
 */
export function closeAllRouteSurfaces(): void {
  for (const instance of [...activeRouteSurfaces].reverse()) instance.dismiss();
}

/**
 * Drill in from a screen: navigate WITHIN the current surface when the target's
 * presentation matches, else present the target as a NEW surface on top (so a
 * sheet screen opening the full-bleed picker gets the right chrome).
 */
export function navigateWithinOrPresent(
  currentPresentation: SurfacePresentation,
  navStack: SurfaceNavStack,
  route: RouteName,
  props?: Record<string, unknown>,
): void {
  const nextProps = props ?? {};
  if (getSurfacePresentation(route, nextProps) === currentPresentation) {
    navStack.navigate(route, nextProps);
  } else {
    presentRoute(route, nextProps);
  }
}

/** Replace variant of {@link navigateWithinOrPresent}. */
export function replaceWithinOrPresent(
  currentPresentation: SurfacePresentation,
  navStack: SurfaceNavStack,
  route: RouteName,
  props?: Record<string, unknown>,
): void {
  const nextProps = props ?? {};
  if (getSurfacePresentation(route, nextProps) === currentPresentation) {
    navStack.replace(route, nextProps);
  } else {
    presentRoute(route, nextProps);
  }
}

/**
 * The SDK's imperative surface API (a module singleton). `present` is the typed
 * route presenter; `dismissAll` unwinds the whole session. Not yet exported from
 * the package root — the public `surfaces`/`useSurfaces` API lands in a later
 * phase; for P1 the internal adapters (`showBottomSheet`, `openAccountDialog`)
 * are the only public entry points.
 */
export const surfaces = {
  present: <K extends RouteName>(route: K, props?: SurfaceProps<K>, opts?: PresentOptions) =>
    present(route, props, opts).result,
  dismissAll: closeAllRouteSurfaces,
} as const;

/** Hook form of {@link surfaces} (stable singleton). */
export function useSurfaces(): typeof surfaces {
  return surfaces;
}
