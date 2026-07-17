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

/**
 * The actor↔Oxy-user identity bridge — the default implementation of the
 * `PUT /users/resolve` + actor-gone archive/delete seam over an injected
 * service-request transport.
 */
export {
  createIdentityBridge,
  type IdentityBridge,
  type IdentityBridgeConfig,
  type IdentityBridgeLogger,
  type ServiceRequest,
  type ServiceRequestMethod,
  type ReportActorGoneOutcome,
  type DeleteActorIdentityOutcome,
} from './identityBridge';

/**
 * Remote-actor resolution/caching/refresh (webfinger, signed actor fetch,
 * 410-Gone tombstone) over a bring-your-own-store adapter, the identity bridge,
 * and injected transports + text normalization.
 */
export {
  createActorResolver,
  ActorResolver,
  type ActorResolverConfig,
  type ActorResolverIdentity,
  type ActorResolverLogger,
  type ActorTextAdapter,
  type FederatedActorStore,
  type FederatedActorRecordBase,
  type FederatedActorUpsert,
  type FederatedActorField,
  type WebFingerFetch,
  type WebFingerJrd,
} from './actorResolver';
