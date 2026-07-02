import type { OxyServices, SessionClientHost } from '@oxyhq/core';

/**
 * Thin `SessionClientHost` adapter over an `OxyServices` instance.
 *
 * `SessionClient` (in `@oxyhq/core`) is host-agnostic: it only needs a REST +
 * token surface. `OxyServices` already exposes all of that except
 * `getCurrentAccountId`, which has no direct equivalent — the adapter holds a
 * mutable ref set by the caller (`OxyContext`, in Fase 3-B) via
 * `setCurrentAccountId`.
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
