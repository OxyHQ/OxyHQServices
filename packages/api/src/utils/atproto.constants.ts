/**
 * AtProto (Bluesky) bridge seam constants.
 *
 * SINGLE SOURCE OF TRUTH for the tunables that make an Oxy user's canonical
 * `did:web` document advertise the Mention atproto BE-DISCOVERED bridge.
 *
 * The canonical DID document is owned by oxy-api; Mention CANNOT add an
 * `#atproto_pds` service or an atproto-format verification method to it. This
 * seam closes that gap: when the bridge is enabled AND a PDS endpoint is
 * configured, `buildDidDocument` additively announces the bridge PDS + a
 * `Multikey` verification method (the atproto-format encoding of the user's
 * existing secp256k1 identity key), so a foreign Bluesky AppView/Relay routes a
 * Mention user's handle back to the bridge.
 *
 * Nothing in the DID composition may hardcode these — import them here.
 */

/**
 * Master gate for the atproto BE-DISCOVERED seam. OFF by default — the
 * `#atproto_pds` service + `Multikey` verification method are only added when
 * `ATPROTO_BRIDGE_ENABLED === 'true'`. Mirrors Mention's own bridge gate of the
 * same name so the two sides activate together; defaults closed.
 */
export const ATPROTO_BRIDGE_ENABLED = process.env.ATPROTO_BRIDGE_ENABLED === 'true';

/**
 * Env var naming the HTTPS base URL of the atproto bridge PDS that serves the
 * user's repo (`com.atproto.repo.*` / `com.atproto.sync.*` under `/xrpc`). This
 * is the Mention bridge origin (e.g. `https://mention.earth`) — the BASE, NOT
 * the `/xrpc` path: an atproto client appends `/xrpc/<nsid>` itself. Configurable
 * via env, never hardcoded. When unset the seam is inert even if
 * {@link ATPROTO_BRIDGE_ENABLED} is true — a PDS service with no real endpoint
 * would be worse than none, so the seam FAILS CLOSED (the service/VM are omitted).
 */
export const ATPROTO_PDS_ENDPOINT_ENV = 'ATPROTO_PDS_ENDPOINT';

/** The DID-document service-id fragment for the atproto bridge PDS. */
export const ATPROTO_PDS_SERVICE_FRAGMENT = '#atproto_pds';

/** The DID-document service `type` announced for an atproto Personal Data Server. */
export const ATPROTO_PDS_SERVICE_TYPE = 'AtprotoPersonalDataServer';

/** The DID-document verification-method-id fragment for the atproto Multikey VM. */
export const ATPROTO_VERIFICATION_METHOD_FRAGMENT = '#atproto';

/** The atproto verification-method `type` (multibase-encoded public key). */
export const ATPROTO_MULTIKEY_VM_TYPE = 'Multikey' as const;
