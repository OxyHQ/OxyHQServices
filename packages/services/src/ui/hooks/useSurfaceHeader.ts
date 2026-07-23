import { createContext, useContext, useLayoutEffect } from 'react';
import type { DialogHeaderConfig } from '@oxyhq/bloom/dialog';

/**
 * The header content a mounted surface screen contributes at runtime: its
 * (translated) title/subtitle and optional slot nodes. Back/close affordances
 * are owned by the surface host (`SurfaceScreen`) — a screen never wires them.
 *
 * A `right` slot is the canonical place for a screen-state action (e.g. a Save
 * button whose disabled/loading state reflects the form). Slot nodes MUST be
 * referentially stable (memoize them with `useMemo`) so the header does not
 * thrash.
 */
export type SurfaceHeaderContent = Pick<
  DialogHeaderConfig,
  'title' | 'titleContent' | 'subtitle' | 'largeTitle' | 'left' | 'right' | 'onBack'
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
    // Slot nodes (`left`/`right`) are compared by identity; callers memoize them.
  }, [
    set,
    content?.title,
    content?.titleContent,
    content?.subtitle,
    content?.largeTitle,
    content?.left,
    content?.right,
    content?.onBack,
  ]);
}
