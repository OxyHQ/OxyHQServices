import { createContext, useContext, useLayoutEffect } from 'react';
import type { DialogHeaderConfig } from '@oxyhq/bloom/dialog';

/**
 * The header content a mounted surface screen contributes at runtime: its
 * (translated) title/subtitle and optional slot nodes. Back/close affordances
 * are owned by the surface host (`SurfaceScreen`) — a screen never wires them.
 *
 * Alongside the classic slots (`left`/`right`) a screen can declare the rich
 * design-system fields Bloom's nav header supports: the single trailing
 * `primaryAction` CTA (Upload / Save), a trailing icon `actions` row, a header
 * `search` / `segments` in the large-title zone, an `onImage` `tone` over media,
 * and a wizard `progress` bar. Object/slot fields MUST be referentially stable
 * (memoize them with `useMemo`) so the header does not thrash.
 */
export type SurfaceHeaderContent = Pick<
  DialogHeaderConfig,
  | 'title'
  | 'titleContent'
  | 'subtitle'
  | 'largeTitle'
  | 'left'
  | 'right'
  | 'onBack'
  | 'primaryAction'
  | 'actions'
  | 'search'
  | 'segments'
  | 'tone'
  | 'progress'
>;

interface SurfaceHeaderContextValue {
  setContent: (content: SurfaceHeaderContent | null) => void;
}

/**
 * Provided by {@link ../components/SurfaceScreen}. Bridges a screen's runtime
 * header contribution up to the host, which merges it with the back/close
 * wiring and drives the Dialog's own nav header. `null` outside a surface (or in
 * a headerless surface), so {@link useSurfaceHeader} is a safe no-op there.
 */
export const SurfaceHeaderContext = createContext<SurfaceHeaderContextValue | null>(null);

/**
 * Declare the Dialog nav header's content from within a surface screen — its
 * title/subtitle and any action slot. Merges over nothing (the host owns
 * back/close), replaces on change, and clears on unmount. Call it unconditionally;
 * it is a no-op outside a header-mode surface.
 */
export function useSurfaceHeader(content: SurfaceHeaderContent | null | undefined): void {
  const ctx = useContext(SurfaceHeaderContext);
  const set = ctx?.setContent;
  // Set synchronously in the commit's layout phase so the bar/title fill in
  // BEFORE the browser paints — no first-frame flash of an empty bar.
  useLayoutEffect(() => {
    if (!set) return;
    set(content ?? null);
    return () => set(null);
    // Callers must memoize `content` (especially slot nodes) so the header does not thrash.
  }, [set, content]);
}
