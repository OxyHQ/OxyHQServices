import type { OxyServices } from '../OxyServices';
import { SessionClient, type SessionClientOptions, type TokenTransport } from './SessionClient';
import type { SocketIOFactory } from './socketLoader';
import { createSessionClientHost } from './sessionClientHost';

/**
 * Wires a `SessionClient` over the given `OxyServices` instance: builds the
 * `SessionClientHost` adapter and passes it through together with a
 * caller-supplied `TokenTransport`.
 *
 * The transport is a required parameter (not constructed here) because it is
 * the one piece of this integration that is NOT platform-agnostic: `services`
 * branches native (shared-keychain sign-in) vs. web (silent sign-in), while
 * `auth-sdk` is web-only. Each consumer builds its own transport and passes
 * it in; this factory only wires the platform-agnostic parts (host + client)
 * so neither consumer re-implements them.
 *
 * The host is returned alongside the client (not just the client) so the
 * caller can call `host.setCurrentAccountId(...)` as the active account
 * changes.
 *
 * `socketFactory` is the statically-injected `socket.io-client` `io` export.
 * Consumers that bundle socket.io-client as a real dependency pass it so
 * realtime sync never depends on core's lazy dynamic import of a bare
 * specifier (bundler-fragile in Metro/Expo-web and Vite against the published
 * dist). When omitted, the client falls back to the lazy loader.
 */
export function createSessionClient(
  oxyServices: OxyServices,
  transport: TokenTransport,
  socketFactory?: SocketIOFactory,
  /**
   * Optional signed-out realtime wiring: `signedOutSocketAuth` (open the socket
   * while signed out so an idle tab receives its device pushes) and
   * `onSessionAppeared` (self-acquire when a sibling signs in). See
   * {@link SessionClientOptions}.
   */
  extra?: Pick<SessionClientOptions, 'signedOutSocketAuth' | 'onSessionAppeared'>,
): {
  client: SessionClient;
  host: ReturnType<typeof createSessionClientHost>;
} {
  const host = createSessionClientHost(oxyServices);
  const client = new SessionClient(host, { transport, socketFactory, ...extra });
  return { client, host };
}
