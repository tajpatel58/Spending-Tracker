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
/**
 * Returns the dashboard category id for a stored category, or null when
 * it's missing or not one of CATEGORIES (e.g. an LLM answer of 'unknown').
 * Callers fall back to 'other', which the dashboard shows as "Unassigned".
 */
function normalizeCategory(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return CATEGORIES.some((c) => c.id === id) ? id : null;
}

async function fetchTransactions() {
  console.info('[Ledger data] Requesting transactions and transaction metadata from Supabase');
  const [transactionsResult, metadataResult] = await Promise.all([
    supabaseClient
      .from('transactions')
      .select('event_id, date, merchant, amount, account_id, user')
      .order('date', { ascending: true }),

    supabaseClient
      .from('transactions_metadata')
      .select('event_id, llm_merchant, llm_category, manual_merchant, manual_category, manual_amount, manual_date, hidden'),
  ]);

  if (transactionsResult.error) {
    console.error('[Ledger data] Transaction request failed:', transactionsResult.error);
    throw new Error(`Failed to load transactions: ${transactionsResult.error.message}`);
  }

  if (metadataResult.error) {
    console.error('[Ledger data] Transaction metadata request failed:', metadataResult.error);
    throw new Error(`Failed to load transaction metadata: ${metadataResult.error.message}`);
  }

  console.info('[Ledger data] Supabase responses received', {
    transactionRowCount: transactionsResult.data.length,
    metadataRowCount: metadataResult.data.length,
    transactionRows: transactionsResult.data,
    metadataRows: metadataResult.data,
  });

  const metadataByEventId = new Map(
    metadataResult.data.map((metadata) => [metadata.event_id, metadata])
  );

  const transactions = transactionsResult.data
    .map((transaction) => {
      const metadata = metadataByEventId.get(transaction.event_id) || {};

      const merchant = metadata.manual_merchant ?? metadata.llm_merchant ?? transaction.merchant;
      const category = normalizeCategory(metadata.manual_category) ?? normalizeCategory(metadata.llm_category) ?? 'other';
      const amount = metadata.manual_amount ?? transaction.amount;
      // A manual date (e.g. lined up with a calendar event) wins over the bank's date.
      const date = metadata.manual_date ?? transaction.date;

      return {
        id: transaction.event_id,
        date,
        originalDate: transaction.date,
        merchant,
        category,
        amount: Number(amount),
        account: String(transaction.account_id),
        user: transaction.user,
        hidden: metadata.hidden === true,
      };
    })
    .filter((transaction) => transaction.merchant !== 'Round up');

  console.info('[Ledger data] Transactions normalized', {
    usableTransactionCount: transactions.length,
    roundUpTransactionsFiltered: transactionsResult.data.length - transactions.length,
  });

  return transactions;
}
