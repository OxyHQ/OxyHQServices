/**
 * Self-heal official Application redirect URIs when `redirectUris` is empty.
 *
 * Production drift (empty allowlist) blocks `POST /auth/oauth/authorize` with
 * "redirect_uri is not registered for this client", breaking password sign-in
 * hand-offs from every first-party app. Official apps always declare a
 * `websiteUrl`; its origin is the canonical OAuth redirect surface.
 */

import mongoose from 'mongoose';
import { logger } from '../utils/logger';

export async function reconcileOfficialRedirectUris(): Promise<number> {
  if (mongoose.connection.readyState !== 1) {
    return 0;
  }

  const { Application } = await import('../models/Application.js');
  const candidates = await Application.find({
    status: 'active',
    isOfficial: true,
    websiteUrl: { $exists: true, $ne: '' },
    $or: [{ redirectUris: { $exists: false } }, { redirectUris: { $size: 0 } }],
  }).select('name websiteUrl redirectUris');

  let repaired = 0;
  for (const app of candidates) {
    const websiteUrl = app.websiteUrl?.trim();
    if (!websiteUrl) continue;
    let origin: string;
    try {
      origin = new URL(websiteUrl).origin;
    } catch {
      logger.warn('[reconcileOfficialRedirectUris] invalid websiteUrl', {
        name: app.name,
        websiteUrl,
      });
      continue;
    }
    app.redirectUris = [origin];
    await app.save();
    repaired += 1;
    logger.info('[reconcileOfficialRedirectUris] restored redirectUris', {
      name: app.name,
      redirectUris: [origin],
    });
  }

  return repaired;
}
