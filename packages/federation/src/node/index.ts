/**
 * `@oxyhq/federation/node` — the runnable Node/Express federation engine.
 *
 * A SEPARATE subpath from the package root so this Node-only code never enters
 * isomorphic bundles that import `@oxyhq/federation`.
 *
 * Phase 2 (HTTP signatures): the signed-fetch transport — a signed ActivityPub
 * GET with per-hop HTTP-signature re-signing, built over an app-injected
 * SSRF-safe single-hop transport. The pure sign/verify crypto it drives lives in
 * the isomorphic `.` entry. The webfinger/actor/inbox routers, delivery
 * transport, and remote-actor resolver land here in later phases.
 */

export {
  createSignedFetch,
  type SignedFetch,
  type CreateSignedFetchConfig,
  type SingleHopFetch,
  type SingleHopFetchInit,
  type SignedFetchLogger,
} from './signedFetch';
