/**
 * Application / credential scope vocabulary and the pure authorisation helpers
 * that operate on it.
 *
 * This module is intentionally DEPENDENCY-FREE (no Mongoose, no DB) so the scope
 * logic can be imported and unit-tested without loading a model. The
 * `Application` Mongoose schema imports `APPLICATION_SCOPES` from here for its
 * enum; the application routes and the service-token mint import the helpers.
 */

/**
 * Allowed OAuth scopes for an Application.
 * - `federation:write` permits internal services to sign HTTP-Signatures as, and
 *   resolve/mutate, federated users (`routes/federation.ts`, `PUT /users/resolve`)
 *   for federation/agent/automation flows. PRIVILEGED — see
 *   {@link PRIVILEGED_APPLICATION_SCOPES}; only Oxy platform staff may grant it.
 * - `reputation:write` permits service credentials to create reputation ledger
 *   awards/penalties for arbitrary users. PRIVILEGED — only Oxy platform staff
 *   may grant it.
 */
export const APPLICATION_SCOPES = [
  'files:read',
  'files:write',
  'files:delete',
  'user:read',
  'webhooks:receive',
  'chat:completions',
  'models:read',
  'federation:write',
  'signals:write',
  'reputation:write',
] as const;

export type ApplicationScope = (typeof APPLICATION_SCOPES)[number];

/**
 * Scopes that confer cross-tenant / act-on-behalf authority and therefore MUST
 * NOT be self-grantable by an ordinary application owner. They may only be added
 * to an Application's `scopes` by Oxy platform staff (`User.isStaff === true`),
 * mirroring how `type` / `isOfficial` / `isInternal` / `capabilities` are
 * staff-gated on the application update path.
 *
 * - `federation:write` lets a service credential sign HTTP-Signatures as, and
 *   resolve/mutate, ARBITRARY federated users. A self-granting owner could
 *   otherwise register an app with a victim domain's redirectUri and impersonate
 *   that domain's users.
 * - `reputation:write` lets a service credential mutate the global reputation
 *   ledger for arbitrary users. A self-granting owner could otherwise inflate or
 *   penalise trust tiers outside its own tenant.
 *
 * All other scopes in {@link APPLICATION_SCOPES} authorise an app only over its
 * OWN resources (files, models, webhooks, public user reads) and remain freely
 * self-grantable. Keep this set CONSERVATIVE — add a scope here only when it
 * grants authority beyond the app's own tenant.
 */
export const PRIVILEGED_APPLICATION_SCOPES = [
  'federation:write',
  'reputation:write',
] as const satisfies readonly ApplicationScope[];

const PRIVILEGED_APPLICATION_SCOPE_SET: ReadonlySet<ApplicationScope> = new Set<ApplicationScope>(
  PRIVILEGED_APPLICATION_SCOPES
);

const APPLICATION_SCOPE_SET: ReadonlySet<string> = new Set<string>(APPLICATION_SCOPES);

/** True when `scope` is a recognised application scope. */
export function isValidApplicationScope(scope: string): scope is ApplicationScope {
  return APPLICATION_SCOPE_SET.has(scope);
}

/** True when `scope` is one of the staff-only privileged scopes. */
export function isPrivilegedScope(scope: string): scope is ApplicationScope {
  return PRIVILEGED_APPLICATION_SCOPE_SET.has(scope as ApplicationScope);
}

/**
 * Effective scopes for a credential = credential scopes ∩ application scopes,
 * preserving the credential's order and dropping unknown scopes. A credential
 * can never exceed the authority granted to its owning application: if the app
 * loses a scope, every credential loses it too at the next token mint. This is
 * the single authority used by both the credential-create validation and the
 * service-token mint, so the two paths cannot drift.
 */
export function intersectScopes(
  credentialScopes: readonly string[],
  appScopes: readonly string[]
): ApplicationScope[] {
  const granted = new Set<string>(appScopes);
  const result: ApplicationScope[] = [];
  const seen = new Set<string>();
  for (const scope of credentialScopes) {
    if (!granted.has(scope) || seen.has(scope)) continue;
    if (!isValidApplicationScope(scope)) continue;
    seen.add(scope);
    result.push(scope);
  }
  return result;
}
