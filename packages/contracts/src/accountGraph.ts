/**
 * Account graph wire contracts — the account-kind vocabulary, organization
 * taxonomy, and create-account input.
 *
 * `organizationCategory` classifies `kind: 'organization'` accounts (agency,
 * cooperative, landlord, …) without polluting `User.kind`. Meaningful only when
 * `kind === 'organization'`.
 */

import { z } from 'zod';

/**
 * Account-graph classification — the ONE authority for the kind vocabulary.
 *
 * `personal` is the only kind minted by signup and the only one that carries
 * its own credentials; every other kind is a child account created under a
 * parent and operated through `account_members`. The API schema, the Mongoose
 * model and the SDK all derive from this list rather than restating it, so a
 * new kind is one edit here instead of four literals that can drift.
 */
export type AccountKind = 'personal' | 'organization' | 'project' | 'bot' | 'channel';

/**
 * The union is spelled out above and the array proves coverage BOTH ways
 * (`satisfies` here, the `Gap` alias below) — the same shape this package's
 * `ORGANIZATION_CATEGORIES` / `TRUST_TIERS` pairs use, and the one
 * `db/schema/users.ts` mirrors to keep the `users_kind_check` CHECK honest.
 *
 * Deriving the union from the array instead would cost nothing here and be paid
 * by consumers: `kind` travels into `@oxyhq/services` through
 * `SwitchableAccount`, where an indexed-access type is materially more
 * expensive to check than a literal union.
 */
export const ACCOUNT_KINDS = [
  'personal',
  'organization',
  'project',
  'bot',
  'channel',
] as const satisfies readonly AccountKind[];

/** `never` while `ACCOUNT_KINDS` covers the union. */
export type AccountKindGap = Exclude<AccountKind, (typeof ACCOUNT_KINDS)[number]>;

export const accountKindSchema = z.enum(ACCOUNT_KINDS);

/**
 * Kinds that may be CREATED as children of another account. Exactly
 * `ACCOUNT_KINDS` minus `personal`, which is always a tree root.
 */
export type ChildAccountKind = Exclude<AccountKind, 'personal'>;

export const CHILD_ACCOUNT_KINDS = [
  'organization',
  'project',
  'bot',
  'channel',
] as const satisfies readonly ChildAccountKind[];

/** `never` while `CHILD_ACCOUNT_KINDS` covers the child union. */
export type ChildAccountKindGap = Exclude<
  ChildAccountKind,
  (typeof CHILD_ACCOUNT_KINDS)[number]
>;

export const childAccountKindSchema = z.enum(CHILD_ACCOUNT_KINDS);

/**
 * Whether an operator may ACT AS an account of this kind — switch the whole app
 * into it (`POST /accounts/:id/switch`) or authorise an app to act as it
 * (an OAuth delegated subject).
 *
 * Two kinds are refused, for opposite reasons:
 *
 *  - `personal` is a human login, so assuming it would be impersonation.
 *  - `channel` is a CONTENT identity, not an operating one. A channel exists so
 *    that posts can be authored BY it; it is never a seat anybody occupies. Its
 *    operators act on it through their own membership, and an application
 *    publishes to it with its own credential. Refusing act-as is what makes
 *    "no login, ever" structural rather than incidental: no session can be
 *    minted whose subject is a channel, so no bearer exists that could add an
 *    auth method to one (every auth-method write resolves its target from the
 *    authenticated subject, never from a parameter).
 *
 * Consumers must gate on this predicate rather than testing `kind === 'personal'`,
 * which silently admits every kind added after it was written.
 */
export function isActAsEligibleKind(kind: AccountKind | null | undefined): boolean {
  return kind === 'organization' || kind === 'project' || kind === 'bot';
}

/**
 * Narrow an unknown value to an {@link AccountKind}.
 *
 * The user-DTO serializers read from structurally-permissive `unknown` sources
 * (a Drizzle row, a Mongo document, an already-formatted object), so each one
 * would otherwise hand-roll this check and they would drift on what counts.
 */
export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(value);
}

export const ORGANIZATION_CATEGORIES = [
  'agency',
  'cooperative',
  'landlord',
  'other',
] as const;

export type OrganizationCategory = (typeof ORGANIZATION_CATEGORIES)[number];

export const organizationCategorySchema = z.enum(ORGANIZATION_CATEGORIES);

/**
 * An account's name on the create/update wire.
 *
 * `displayName` is EXPLICIT and stored, not derived. `first`/`last` model a
 * human name, and composing a display string from them is right for a person —
 * but a non-personal account has a TITLE, not a given and family name. Without
 * this field the only way to name a channel "Notas de Nate" was to put the whole
 * title in `first`, which renders correctly by accident while recording it as
 * somebody's given name.
 *
 * When present it wins over the composed `first`/`last` (see the API's
 * `composeDisplayName`, which already preferred an explicit value — only the
 * storage for one was missing).
 */
const accountNameSchema = z
  .object({
    first: z.string().trim().max(100).optional(),
    last: z.string().trim().max(100).optional(),
    displayName: z.string().trim().max(100).optional(),
  })
  .optional();

/**
 * POST /accounts — create a non-personal account under the caller's tree.
 * `organizationCategory` is accepted only when `kind` is `organization`.
 */
export const createAccountRequestSchema = z
  .object({
    parentAccountId: z.string().trim().min(1).optional(),
    kind: childAccountKindSchema,
    username: z.string().trim().min(1).max(100),
    name: accountNameSchema,
    bio: z.string().trim().max(500).optional(),
    avatar: z.string().optional(),
    description: z.string().trim().max(1000).optional(),
    organizationCategory: organizationCategorySchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.organizationCategory !== undefined && data.kind !== 'organization') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'organizationCategory applies only when kind is organization',
        path: ['organizationCategory'],
      });
    }
  });

export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;
