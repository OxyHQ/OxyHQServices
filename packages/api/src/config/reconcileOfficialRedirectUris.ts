/**
 * Self-heal official Application redirect URIs when missing or drifted.
 *
 * Production drift blocks `POST /auth/oauth/authorize` with
 * "redirect_uri is not registered for this client", breaking password sign-in
 * hand-offs from every first-party app. Official apps declare a `websiteUrl`
 * whose origin is the canonical OAuth redirect surface.
 */

import mongoose from 'mongoose';
import { computeOfficialRedirectUriRepair } from '../utils/redirectUris';
import { logger } from '../utils/logger';
import { isTrustedApplication } from '../utils/trustedApplication';

export async function reconcileOfficialRedirectUris(): Promise<number> {
  if (mongoose.connection.readyState !== 1) {
    return 0;
  }

  const { Application } = await import('../models/Application.js');
  const apps = await Application.find({ status: 'active' })
    .select('name type isOfficial isInternal websiteUrl redirectUris');

  let repaired = 0;
  for (const app of apps) {
    if (!isTrustedApplication(app)) continue;

    const repairedUris = computeOfficialRedirectUriRepair(app.redirectUris, app.websiteUrl);
    if (!repairedUris) continue;

    app.redirectUris = repairedUris;
    await app.save();
    repaired += 1;
    logger.info('[reconcileOfficialRedirectUris] restored redirectUris', {
      name: app.name,
      redirectUris: repairedUris,
    });
  }

  return repaired;
}
