/**
 * Session-sync integration layer (Fase 3-A) — intra-package use only.
 *
 * These modules let `@oxyhq/services` drive the platform-agnostic
 * `SessionClient` (in `@oxyhq/core`): a thin host adapter over `OxyServices`,
 * pure `DeviceSessionState → services` projection helpers, a platform token
 * transport, and the factory that wires them together. Nothing here is
 * re-exported from the package root — `OxyContext` consumes it directly in
 * Fase 3-B.
 */
export { createSessionClient } from './createSessionClient';
export { createSessionClientHost } from './sessionClientHost';
export { createTokenTransport } from './tokenTransport';
export {
  accountIdsOf,
  activeSessionIdOf,
  activeUserOf,
  deviceStateToClientSessions,
} from './projectSessionState';
