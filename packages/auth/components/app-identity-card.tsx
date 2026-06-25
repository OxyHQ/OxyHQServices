import { BadgeCheck, Check, ExternalLink, Globe, Shield } from "lucide-react";
import type { PublicApplication } from "@oxyhq/core";

import { Avatar } from "@oxyhq/bloom/avatar";
import { AuthFormHeader } from "@/components/auth-form-layout";
import { labelForScope } from "@/lib/scope-labels";

/**
 * Permissions every consent grant carries. OAuth code exchange currently issues
 * a normal Oxy user session rather than a token constrained to the requested
 * OAuth scopes, so the consent screen must always disclose this broad baseline
 * in addition to any friendly scope labels.
 */
const BASE_PERMISSION_LABELS: readonly string[] = [
  "Sign in with Oxy",
  "Access your account on your behalf",
];

/**
 * Treat an application as trusted/official when it is explicitly flagged
 * official OR classified as a first-party/internal Oxy application. Third-party
 * applications never qualify regardless of their other metadata.
 */
function isTrustedApplication(app: PublicApplication): boolean {
  return (
    app.isOfficial || app.type === "first_party" || app.type === "internal"
  );
}

/**
 * Resolve the final, human-readable permission lines to display.
 *
 * Explicit scopes (the OAuth `scope` URL param for the code flow, otherwise the
 * application's configured scope list) add friendly context, but they do not
 * narrow the session credentials issued by the backend today. Keep the broad
 * baseline visible for every grant so consent cannot imply a scope-limited
 * token.
 */
function resolveScopeLabels(scopes: readonly string[]): string[] {
  return [
    ...BASE_PERMISSION_LABELS,
    ...scopes.map(labelForScope).filter(
      (label) => !BASE_PERMISSION_LABELS.includes(label)
    ),
  ];
}

/**
 * Extract a clean, display-safe hostname from a website URL. Returns null when
 * the value is missing or not a parseable absolute URL so the caller can omit
 * the link entirely rather than render a broken anchor.
 */
function hostnameFor(websiteUrl?: string): string | null {
  if (!websiteUrl) return null;
  try {
    return new URL(websiteUrl).hostname;
  } catch {
    return null;
  }
}

type AppIdentityCardProps = {
  /** The resolved requesting application. */
  app: PublicApplication;
  /**
   * Explicit scopes to display, when known (e.g. the OAuth `scope` URL param,
   * space-separated and split by the caller). When empty, the card falls back
   * to the application's own configured `scopes`. The broad account-access
   * baseline is always shown because issued OAuth sessions are not scoped.
   */
  requestedScopes?: readonly string[];
};

/**
 * Consent-screen header that resolves and DISPLAYS the real requesting
 * application's identity: icon, name, trust presentation (official / internal /
 * third-party with developer + website), and the friendly list of requested
 * permissions. There is intentionally NO generic "This app" fallback — the
 * caller must pass a resolved {@link PublicApplication}; an unresolved request
 * is an error state handled upstream.
 */
export function AppIdentityCard({ app, requestedScopes }: AppIdentityCardProps) {
  const trusted = isTrustedApplication(app);
  // Prefer explicitly-requested scopes (OAuth flow) for the friendly scope
  // details, but always include the broad baseline in resolveScopeLabels because
  // the issued OAuth session credentials are not scope-limited.
  const effectiveScopes =
    requestedScopes && requestedScopes.length > 0
      ? requestedScopes
      : app.scopes;
  const permissionLabels = resolveScopeLabels(effectiveScopes);
  const website = hostnameFor(app.websiteUrl);

  return (
    <div className="flex flex-col gap-5">
      {/* App identity header */}
      <div className="flex flex-col items-center gap-3 text-center">
        <Avatar
          source={app.icon ?? undefined}
          name={app.name}
          size={56}
          verified={trusted}
          verifiedIcon={
            <BadgeCheck className="size-4 text-primary" aria-hidden />
          }
        />
        <AuthFormHeader
          title={`Continue to ${app.name}`}
          description={`${app.name} wants to access your Oxy account`}
        />
      </div>

      {/* Trust presentation */}
      {trusted ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
          <Shield className="size-4 text-primary shrink-0" aria-hidden />
          <span>
            {app.isInternal
              ? `${app.name} is an internal Oxy application.`
              : `${app.name} is an official Oxy application.`}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
          {app.developerName ? (
            <div className="text-muted-foreground">
              by <span className="text-foreground">{app.developerName}</span>
            </div>
          ) : null}
          {website && app.websiteUrl ? (
            <a
              href={app.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              <Globe className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{website}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          ) : null}
        </div>
      )}

      {/* Requested permissions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Shield className="size-4" aria-hidden />
          <span>This will allow {app.name} to:</span>
        </div>
        <ul className="space-y-2 pl-1">
          {permissionLabels.map((label) => (
            <li key={label} className="flex items-start gap-2.5 text-sm">
              <Check className="size-4 text-primary shrink-0 mt-0.5" aria-hidden />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
