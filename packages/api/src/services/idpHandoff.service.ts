/**
 * IdP handoff codes — one-shot transfer of device session context to auth.oxy.so.
 */

import * as crypto from 'crypto';
import { Types } from 'mongoose';
import IdpHandoffCode, { type IIdpHandoffCode } from '../models/IdpHandoffCode';
import { base64UrlEncode, sha256Hex } from './oauthCode.service';

export const IDP_HANDOFF_TTL_MS = 30 * 1000;
export const IDP_HANDOFF_BYTES = 32;

export interface CreateIdpHandoffOptions {
  deviceId: string;
  sessionId: string;
  userId: string;
  ttlMs?: number;
}

export interface CreateIdpHandoffResult {
  handoffCode: string;
  expiresAt: Date;
}

export async function createIdpHandoffCode(
  options: CreateIdpHandoffOptions,
): Promise<CreateIdpHandoffResult> {
  const ttlMs = options.ttlMs ?? IDP_HANDOFF_TTL_MS;
  const rawCode = base64UrlEncode(crypto.randomBytes(IDP_HANDOFF_BYTES));
  const codeHash = sha256Hex(rawCode);
  const expiresAt = new Date(Date.now() + ttlMs);

  await IdpHandoffCode.create({
    codeHash,
    deviceId: options.deviceId,
    sessionId: options.sessionId,
    userId: options.userId,
    expiresAt,
  });

  return { handoffCode: rawCode, expiresAt };
}

export type ExchangeIdpHandoffOutcome =
  | { ok: true; record: IIdpHandoffCode }
  | { ok: false; reason: 'invalid_handoff' };

export async function exchangeIdpHandoffCode(rawCode: string): Promise<ExchangeIdpHandoffOutcome> {
  const codeHash = sha256Hex(rawCode);
  const stored = await IdpHandoffCode.findOne({ codeHash });

  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    return { ok: false, reason: 'invalid_handoff' };
  }

  const claimed = await IdpHandoffCode.findOneAndUpdate(
    { _id: stored._id, usedAt: null },
    { $set: { usedAt: new Date() } },
    { new: true },
  );

  if (!claimed) {
    return { ok: false, reason: 'invalid_handoff' };
  }

  return { ok: true, record: claimed };
}
