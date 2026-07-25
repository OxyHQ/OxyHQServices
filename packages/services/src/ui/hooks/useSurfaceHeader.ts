import { createContext, useContext, useLayoutEffect, useRef } from 'react';
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
 * Shallow value-equality for a surface's header contribution.
 *
 * Scalars (`title`/`subtitle`/`largeTitle`/`tone`) compare by value; the object
 * and node fields (`titleContent`/`left`/`right`/`primaryAction`/`actions`/
 * `search`/`segments`/`progress`) compare by identity — callers memoize them, per
 * this hook's contract. Function-typed affordances compare by PRESENCE, never
 * identity: `onBack` legitimately gets a fresh closure each render, and its
 * identity never changes what the header renders, so it must not count as a
 * change (that is exactly what would drive the update loop).
 */
function surfaceHeaderContentEqual(
  a: SurfaceHeaderContent | null,
  b: SurfaceHeaderContent | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.titleContent === b.titleContent &&
    a.subtitle === b.subtitle &&
    a.largeTitle === b.largeTitle &&
    a.left === b.left &&
    a.right === b.right &&
    !!a.onBack === !!b.onBack &&
    a.primaryAction === b.primaryAction &&
    a.actions === b.actions &&
    a.search === b.search &&
    a.segments === b.segments &&
    a.tone === b.tone &&
    a.progress === b.progress
  );
}

/**
 * Declare the Dialog nav header's content from within a surface screen — its
 * title/subtitle and any action slot. Merges over nothing (the host owns
 * back/close), replaces on change, and clears on unmount. Call it unconditionally;
 * it is a no-op outside a header-mode surface.
 *
 * Screens pass an INLINE `content` object (a fresh reference every render), so the
 * push is guarded by {@link surfaceHeaderContentEqual}: the host's `setContent` is
 * called only when the VALUE actually changes. Without that guard the setState
 * would fire every render → the screen re-renders → the effect runs again → an
 * infinite update loop (React error #185) in any consumer that does not memoize
 * the object for us (i.e. anything not compiled by the React Compiler).
 */
export function useSurfaceHeader(content: SurfaceHeaderContent | null | undefined): void {
  const ctx = useContext(SurfaceHeaderContext);
  const set = ctx?.setContent;
  const setRef = useRef(set);
  setRef.current = set;
  // The last value pushed to the host; `undefined` until the first push.
  const lastRef = useRef<SurfaceHeaderContent | null | undefined>(undefined);

  // Runs after EVERY commit (no deps array) so the bar/title fill in the same
  // layout phase — but only pushes on a real value change, never on reference churn.
  useLayoutEffect(() => {
    const s = setRef.current;
    if (!s) return;
    const next = content ?? null;
    if (lastRef.current !== undefined && surfaceHeaderContentEqual(lastRef.current, next)) return;
    lastRef.current = next;
    s(next);
  });

  // Clear this surface's contribution when the screen unmounts.
  useLayoutEffect(
    () => () => {
      lastRef.current = undefined;
      setRef.current?.(null);
    },
    [],
  );
}
