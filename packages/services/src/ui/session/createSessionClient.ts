import type { OxyServices } from '@oxyhq/core';
import { SessionClient } from '@oxyhq/core';
import { io } from 'socket.io-client';
import { createSessionClientHost } from './sessionClientHost';
import { createTokenTransport } from './tokenTransport';

/**
 * Wires a `SessionClient` for `@oxyhq/services`: builds the `SessionClientHost`
 * adapter (Task 1) and the platform `TokenTransport` (Task 3) over the given
 * `OxyServices` instance, and returns both the client and the host — the host
 * is returned (not just the client) so `OxyContext` (Fase 3-B) can call
 * `host.setCurrentAccountId(...)` as the active account changes.
 *
 * `socket.io-client`'s `io` is STATICALLY imported and injected as the
 * `SessionClient` `socketFactory` (socket.io-client is a real dependency of
 * `@oxyhq/services`). This is what keeps realtime session sync working in the
 * Metro/Expo-web bundle: core's lazy dynamic `import('socket.io-client')` of a
 * bare specifier does not resolve reliably against the published core dist, so
 * the app-bundled static import is the reliable source of the factory.
 */
export function createSessionClient(oxyServices: OxyServices): {
  client: SessionClient;
  host: ReturnType<typeof createSessionClientHost>;
} {
  const host = createSessionClientHost(oxyServices);
  const transport = createTokenTransport(oxyServices);
  const client = new SessionClient(host, { transport, socketFactory: io });
  return { client, host };
}
