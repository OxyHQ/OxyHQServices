import { createStore, type StoreApi } from 'zustand/vanilla';
import type { RouteName } from './routes';

/**
 * Per-surface route history — the NAV-WITHIN axis.
 *
 * Bloom's surface stack owns DEPTH (a surface presented on top of another). This
 * store owns the ORTHOGONAL axis: the route history INSIDE one SDK surface. Each
 * SDK surface holds its own {@link SurfaceNavStack}; `navigate`/`replace`/`goBack`
 * mutate it and the SAME Bloom surface re-renders its content from the new top
 * frame. It is the per-surface reincarnation of the old global
 * `bottomSheetStore`'s `history` + `currentStep`.
 *
 * `closing`/`closeResult` model a pending dismissal: the surface's `SurfaceScreen`
 * watches them and calls the Bloom surface's `dismiss(result)` from an effect —
 * so a dismiss requested BEFORE the surface has mounted still resolves once it
 * does, with no controls-capture race and no render-phase side effect.
 */

/** One frame in a surface's route history. */
export interface NavFrame {
  route: RouteName;
  props: Record<string, unknown>;
  /** Current wizard step for step-based screens (seeded from `props.initialStep`). */
  step: number;
}

export interface NavStackState {
  /** Bottom → top; the last frame is the visible screen. */
  frames: NavFrame[];
  /** Flipped once a dismiss is requested; the host resolves the Bloom surface. */
  closing: boolean;
  /** The value the surface's `present()` promise resolves with on dismissal. */
  closeResult: unknown;
}

export interface SurfaceNavStack {
  store: StoreApi<NavStackState>;
  /** Drill in: push a new frame. */
  navigate(route: RouteName, props?: Record<string, unknown>): void;
  /** Swap the top frame in place (no history entry). */
  replace(route: RouteName, props?: Record<string, unknown>): void;
  /** Pop one frame. Returns `false` when already at the root frame. */
  goBack(): boolean;
  /** Whether a back is possible (a deeper frame OR a prior wizard step). */
  canGoBack(): boolean;
  /** Set the current frame's wizard step. */
  setStep(step: number): void;
  /** Request dismissal of the whole surface, resolving its promise with `result`. */
  requestDismiss(result?: unknown): void;
  /** The current (top) frame. */
  getTop(): NavFrame;
}

function makeFrame(route: RouteName, props?: Record<string, unknown>): NavFrame {
  const resolved = props ?? {};
  const step = typeof resolved.initialStep === 'number' ? resolved.initialStep : 0;
  return { route, props: resolved, step };
}

export function createSurfaceNavStack(
  route: RouteName,
  props?: Record<string, unknown>,
): SurfaceNavStack {
  const store = createStore<NavStackState>(() => ({
    frames: [makeFrame(route, props)],
    closing: false,
    closeResult: undefined,
  }));

  const getTop = (): NavFrame => {
    const { frames } = store.getState();
    return frames[frames.length - 1];
  };

  return {
    store,
    getTop,
    navigate(nextRoute, nextProps) {
      store.setState((state) => ({ frames: [...state.frames, makeFrame(nextRoute, nextProps)] }));
    },
    replace(nextRoute, nextProps) {
      store.setState((state) => ({
        frames: [...state.frames.slice(0, -1), makeFrame(nextRoute, nextProps)],
      }));
    },
    goBack() {
      const { frames } = store.getState();
      if (frames.length <= 1) return false;
      store.setState({ frames: frames.slice(0, -1) });
      return true;
    },
    canGoBack() {
      const { frames } = store.getState();
      return frames.length > 1 || (frames[frames.length - 1]?.step ?? 0) > 0;
    },
    setStep(step) {
      store.setState((state) => {
        const frames = state.frames.slice();
        const index = frames.length - 1;
        frames[index] = { ...frames[index], step };
        return { frames };
      });
    },
    requestDismiss(result) {
      if (store.getState().closing) return;
      store.setState({ closing: true, closeResult: result });
    },
  };
}
