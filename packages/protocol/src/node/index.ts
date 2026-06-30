/**
 * `@oxyhq/protocol/node` — Node-only entry point.
 *
 * Reserved for the runnable node substrate (the Express app factory, the
 * `did:web` resolver, and node-specific constants) extracted from `@oxyhq/node`
 * in a later phase. It is a SEPARATE subpath from the package root so the
 * node's Express factory never enters React Native / web bundles that import
 * `@oxyhq/protocol`.
 *
 * Intentionally empty until that phase lands — no exports are wired here yet.
 */

export {};
