/**
 * jsdom-based DOM environment for `bun test`. Preloaded via `bun test --preload`
 * so every client-side test sees `window`, `document`, `HTMLElement`, etc.
 */
import { JSDOM } from "jsdom"

const dom = new JSDOM(
    "<!DOCTYPE html><html><head></head><body></body></html>",
    { url: "http://localhost/", pretendToBeVisual: true }
)

type GlobalWithDOM = typeof globalThis & {
    window: JSDOM["window"]
    document: Document
    HTMLElement: typeof HTMLElement
    HTMLStyleElement: typeof HTMLStyleElement
    HTMLButtonElement: typeof HTMLButtonElement
    Element: typeof Element
    Node: typeof Node
    navigator: Navigator
    getComputedStyle: typeof getComputedStyle
    requestAnimationFrame: typeof requestAnimationFrame
    cancelAnimationFrame: typeof cancelAnimationFrame
    matchMedia: typeof window.matchMedia
    Event: typeof Event
    MouseEvent: typeof MouseEvent
    FocusEvent: typeof FocusEvent
}

const g = globalThis as GlobalWithDOM
const w = dom.window

g.window = w
g.document = w.document
g.HTMLElement = w.HTMLElement
g.HTMLStyleElement = w.HTMLStyleElement
g.HTMLButtonElement = w.HTMLButtonElement
g.Element = w.Element
g.Node = w.Node
g.navigator = w.navigator
g.getComputedStyle = w.getComputedStyle.bind(w)
g.requestAnimationFrame = w.requestAnimationFrame.bind(w)
g.cancelAnimationFrame = w.cancelAnimationFrame.bind(w)
g.Event = w.Event
g.MouseEvent = w.MouseEvent
g.FocusEvent = w.FocusEvent

// React 19's `act` reads this flag to decide whether the current environment
// is a test runner — without it every act() call logs a warning.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const reducedMotionListeners = new Set<(event: { matches: boolean }) => void>()
let reducedMotionMatches = false

const matchMediaMock = (query: string) => {
    const isReducedMotion = query === "(prefers-reduced-motion: reduce)"
    return {
        media: query,
        matches: isReducedMotion ? reducedMotionMatches : false,
        onchange: null,
        addEventListener: (_event: string, listener: (e: { matches: boolean }) => void) => {
            if (isReducedMotion) reducedMotionListeners.add(listener)
        },
        removeEventListener: (_event: string, listener: (e: { matches: boolean }) => void) => {
            if (isReducedMotion) reducedMotionListeners.delete(listener)
        },
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
    } as unknown as MediaQueryList
}
g.matchMedia = matchMediaMock
Object.defineProperty(w, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMediaMock,
})

/** Test helper for toggling the reduced-motion preference at runtime. */
export function __setReducedMotionForTests(matches: boolean): void {
    reducedMotionMatches = matches
    for (const listener of reducedMotionListeners) {
        listener({ matches })
    }
}
