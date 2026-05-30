/**
 * Pure formatting helpers for payment / wallet display.
 *
 * Kept framework-free so they can be unit-tested in isolation and reused by
 * the payments screen subcomponents.
 */

/** FairCoin currency glyph shown before balances and amounts. */
export const FAIRCOIN_SYMBOL = '⊜';

/**
 * Format a FairCoin balance with the currency glyph and two decimal places.
 *
 * @example formatFairCoinBalance(12.5) // '⊜ 12.50'
 */
export function formatFairCoinBalance(balance: number): string {
  return `${FAIRCOIN_SYMBOL} ${balance.toFixed(2)}`;
}

/**
 * Wallet transaction directions that increase the user's balance. Used to pick
 * the credit (vs. debit) styling and sign for a ledger row.
 */
const CREDIT_TRANSACTION_TYPES = new Set(['credit', 'deposit', 'refund']);

/**
 * Whether a wallet-transaction type represents an inflow (credit) rather than
 * an outflow (debit). Matching is case-insensitive.
 */
export function isCreditTransaction(type: string | undefined): boolean {
  if (!type) return false;
  return CREDIT_TRANSACTION_TYPES.has(type.toLowerCase());
}
