/**
 * Invisible cross-origin session bridge — hidden iframe + one-shot handoff codes.
 *
 * Replaces top-level silent OAuth for official first-party origins. The parent
 * app stays put; auth.oxy.so runs in a zero-size iframe and postMessages a
 * handoff code (never raw deviceSecret). The parent exchanges via API.
 */

import { CENTRAL_IDP_APEX } from './authWebUrl';
import { registrableApex } from './registrableApex';

/** postMessage payload: hub → parent with a redeemable handoff code. */
export const IDP_HANDOFF_BRIDGE_MESSAGE = 'oxy:idp-handoff' as const;

/** postMessage payload: hub handoff page → parent after planting hub creds. */
export const IDP_HANDOFF_DONE_MESSAGE = 'oxy:idp-handoff-done' as const;

/** One invisible bridge attempt per tab navigation (sessionStorage). */
export const OXY_IDP_BRIDGE_ATTEMPTED_KEY = 'oxy.idp_bridge_attempted';

/** Official first-party registrable apexes (mirrors API BOOTSTRAP_CORE_ORIGINS). */
const BRIDGE_OFFICIAL_APEXES = new Set([
  'oxy.so',
  'fairco.in',
  'mention.earth',
  'homiio.com',
  'alia.onl',
  'syra.fm',
  'allo.you',
  'tnp.network',
  'moovo.now',
  'mercaria.co',
]);

export type IdpHandoffBridgeStatus = 'ok' | 'no_session' | 'error';

export interface IdpHandoffBridgeOutboundMessage {
  type: typeof IDP_HANDOFF_BRIDGE_MESSAGE;
  status: IdpHandoffBridgeStatus;
  code?: string;
}

export interface IdpHandoffDoneOutboundMessage {
  type: typeof IDP_HANDOFF_DONE_MESSAGE;
  status: 'ok' | 'error';
}

export function buildIdpHubOrigin(): string {
  return `https://auth.${CENTRAL_IDP_APEX}`;
}

export function buildIdpBridgeUrl(parentOrigin: string): string {
  const url = new URL('/bridge', buildIdpHubOrigin());
  url.searchParams.set('origin', parentOrigin);
  return url.toString();
}

export function buildIdpHandoffEmbedUrl(
  handoffCode: string,
  parentOrigin: string,
): string {
  const url = new URL('/handoff', buildIdpHubOrigin());
  url.searchParams.set('code', handoffCode);
  url.searchParams.set('embed', '1');
  url.searchParams.set('origin', parentOrigin);
  return url.toString();
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** Whether a parent origin may receive bridge postMessages from auth.oxy.so. */
export function isAllowedBridgeParentOrigin(origin: string): boolean {
  if (isLoopbackOrigin(origin)) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (host === CENTRAL_IDP_APEX || host.endsWith(`.${CENTRAL_IDP_APEX}`)) {
      return true;
    }
    const apex = registrableApex(host);
    return apex != null && BRIDGE_OFFICIAL_APEXES.has(apex);
  } catch {
    return false;
  }
}

export function isIdpHubMessageOrigin(origin: string): boolean {
  return origin === buildIdpHubOrigin();
}
