/**
 * supabase-client.js
 * ---------------------------------------------------------------------
 * Connects to Supabase (using the credentials from config.js) and reads
 * transactions from it. Writing edits back to Supabase happens in
 * transactions-api.js.
 * ---------------------------------------------------------------------
 */

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// AUTHENTICATION
// ============================================================

/**
 * Checks whether the browser already has a logged-in Supabase session
 * and logs the result to the console.
 */
async function initializeAuth() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error('[Ledger auth] Session check failed:', error);
    return null;
  }

  if (!data.session) {
    console.log('[Ledger auth] No active session');
    return null;
  }

  console.log('[Ledger auth] Active session:', data.session.user.email);
  return data.session;
}

// Checks the existing session once when the page loads.
// Other scripts can `await authReady` if they need to know it has run.
const authReady = initializeAuth();

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
