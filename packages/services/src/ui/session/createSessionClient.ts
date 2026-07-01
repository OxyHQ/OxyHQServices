import type { OxyServices } from '@oxyhq/core';
import { SessionClient } from '@oxyhq/core';
import { createSessionClientHost } from './sessionClientHost';
import { createTokenTransport } from './tokenTransport';

/**
 * Wires a `SessionClient` for `@oxyhq/services`: builds the `SessionClientHost`
 * adapter (Task 1) and the platform `TokenTransport` (Task 3) over the given
 * `OxyServices` instance, and returns both the client and the host — the host
 * is returned (not just the client) so `OxyContext` (Fase 3-B) can call
 * `host.setCurrentAccountId(...)` as the active account changes.
 */
export function createSessionClient(oxyServices: OxyServices): {
  client: SessionClient;
  host: ReturnType<typeof createSessionClientHost>;
} {
  const host = createSessionClientHost(oxyServices);
  const transport = createTokenTransport(oxyServices);
  const client = new SessionClient(host, { transport });
  return { client, host };
}
