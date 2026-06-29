/**
 * Simple utility to format user objects for API responses.
 * Returns clean, explicit user object with id (MongoDB ObjectId) and publicKey as separate fields.
 */

import { formatUserNameResponse, type NameParts } from './displayName';

type StringableId = string | { toString(): string };

export type UserLike = {
  _id?: StringableId | null;
  publicKey?: string;
  username?: string;
  email?: string;
  avatar?: string | null;
  color?: string | null;
  name?: NameParts;
  privacySettings?: unknown;
  verified?: boolean;
  language?: string;
  bio?: string;
  description?: string;
  locations?: unknown;
  links?: unknown;
  linksMetadata?: unknown;
  verifiedDomains?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
} | null | undefined;

/** A proven-domain badge as emitted on the user DTO (secret-free, no subdoc _id). */
interface VerifiedDomainDto {
  domain: string;
  verifiedAt: Date | string;
  method: 'dns-txt' | 'well-known';
}

function toVerifiedDomains(value: unknown): VerifiedDomainDto[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const domains: VerifiedDomainDto[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const domain = stringValue(entry.domain);
    const method = stringValue(entry.method);
    const verifiedAt = entry.verifiedAt;
    if (!domain || (method !== 'dns-txt' && method !== 'well-known')) continue;
    if (!(verifiedAt instanceof Date) && typeof verifiedAt !== 'string') continue;
    domains.push({ domain, verifiedAt, method });
  }
  return domains;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function toStringableId(value: unknown): StringableId | undefined {
  if (typeof value === 'string') return value;
  return isRecord(value) && typeof value.toString === 'function'
    ? { toString: () => value.toString() }
    : undefined;
}

function toNameParts(value: unknown): NameParts | undefined {
  if (!isRecord(value)) return undefined;
  return {
    first: stringValue(value.first),
    last: stringValue(value.last),
    full: stringValue(value.full),
    displayName: stringValue(value.displayName),
  };
}

/**
 * Format user object for API response.
 * id = MongoDB ObjectId (_id.toString())
 * publicKey = separate field for authentication
 *
 * Self-sufficient name composition: the returned `name.full` is composed
 * whether or not the source document was loaded with Mongoose virtuals, and
 * `name.displayName` is present ONLY when the user has a real name (omitted for
 * username-only / publicKey-only accounts — consumers fall back to the handle).
 * This is the canonical producer of the `@oxyhq/core` `userResponseSchema`
 * contract — the api `userTransform.contract.test.ts` locks the output to that
 * schema so the producer cannot silently drift from it again.
 */
export function formatUserResponse(user: unknown) {
  if (!isRecord(user)) {
    return null;
  }

  const rawId = toStringableId(user._id);
  const userId = rawId?.toString();
  if (!userId) {
    return null;
  }

  const name = formatUserNameResponse({
    name: toNameParts(user.name),
    username: stringValue(user.username),
    publicKey: stringValue(user.publicKey),
  });

  return {
    id: userId,
    publicKey: stringValue(user.publicKey),
    username: stringValue(user.username),
    email: stringValue(user.email),
    avatar: stringValue(user.avatar),
    color: stringValue(user.color),
    name,
    privacySettings: user.privacySettings,
    verified: booleanValue(user.verified),
    language: stringValue(user.language),
    bio: stringValue(user.bio),
    description: stringValue(user.description),
    locations: Array.isArray(user.locations) ? user.locations : undefined,
    links: Array.isArray(user.links) ? user.links.filter((link): link is string => typeof link === 'string') : undefined,
    linksMetadata: Array.isArray(user.linksMetadata) ? user.linksMetadata : undefined,
    verifiedDomains: toVerifiedDomains(user.verifiedDomains),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
