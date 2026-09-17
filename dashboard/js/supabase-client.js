/**
 * supabase-client.js
 * ---------------------------------------------------------------------
 * Reads transactions from Supabase (via the shared client set up in
 * auth.js). Writing edits back to Supabase happens in
 * transactions-api.js.
 * ---------------------------------------------------------------------
 */

// ============================================================
// TRANSACTIONS
// ============================================================

/**
 * Fetches every transaction from Supabase and merges in any manual
 * edits (renamed merchant, recategorised, corrected amount, hidden
 * flag) stored in the transactions_metadata table.
 *
 * @returns {Promise<Array<Object>>} transactions shaped for the
 *   dashboard: { id, date, merchant, category, amount, account, user, hidden }
 */
async function fetchTransactions() {
  const [transactionsResult, metadataResult] = await Promise.all([
    supabaseClient
      .from('transactions')
      .select('event_id, date, merchant, amount, account_id, user')
      .order('date', { ascending: true }),

    supabaseClient
      .from('transactions_metadata')
      .select('event_id, llm_merchant, llm_category, manual_merchant, manual_category, manual_amount, hidden'),
  ]);

  if (transactionsResult.error) {
    throw new Error(`Failed to load transactions: ${transactionsResult.error.message}`);
  }

  if (metadataResult.error) {
    throw new Error(`Failed to load transaction metadata: ${metadataResult.error.message}`);
  }

  const metadataByEventId = new Map(
    metadataResult.data.map((metadata) => [metadata.event_id, metadata])
  );

  return transactionsResult.data
    .map((transaction) => {
      const metadata = metadataByEventId.get(transaction.event_id) || {};

      const merchant = metadata.manual_merchant ?? metadata.llm_merchant ?? transaction.merchant;
      const category = metadata.manual_category ?? metadata.llm_category ?? 'other';
      const amount = metadata.manual_amount ?? transaction.amount;

      return {
        id: transaction.event_id,
        date: transaction.date,
        merchant,
        category: category || 'other',
        amount: Number(amount),
        account: String(transaction.account_id),
        user: transaction.user,
        hidden: metadata.hidden === true,
      };
    })
    .filter((transaction) => transaction.merchant !== 'Round up');
}
