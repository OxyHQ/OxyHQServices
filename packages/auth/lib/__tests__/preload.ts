/**
 * `bun test` preload entry. Order matters: mocks are registered FIRST so any
 * static imports in test files (or their transitive deps) resolve to the
 * stubbed surface; the DOM environment is set up after so React + the
 * components have `window` / `document` to render into.
 */
import "./setup-mocks"
import "./setup-dom"
