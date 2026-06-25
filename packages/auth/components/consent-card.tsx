import { Link } from "react-router-dom";
import { KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { getAccountDisplayName } from "@oxyhq/core";
import type { PublicApplication } from "@oxyhq/core";

import { Button } from "@oxyhq/bloom/button";
import { Avatar } from "@oxyhq/bloom/avatar";
import { ConnectionDots } from "@oxyhq/bloom/connection-dots";
import { BenefitList, BenefitRow } from "@oxyhq/bloom/benefit-list";
import { Logo } from "@/components/logo";
import { useTranslation } from "@/lib/i18n/use-translation";
import { getAvatarUrl } from "@/lib/oxy-api-client";

/** Minimal shape of the consenting user rendered in the identity badge. */
export type ConsentUser = {
  id: string;
  username?: string;
  email?: string;
  avatar?: string;
  displayName?: string;
  name?: {
    first?: string;
    last?: string;
  };
};

type ConsentCardProps = {
  /** The resolved requesting application (always present on this view). */
  application: PublicApplication;
  /** The account that will authorize the request, when known. */
  user: ConsentUser | null;
  /** Whether the approve/deny actions should be shown (pending + no error). */
  showActions: boolean;
  /** A blocking error message for the request, when present. */
  error: string | null;
  /** Human-readable request expiry, when known. */
  expiresAt: string | null;
  /** True while a decision request is in flight. */
  submitting: boolean;
  /** Approve / deny handler — wired to the unchanged IdP decision flow. */
  onDecision: (decision: "approve" | "deny") => void;
  /** Link target to re-authenticate / switch the active account. */
  loginUrl: string;
};

/**
 * Oxy Unified Design Language consent surface for the OAuth/device authorize
 * screen. This is a pure presentational component — it renders the resolved
 * application identity and the approve/deny affordances, and delegates every
 * decision back to {@link onDecision}. All IdP logic (session resolution,
 * redirect validation, code minting) lives in the parent page and is unchanged.
 *
 * Layout mirrors the "Connect account" reference:
 *   - `ConnectionDots` linking the requesting app's avatar to the Oxy logo
 *   - section title + centered subtitle
 *   - a `BenefitList` describing what an Oxy sign-in grants
 *   - the signed-in identity badge with a switch-account affordance
 *   - a primary full-width Continue button and a caption-sized disclaimer
 */
export function ConsentCard({
  application,
  user,
  showActions,
  error,
  expiresAt,
  submitting,
  onDecision,
  loginUrl,
}: ConsentCardProps) {
  const { t } = useTranslation();
  const appName = application.name;
  const displayName = user ? getAccountDisplayName(user) : null;
  const userEmail = user?.email;

  return (
    <div className="flex flex-col gap-space-24">
      {/* Header: app ↔ Oxy connection band */}
      <div className="flex flex-col items-center gap-space-20">
        <ConnectionDots
          accessibilityLabel={t("authorize.title", { app: appName })}
          left={
            <Avatar
              source={application.icon ?? undefined}
              name={appName}
              size={56}
            />
          }
          right={
            <span className="flex size-14 items-center justify-center rounded-radius-max bg-fill-secondary">
              <Logo className="h-8 w-8" />
            </span>
          }
        />

        <div className="flex flex-col items-center gap-space-8 text-center">
          <h1 className="font-sectionTitle text-sectionTitle text-text">
            {t("authorize.title", { app: appName })}
          </h1>
          <p className="font-bodySmall text-bodySmall text-text-tertiary max-w-[34ch]">
            {t("authorize.subtitle", { app: appName })}
          </p>
        </div>
      </div>

      {/* What authorizing means for an Oxy login */}
      <BenefitList accessibilityLabel={t("authorize.title", { app: appName })}>
        <BenefitRow
          icon={<ShieldCheck className="size-4 text-fill-brand" aria-hidden />}
          label={t("authorize.benefits.secure")}
        />
        <BenefitRow
          icon={<KeyRound className="size-4 text-fill-brand" aria-hidden />}
          label={t("authorize.benefits.oneAccount")}
        />
        <BenefitRow
          icon={<RefreshCw className="size-4 text-fill-brand" aria-hidden />}
          label={t("authorize.benefits.youControl")}
        />
      </BenefitList>

      {/* Signed-in identity + switch-account affordance */}
      {user ? (
        <div className="flex items-center gap-space-12 rounded-radius-20 border border-border-image bg-fill p-space-12 shadow-s">
          <Avatar
            source={user.avatar ? getAvatarUrl(user.avatar) : undefined}
            name={displayName ?? undefined}
            size={40}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bodyTitleSmall text-bodyTitleSmall text-text">
              {displayName}
            </div>
            {userEmail ? (
              <div className="truncate font-bodySmall text-bodySmall text-text-tertiary">
                {userEmail}
              </div>
            ) : null}
          </div>
          <Link
            to={loginUrl}
            className="shrink-0 font-bodySmall text-bodySmall text-text-tertiary underline underline-offset-2 hover:text-text"
          >
            {t("authorize.notYou")}
          </Link>
        </div>
      ) : null}

      {/* Blocking error */}
      {error ? (
        <div className="rounded-radius-12 border border-destructive/50 bg-destructive/10 p-space-12 font-bodySmall text-bodySmall text-destructive">
          {error}
        </div>
      ) : null}

      {/* Decision actions */}
      {showActions ? (
        <div className="flex flex-col gap-space-12">
          <Button
            size="lg"
            fullWidth
            disabled={submitting}
            loading={submitting}
            onClick={() => onDecision("approve")}
          >
            {t("authorize.continue", { app: appName })}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            disabled={submitting}
            onClick={() => onDecision("deny")}
          >
            {t("authorize.cancel")}
          </Button>

          <p className="px-space-4 text-center font-caption text-caption text-text-tertiary">
            {t("authorize.disclaimer", { app: appName })}
          </p>

          {expiresAt ? (
            <p className="text-center font-caption text-caption text-text-tertiary">
              {t("authorize.expiresAt", { time: expiresAt })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
