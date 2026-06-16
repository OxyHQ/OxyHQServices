import type { TrustTier } from '@oxyhq/core';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Default English labels for each trust tier, used as i18n fallbacks. */
const TRUST_TIER_FALLBACK: Record<TrustTier, string> = {
    new: 'New',
    trusted: 'Trusted',
    high_trust: 'High Trust',
    verified: 'Verified',
    restricted: 'Restricted',
};

/**
 * Resolve a human-readable label for a trust tier, preferring the localized
 * `trust.tiers.<tier>` key and falling back to the canonical English label.
 */
export function getTrustTierLabel(tier: TrustTier, t: Translate): string {
    return t(`trust.tiers.${tier}`) || TRUST_TIER_FALLBACK[tier];
}
