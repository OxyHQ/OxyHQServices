import type { RouteName } from './routes';
import { isValidRoute } from './routes';
import { getSurfacePresentation } from './surfaceRegistry';
import { closeAllRouteSurfaces, presentRoute, topRouteSurface } from './surfaces';

/**
 * Bottom-sheet manager — the INTERNAL adapter that keeps the historical
 * `showBottomSheet` / `closeBottomSheet` API working on top of the new Bloom
 * surface stack (`navigation/surfaces.ts`). The public signatures are unchanged;
 * this file just re-expresses them as thin calls into the typed surface layer.
 *
 * The old single-surface store is gone: `showBottomSheet` now open-or-navigates
 * the "base" (top-most) route surface, and cross-presentation targets (the
 * full-bleed image picker) stack a NEW surface on top — Bloom coordinates the
 * z-order / backdrop / dismiss so nothing clashes.
 */

/**
 * Open a bottom-sheet route. If the top-most active surface hosts the SAME
 * presentation (the common all-sheets case) the route is drilled into it; a route
 * with a different presentation (the image picker's full-bleed surface) is
 * presented as a NEW surface on top. Opening with no active surface presents the
 * first one.
 *
 * `fullScreen` is accepted for signature compatibility and ignored — a route's
 * surface is now derived from its registry config, not a per-call flag.
 */
export const showBottomSheet = (
  screenOrConfig:
    | RouteName
    | { screen: RouteName; props?: Record<string, unknown>; fullScreen?: boolean },
): void => {
  const screen = typeof screenOrConfig === 'string' ? screenOrConfig : screenOrConfig.screen;
  const props = typeof screenOrConfig === 'string' ? {} : screenOrConfig.props ?? {};

  if (!isValidRoute(screen)) {
    if (__DEV__) console.warn(`[BottomSheet] Invalid route: ${screen}`);
    return;
  }

  const top = topRouteSurface();
  if (top && top.presentation === getSurfacePresentation(screen, props)) {
    top.navigate(screen, props);
  } else {
    presentRoute(screen, props);
  }
};

/** Dismiss the whole bottom-sheet session (every active route surface). */
export const closeBottomSheet = (): void => {
  closeAllRouteSurfaces();
};

/**
 * Step back within the top-most surface's route history. Returns `true` when a
 * frame was popped, `false` when the surface is already at its root frame.
 */
export const goBack = (): boolean => {
  const top = topRouteSurface();
  return top ? top.goBack() : false;
};
