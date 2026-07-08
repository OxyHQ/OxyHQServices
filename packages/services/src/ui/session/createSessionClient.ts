import { io } from 'socket.io-client';
import {
  SessionClient,
  createSessionClientHost,
  type AuthStateStore,
  type OxyServices,
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
 *    from the persisted device credential (`store` → `deviceId` + `deviceSecret`).
 *
 * `onUnauthenticated` fires when an applied device state has zero accounts (a
 * device signout-all): the provider clears the persisted store + local state so
 * a reload does not try to restore a dead session. The host is returned
 * alongside the client so the caller can call `host.setCurrentAccountId(...)`
 * as the active account changes.
 *
 * The realtime socket uses bearer when authenticated, or deviceId+deviceSecret
 * when signed out (after the one-shot join redirect).
 */
export function createSessionClient(
  oxyServices: OxyServices,
  store: AuthStateStore,
  onUnauthenticated?: () => void,
): {
  client: SessionClient;
  host: ReturnType<typeof createSessionClientHost>;
} {
  const host = createSessionClientHost(oxyServices);
  const transport = createTokenTransport(oxyServices, store);
  const client = new SessionClient(host, { transport, socketFactory: io, onUnauthenticated });
  return { client, host };
}
