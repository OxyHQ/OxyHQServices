/**
 * `billing_transactions` — this platform's own record of money charged through
 * Stripe: one-time credit purchases and subscription invoices.
 *
 * Ported from `models/BillingTransaction.ts`. Distinct from `transactions`,
 * which is the internal FairCoin wallet ledger; the amounts here are currency
 * minor units, not FairCoin.
 *
 * ## `amount_minor_units`, not `amount`
 *
 * Every writer already puts minor units in it — `session.amount_total`
 * (`billing.ts:377`) and `plan.price` (`:441`, a literal `2999` for $29.99). An
 * integer count of minor units is exact by construction, so no `numeric` is
 * needed; it is `bigint` so a money column carries no ceiling a growing total
 * can silently hit. The name carries the unit because the failure mode of a
 * minor-unit column is a reader that divides by 100 twice, or not at all. The
 * wire contract is unaffected — the serializer emits `amount`.
 *
 * `credits` is a whole count of API credits, `bigint` for the same reason.
 *
 * Neither carries a `>= 0` CHECK: Mongoose declared no `min`, and a `refund` row
 * is exactly the shape that would legitimately be negative.
 *
 * ## The Stripe webhook idempotency index — preserved exactly
 *
 * `handleSubscriptionUpdate` grants a month of credits on renewal
 * (`billing.ts:427-463`) and Stripe retries webhooks, so the ONLY thing standing
 * between a retry and a double credit grant is the partial unique index below.
 * Mongo declared it as
 *
 *   { stripeSubscriptionId: 1, stripeSubscriptionPeriodStart: 1, type: 1 }
 *   partialFilterExpression: {
 *     type: 'subscription_payment',
 *     stripeSubscriptionId: { $exists: true },
 *     stripeSubscriptionPeriodStart: { $exists: true },
 *   }
 *
 * The predicate travels verbatim, but the two halves of it earn their place for
 * DIFFERENT reasons, and confusing them is how a "simplification" quietly
 * changes behaviour:
 *
 *   - `type = 'subscription_payment'` is SEMANTIC. Not because it stops a
 *     `credit_purchase` colliding with a renewal — `type` is an indexed COLUMN,
 *     so differing types already miss each other — but because it leaves rows of
 *     every OTHER type UNCONSTRAINED. Two `refund` rows against one subscription
 *     period are legitimate, and Mongo allowed them; drop this clause and the
 *     second one starts failing.
 *   - the two `is not null` clauses are Mongo's `$exists`, and in Postgres they
 *     are index-SIZE fidelity rather than semantics: a btree already treats
 *     NULLs as DISTINCT, so a row missing either column could never have
 *     collided. They keep every `credit_purchase` out of the index instead of
 *     carrying a useless entry per row.
 *
 * ## `ON DELETE RESTRICT`
 *
 * This is the audit trail of money this platform charged a person. Deleting the
 * account must not delete the invoice history: the record is what reconciles
 * against Stripe and against the books, and once it is gone there is no
 * recovering it from here. `user_id` is `required: true` in Mongoose, so the
 * retain-and-anonymize shape (`SET NULL`) is not available without weakening
 * the constraint for every live row — `RESTRICT` it is, and the erasure path has
 * to grow an explicit retention decision.
 */

import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, timestamptz, updatedAt } from './columns';
import { DEFAULT_BILLING_CURRENCY } from './billingSubscriptions';
import { users } from './users';

/** What was charged. */
export const BILLING_TRANSACTION_TYPES = [
  'credit_purchase',
  'subscription_payment',
  'refund',
] as const;

/** The type the idempotency index guards. */
export const SUBSCRIPTION_PAYMENT_TYPE = 'subscription_payment';

/** Lifecycle of the charge. */
export const BILLING_TRANSACTION_STATUSES = [
  'pending',
  'completed',
  'failed',
  'refunded',
] as const;

export const billingTransactions = pgTable(
  'billing_transactions',
  {
    id: generatedId(),
    /**
     * An untyped `String` in Mongoose — a logical reference to `User` that
     * nothing enforced. It is a real foreign key here. See the migration report
     * for the orphan audit this makes mandatory before the backfill.
     */
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    stripeCustomerId: text(),
    stripePaymentIntentId: text(),
    /**
     * Stripe's subscription id. Deliberately NOT a foreign key to
     * `billing_subscriptions.stripe_subscription_id`, even though that column is
     * unique — see `deferredForeignKeys.ts` for why a payment record must not
     * depend on the completeness of a local mirror.
     */
    stripeSubscriptionId: text(),
    /** The billing period this payment covers. Half of the idempotency key. */
    stripeSubscriptionPeriodStart: timestamptz(),
    type: text({ enum: BILLING_TRANSACTION_TYPES }).notNull(),
    /** Minor units of `currency` — 2999 is $29.99. See the header. */
    amountMinorUnits: bigint({ mode: 'number' }).notNull(),
    currency: text().notNull().default(DEFAULT_BILLING_CURRENCY),
    /** Whole API credits granted by this charge. */
    credits: bigint({ mode: 'number' }).notNull(),
    status: text({ enum: BILLING_TRANSACTION_STATUSES }).notNull().default('pending'),
    description: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Stripe webhook idempotency. Every clause of the predicate is load-bearing
    // — see the header.
    uniqueIndex('billing_transactions_subscription_period_key')
      .on(t.stripeSubscriptionId, t.stripeSubscriptionPeriodStart, t.type)
      .where(
        sql`${t.type} = ${sql.raw(`'${SUBSCRIPTION_PAYMENT_TYPE}'`)} and ${t.stripeSubscriptionId} is not null and ${t.stripeSubscriptionPeriodStart} is not null`
      ),
    // The transaction list: `find({userId}).sort({createdAt: -1})`
    // (`billing.ts:248`). Mongo declared this one AND a standalone `{userId}`;
    // the standalone is redundant, since a btree serves any leading prefix.
    index('billing_transactions_user_id_created_at_idx').on(t.userId, t.createdAt),
    // Mongo's `{stripeSubscriptionId: 1}` is DROPPED: the partial unique index
    // above already leads with that column. Its sparse `{stripePaymentIntentId}`
    // is dropped too — nothing reads this table by payment intent. See the
    // migration report for the separate finding that `handleCheckoutCompleted`
    // has no idempotency guard AT ALL on that column.

    check(
      'billing_transactions_type_check',
      sql`${t.type} in (${sql.raw(BILLING_TRANSACTION_TYPES.map((value) => `'${value}'`).join(', '))})`
    ),
    check(
      'billing_transactions_status_check',
      sql`${t.status} in (${sql.raw(BILLING_TRANSACTION_STATUSES.map((value) => `'${value}'`).join(', '))})`
    ),
  ]
);
