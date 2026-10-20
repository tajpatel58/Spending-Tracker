/**
 * transactions-api.js
 * ---------------------------------------------------------------------
 * Writes edits made in the dashboard (category, merchant name, amount,
 * date, hide) back to Supabase. Each function updates the transactions_metadata
 * row for one transaction and throws on failure, so the caller can undo
 * its optimistic UI update (see table.js).
 * ---------------------------------------------------------------------
 */

import { supabaseClient } from './auth.js';

/** Sets a transaction's category. */
export async function updateTransactionCategory(transactionId, categoryId) {
  const { error } = await supabaseClient
    .from('transactions_metadata')
    .update({ manual_category: categoryId })
    .eq('event_id', transactionId);

  if (error) throw error;
}

/** Renames a transaction's merchant. */
export async function updateTransactionMerchant(transactionId, merchant) {
  const { data, error } = await supabaseClient
    .from('transactions_metadata')
    .update({ manual_merchant: merchant })
    .eq('event_id', transactionId)
    .select('event_id');

  if (error) throw error;
  if (!data?.length) throw new Error(`No metadata row found for transaction ${transactionId}`);
}

/** Overrides a transaction's amount. */
export async function updateTransactionAmount(transactionId, amount) {
  const { data, error } = await supabaseClient
    .from('transactions_metadata')
    .update({ manual_amount: amount })
    .eq('event_id', transactionId)
    .select('event_id');

  if (error) throw error;
  if (!data?.length) throw new Error(`No metadata row found for transaction ${transactionId}`);
}

/**
 * Overrides a transaction's date ('YYYY-MM-DD'). Passing null clears the
 * override so the bank's original date is used again.
 */
export async function updateTransactionDate(transactionId, date) {
  const { data, error } = await supabaseClient
    .from('transactions_metadata')
    .update({ manual_date: date })
    .eq('event_id', transactionId)
    .select('event_id');

  if (error) throw error;
  if (!data?.length) throw new Error(`No metadata row found for transaction ${transactionId}`);
}

/** Marks one or more transactions as hidden so they drop out of the dashboard. */
export async function hideTransactions(transactionIds) {
  const { error } = await supabaseClient
    .from('transactions_metadata')
    .update({ hidden: true })
    .in('event_id', transactionIds);

  if (error) throw error;
}

/** Brings hidden transactions back (used by Undo after hiding). */
export async function unhideTransactions(transactionIds) {
  const { error } = await supabaseClient
    .from('transactions_metadata')
    .update({ hidden: false })
    .in('event_id', transactionIds);

  if (error) throw error;
}
