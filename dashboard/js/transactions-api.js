/**
 * transactions-api.js
 * ---------------------------------------------------------------------
 * Writes edits made in the dashboard (category, merchant name, amount,
 * hide) back to Supabase. Each function updates the transactions_metadata
 * row for one transaction and throws on failure, so the caller can undo
 * its optimistic UI update (see table.js).
 * ---------------------------------------------------------------------
 */

/** Sets a transaction's category. */
async function updateTransactionCategory(transactionId, categoryId) {
  const { error } = await supabaseClient
    .from('transactions_metadata')
    .update({ manual_category: categoryId })
    .eq('event_id', transactionId);

  if (error) throw error;
}

/** Renames a transaction's merchant. */
async function updateTransactionMerchant(transactionId, merchant) {
  const { data, error } = await supabaseClient
    .from('transactions_metadata')
    .update({ manual_merchant: merchant })
    .eq('event_id', transactionId)
    .select('event_id');

  if (error) throw error;
  if (!data?.length) throw new Error(`No metadata row found for transaction ${transactionId}`);
}

/** Overrides a transaction's amount. */
async function updateTransactionAmount(transactionId, amount) {
  const { data, error } = await supabaseClient
    .from('transactions_metadata')
    .update({ manual_amount: amount })
    .eq('event_id', transactionId)
    .select('event_id');

  if (error) throw error;
  if (!data?.length) throw new Error(`No metadata row found for transaction ${transactionId}`);
}

/** Marks one or more transactions as hidden so they drop out of the dashboard. */
async function hideTransactions(transactionIds) {
  const { error } = await supabaseClient
    .from('transactions_metadata')
    .update({ hidden: true })
    .in('event_id', transactionIds);

  if (error) throw error;
}
