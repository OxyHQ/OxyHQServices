import type { OxyServices } from '@oxyhq/core';
import {
  buildIdpBridgeUrl,
  buildIdpHandoffEmbedUrl,
  IDP_HANDOFF_BRIDGE_MESSAGE,
  IDP_HANDOFF_DONE_MESSAGE,
  isAllowedBridgeParentOrigin,
  isIdpHubMessageOrigin,
  type IdpHandoffBridgeOutboundMessage,
  type IdpHandoffDoneOutboundMessage,
  logger,
} from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';
import { isIdpHubOrigin } from './idpHubOrigin';
import {
  isCrossOriginRestoreBlocked,
  markCrossOriginRestoreAttempted,
} from './crossOriginRestoreGuards';

const BRIDGE_TIMEOUT_MS = 12_000;

export interface IdpHandoffBridgeCommitInput {
  sessionId: string;
  accessToken?: string;
  deviceId?: string;
  deviceSecret?: string;
  userId: string;
  expiresAt?: string;
  user?: { id: string; username?: string; avatar?: string };
}

function bridgeAlreadyAttempted(): boolean {
  return isCrossOriginRestoreBlocked();
}

function markBridgeAttempted(): void {
  markCrossOriginRestoreAttempted();
}

function loadHiddenIframe(src: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.hidden = true;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText =
    'position:absolute;width:0;height:0;border:0;clip:rect(0,0,0,0);overflow:hidden';
  document.body.appendChild(iframe);
  return iframe;
}

/**
 * Pull session from auth.oxy.so via hidden iframe (cold-boot restore).
 * Returns true when credentials were planted locally.
 */
export async function tryInvisibleIdpHandoffRestore(opts: {
  oxyServices: OxyServices;
  commitSession: (input: IdpHandoffBridgeCommitInput) => Promise<void>;
}): Promise<boolean> {
  if (!isWebBrowser() || isIdpHubOrigin() || bridgeAlreadyAttempted()) {
    return false;
  }

  const location = (globalThis as { location?: Location }).location;
  if (!location) return false;

  const parentOrigin = location.origin;
  if (!isAllowedBridgeParentOrigin(parentOrigin)) {
    return false;
  }

  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    return false;
  }

  markBridgeAttempted();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const iframe = loadHiddenIframe(buildIdpBridgeUrl(parentOrigin));

    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      iframe.remove();
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), BRIDGE_TIMEOUT_MS);

    const onMessage = (event: MessageEvent): void => {
      if (!isIdpHubMessageOrigin(event.origin)) return;

      const data = event.data as IdpHandoffBridgeOutboundMessage | undefined;
      if (!data || data.type !== IDP_HANDOFF_BRIDGE_MESSAGE) return;

      if (data.status === 'no_session' || data.status === 'error') {
        finish(false);
        return;
      }

      if (data.status !== 'ok' || !data.code) {
        finish(false);
        return;
      }

      void opts.oxyServices
        .exchangeIdpHandoff(data.code)
        .then(async (session) => {
          await opts.commitSession({
            sessionId: session.sessionId,
            accessToken: session.accessToken,
            deviceId: session.deviceId,
            deviceSecret: session.deviceSecret,
            userId: session.user.id,
            expiresAt: session.expiresAt,
            user: session.user,
          });
          finish(true);
        })
        .catch((error) => {
          logger.warn('Invisible IdP bridge exchange failed', { component: 'idpHandoffBridge' }, error);
          finish(false);
        });
    };

    window.addEventListener('message', onMessage);
  });
}

/**
 * Push session to auth.oxy.so via hidden iframe (post interactive sign-in).
 * Returns true when the hub confirmed planting credentials.
 */
export async function tryInvisibleIdpHandoffPush(opts: {
  oxyServices: OxyServices;
  handoffCode?: string;
}): Promise<boolean> {
  if (!isWebBrowser() || isIdpHubOrigin()) {
    return false;
  }

  const location = (globalThis as { location?: Location }).location;
  if (!location) return false;

  const parentOrigin = location.origin;
  if (!isAllowedBridgeParentOrigin(parentOrigin)) {
    return false;
  }

  let handoffCode = opts.handoffCode;
  if (!handoffCode) {
    try {
      ({ handoffCode } = await opts.oxyServices.createIdpHandoff());
    } catch (error) {
      logger.warn('Invisible IdP handoff create failed', { component: 'idpHandoffBridge' }, error);
      return false;
    }
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const iframe = loadHiddenIframe(buildIdpHandoffEmbedUrl(handoffCode, parentOrigin));

    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      iframe.remove();
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), BRIDGE_TIMEOUT_MS);

    const onMessage = (event: MessageEvent): void => {
      if (!isIdpHubMessageOrigin(event.origin)) return;

      const data = event.data as IdpHandoffDoneOutboundMessage | undefined;
      if (!data || data.type !== IDP_HANDOFF_DONE_MESSAGE) return;

      finish(data.status === 'ok');
    };

    window.addEventListener('message', onMessage);
  });
}
