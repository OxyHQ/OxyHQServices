import { io } from 'socket.io-client';
import {
  SessionClient,
  createSessionClientHost,
  type OxyServices,
  type SessionStateOrigin,
} from '@oxyhq/core';
import { createTokenTransport } from './tokenTransport';

/**
 * Wire a `SessionClient` for `@oxyhq/services`.
 *
 * The platform-agnostic parts (host adapter, client, projection helpers) live
 * ONCE in `@oxyhq/core`; this thin factory only injects the pieces specific to
 * the RN/Expo SDK:
 *
 *  - `socket.io-client`'s `io`, STATICALLY imported (socket.io-client is a real
 *    dependency of `@oxyhq/services`) so realtime session sync never relies on
 *    core's lazy dynamic import of a bare specifier — bundler-fragile in
 *    Metro/Expo-web against the published core dist.
 *  - the device-first {@link createTokenTransport}, which mints a fallback token
 *    through the ONE shared `httpService.refreshAccessToken` single-flight (it
 *    reads the persisted `deviceId` + `deviceSecret` via the installed handler,
 *    so it takes no `store` of its own).
 *
 * `onUnauthenticated` fires when an applied device state has zero accounts. It
 * receives the {@link SessionStateOrigin} so the provider can gate the
 * destructive credential wipe: a `request`-origin verdict (a REST sign-out /
 * revocation) clears the persisted store; a `push`-origin verdict (a possibly
 * transient socket broadcast) clears only the local UI session and KEEPS the
 * durable device credential. The host is returned alongside the client so the
 * caller can call `host.setCurrentAccountId(...)` as the active account changes.
 *
 * The realtime socket uses bearer when authenticated, or deviceId+deviceSecret
 * when signed out (after the one-shot join redirect).
 */
export function createSessionClient(
  oxyServices: OxyServices,
  onUnauthenticated?: (origin: SessionStateOrigin) => void,
): {
  client: SessionClient;
  host: ReturnType<typeof createSessionClientHost>;
} {
  const host = createSessionClientHost(oxyServices);
  const transport = createTokenTransport(oxyServices);
  const client = new SessionClient(host, { transport, socketFactory: io, onUnauthenticated });
  return { client, host };
}
