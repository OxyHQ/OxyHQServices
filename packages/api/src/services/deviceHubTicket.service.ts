/**
 * Hub ticket issuance and redemption for cross-origin device credential sync.
 */

import * as crypto from 'crypto';
import DeviceHubTicket from '../models/DeviceHubTicket';
import deviceSessionService from './deviceSession.service';
import {
  base64UrlEncode,
  sha256Hex,
  timingSafeStringEqual,
} from './oauthCode.service';

export const HUB_TICKET_TTL_MS = 60 * 1000;
export const HUB_TICKET_BYTES = 32;

export interface IssueHubTicketOptions {
  deviceId: string;
  returnOrigin: string;
  ttlMs?: number;
}

export interface IssueHubTicketResult {
  ticket: string;
  expiresIn: number;
}

export type RedeemHubTicketOutcome =
  | { ok: true; deviceId: string; deviceSecret: string }
  | { ok: false; reason: 'invalid_ticket' };

export async function issueHubTicket(
  options: IssueHubTicketOptions,
): Promise<IssueHubTicketResult> {
  const ttlMs = options.ttlMs ?? HUB_TICKET_TTL_MS;
  const rawTicket = base64UrlEncode(crypto.randomBytes(HUB_TICKET_BYTES));
  const ticketHash = sha256Hex(rawTicket);
  const expiresAt = new Date(Date.now() + ttlMs);

  await DeviceHubTicket.create({
    ticketHash,
    deviceId: options.deviceId,
    returnOrigin: options.returnOrigin,
    expiresAt,
  });

  return { ticket: rawTicket, expiresIn: Math.floor(ttlMs / 1000) };
}

export async function redeemHubTicket(
  rawTicket: string,
  returnOrigin: string,
): Promise<RedeemHubTicketOutcome> {
  const ticketHash = sha256Hex(rawTicket);
  const stored = await DeviceHubTicket.findOne({ ticketHash });

  if (!stored) {
    return { ok: false, reason: 'invalid_ticket' };
  }

  if (stored.usedAt) {
    return { ok: false, reason: 'invalid_ticket' };
  }

  if (stored.expiresAt < new Date()) {
    return { ok: false, reason: 'invalid_ticket' };
  }

  if (!timingSafeStringEqual(stored.returnOrigin, returnOrigin)) {
    return { ok: false, reason: 'invalid_ticket' };
  }

  const claimed = await DeviceHubTicket.findOneAndUpdate(
    { _id: stored._id, usedAt: null },
    { $set: { usedAt: new Date() } },
    { new: true },
  );
  if (!claimed) {
    return { ok: false, reason: 'invalid_ticket' };
  }

  await deviceSessionService.getState(claimed.deviceId);
  const deviceSecret = await deviceSessionService.issueDeviceSecret(claimed.deviceId);
  if (!deviceSecret) {
    return { ok: false, reason: 'invalid_ticket' };
  }

  return { ok: true, deviceId: claimed.deviceId, deviceSecret };
}
