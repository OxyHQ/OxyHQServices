/**
 * Registrable-apex (eTLD+1) host kernel.
 *
 * The client FAPI auto-detection helper (`autoDetectAuthWebUrl`) was removed in
 * the device-first cutover — the SDK no longer derives a per-apex `auth.<rp>`
 * IdP host. What survives is the pure registrable-domain kernel, still used by
 * the api SSO surface, `fedcm.service`, `deviceAuth` (same-apex trust checks),
 * and the IdP worker (all lista B / server-side). `@oxyhq/core/server`
 * re-exports it for the api.
 *
 * LEGACY(old-sdk): `registrableApex` survives ONLY for the lista-B server/IdP
 * SSO surface. Deletable once Homiio/Allo/Alia/Syra are bumped off the old SDK
 * AND CloudWatch `/oxy/ecs` shows the `/sso*` + `/fedcm/*` routes quiet — the
 * F-final sweep should remove this file then.
 */

import { getDomain } from 'tldts';

/**
 * Compute the bare registrable apex (eTLD+1) of a hostname using the Public
 * Suffix List, including private hosted suffixes.
 *
 * Performs NO protocol handling and builds NO URL — it only answers "what is
 * the registrable domain of this host, or is that undefinable?".
 *
 * Returns `null` (apex undefinable) for:
 *   - empty input;
 *   - IPv4 literals (`192.168.1.10`);
 *   - IPv6 literals or any host carrying a port (`[::1]`, anything with `:`);
 *   - single-label hosts (`intranet`, `localhost`);
 *   - public suffixes without a registrable label (e.g. `co.uk`, `github.io`).
 *
 * @param hostname - A bare hostname (no scheme), e.g. `www.mention.earth`.
 * @returns The eTLD+1 (`mention.earth`), or `null` when undefinable.
 */
export function registrableApex(hostname: string): string | null {
  if (!hostname) return null;
  const host = hostname.toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  // IPv6 literals are bracketed; any remaining ':' implies a port — neither
  // yields a registrable apex.
  if (host.startsWith('[') || host.includes(':')) return null;
  // The Public Suffix List (private suffixes included) is the source of truth
  // for what an attacker can register. A multi-part public suffix like `co.uk`
  // or a hosted suffix like `github.io` returns no registrable domain.
  return getDomain(host, { allowPrivateDomains: true });
}
