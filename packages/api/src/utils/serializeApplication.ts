import type { IApplication, ApplicationType } from '../models/Application';

/**
 * Public, sanitized projection of an {@link IApplication} suitable for the
 * unauthenticated auth-web consent UI.
 *
 * This is the ONLY shape that may be returned to a relying-party / browser
 * consent screen. It deliberately omits every sensitive or internal field —
 * `webhookSecret`, `webhookUrl`, `createdByUserId`, `capabilities`, redirect
 * URIs, timestamps, etc. — so leaking it cannot disclose secrets or operator
 * identity beyond a best-effort display name for non-official apps.
 */
export interface PublicApplication {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  websiteUrl?: string;
  type: ApplicationType;
  isOfficial: boolean;
  isInternal: boolean;
  scopes: string[];
  /**
   * Best-effort display name of the application's owner. ONLY included for
   * non-official applications (official/first-party apps speak for the
   * platform and do not surface a third-party developer attribution).
   */
  developerName?: string;
}

/**
 * Build the sanitized public view of an application.
 *
 * @param app           the resolved Application document
 * @param developerName best-effort owner display name. The caller is
 *                      responsible for fetching it (the serializer never hits
 *                      the database). Only attached for non-official apps.
 *
 * Undefined optional fields are omitted entirely rather than serialized as
 * `null`/`undefined`, keeping the payload tight for the consent UI.
 */
export function serializePublicApplication(
  app: Pick<
    IApplication,
    | '_id'
    | 'name'
    | 'description'
    | 'icon'
    | 'websiteUrl'
    | 'type'
    | 'isOfficial'
    | 'isInternal'
    | 'scopes'
  >,
  developerName?: string
): PublicApplication {
  const result: PublicApplication = {
    id: app._id.toString(),
    name: app.name,
    type: app.type,
    isOfficial: app.isOfficial,
    isInternal: app.isInternal,
    scopes: Array.isArray(app.scopes) ? [...app.scopes] : [],
  };

  if (app.description !== undefined && app.description !== null) {
    result.description = app.description;
  }
  if (app.icon !== undefined && app.icon !== null) {
    result.icon = app.icon;
  }
  if (app.websiteUrl !== undefined && app.websiteUrl !== null) {
    result.websiteUrl = app.websiteUrl;
  }

  // Developer attribution is only meaningful for non-official apps, and only
  // when the caller could resolve a name.
  if (!app.isOfficial && developerName !== undefined && developerName !== null && developerName !== '') {
    result.developerName = developerName;
  }

  return result;
}
