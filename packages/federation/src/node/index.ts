/**
 * `@oxyhq/federation/node` — the runnable Node/Express federation engine.
 *
 * A SEPARATE subpath from the package root so this Express/Node-only code never
 * enters isomorphic bundles that import `@oxyhq/federation`.
 *
 * PLACEHOLDER (Phase 0): this entry is intentionally empty. The engine —
 * `createFederationEngine(config)`, the webfinger/actor/inbox routers,
 * `signedFetch` over `@oxyhq/core/server`'s `safeFetch`, the HTTP-signature
 * sign/verify transport, the delivery transport, and the remote-actor resolver —
 * is extracted here in the later phases of the federation-engine migration
 * (Phases 1–4). Nothing runtime has moved yet; the `.` entry currently carries
 * only the connector contract + normalized DTOs.
 */

export {};
