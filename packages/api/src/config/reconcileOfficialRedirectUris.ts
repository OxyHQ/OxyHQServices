/**
 * Self-heal official Application redirect URIs when missing or drifted.
 *
 * Production drift blocks `POST /auth/oauth/authorize` with
 * "redirect_uri is not registered for this client", breaking password sign-in
 * hand-offs from every first-party app. Official apps declare a `websiteUrl`
 * whose origin is the canonical OAuth redirect surface.
 */

import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import { isTrustedApplication } from '../utils/trustedApplication';

function originOfWebsiteUrl(websiteUrl: string): string | null {
  try {
    return new URL(websiteUrl.trim()).origin;
  } catch {
    return null;
  }
}

/** Exact-match helper — redirect URIs are compared literally, not by prefix. */
function includesRedirectUri(allowlist: string[] | undefined, origin: string): boolean {
  if (!allowlist?.length) return false;
  return allowlist.some((entry) => entry === origin);
}

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

    const websiteUrl = app.websiteUrl?.trim();
    if (!websiteUrl) continue;

    const origin = originOfWebsiteUrl(websiteUrl);
    if (!origin) {
      logger.warn('[reconcileOfficialRedirectUris] invalid websiteUrl', {
        name: app.name,
        websiteUrl,
      });
      continue;
    }

    if (includesRedirectUri(app.redirectUris, origin)) continue;

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
