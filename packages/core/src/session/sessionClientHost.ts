import type { OxyServices } from '../OxyServices';
import type { SessionClientHost } from './SessionClient';

/**
 * Thin `SessionClientHost` adapter over an `OxyServices` instance.
 *
 * `SessionClient` is host-agnostic: it only needs a REST + token surface.
 * `OxyServices` already exposes all of that except `getCurrentAccountId`,
 * which has no direct equivalent — the adapter holds a mutable ref set by
 * the caller (`OxyContext` in `@oxyhq/services`, and formerly the separate web provider in
 * the former web provider) via `setCurrentAccountId`.
 *
 * Shared here (rather than duplicated per consumer) because it is entirely
 * platform-agnostic: every method it calls exists identically on
 * `OxyServices` regardless of host (web, Expo/RN, Node).
 */
export function createSessionClientHost(
  oxyServices: OxyServices,
): SessionClientHost & { setCurrentAccountId(id: string | null): void } {
  let currentAccountId: string | null = null;
  return {
    makeRequest: (method, url, data, options) => oxyServices.makeRequest(method, url, data, options),
    getBaseURL: () => oxyServices.getBaseURL(),
    getAccessToken: () => oxyServices.getAccessToken(),
    onTokensChanged: (listener) => oxyServices.onTokensChanged(listener),
    setTokens: (accessToken) => oxyServices.setTokens(accessToken),
    getCurrentAccountId: () => currentAccountId,
    setCurrentAccountId: (id) => {
      currentAccountId = id;
    },
  };
}
