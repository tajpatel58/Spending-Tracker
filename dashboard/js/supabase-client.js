/**
 * supabase-client.js
 * ---------------------------------------------------------------------
 * Reads transactions from Supabase (via the shared client set up in
 * auth.js). Writing edits back to Supabase happens in
 * transactions-api.js.
 * ---------------------------------------------------------------------
 */

import { supabaseClient } from './auth.js';
import { CATEGORIES } from './data.js';

// ============================================================
// PAGING
// ============================================================

/**
 * Supabase's API returns at most 1,000 rows per request (the project's
 * "Max rows" setting), silently dropping the rest. This reads every row:
 * the first page also asks for the exact total, then the remaining pages
 * are requested together, each the size the server actually returned.
 *
 *   build(options) -> a fresh query (select + a stable order), e.g.
 *     (o) => supabaseClient.from('t').select('id, x', o).order('id')
 *   options is { count: 'exact' } for the first page, undefined after.
 *
 * Resolves to { data, error }, like a single Supabase query.
 */
const PAGE_SIZE = 1000;
async function fetchAllRows(build) {
  const first = await build({ count: 'exact' }).range(0, PAGE_SIZE - 1);
  if (first.error) return first;
  const rows = first.data || [];
  const total = first.count ?? rows.length;
  if (!rows.length || rows.length >= total) return { data: rows, error: null };

  const step = rows.length; // the server's real page size, if it's below PAGE_SIZE
  const pages = [];
  for (let from = rows.length; from < total; from += step) pages.push(build().range(from, from + step - 1));
  const results = await Promise.all(pages);
  const failed = results.find((result) => result.error);
  if (failed) return { data: null, error: failed.error };
  return { data: rows.concat(...results.map((result) => result.data || [])), error: null };
}

// ============================================================
// TRANSACTIONS
// ============================================================

/**
 * Returns the dashboard category id for a stored category, or null when
 * it's missing or not one of CATEGORIES (e.g. an LLM answer of 'unknown').
 * Callers fall back to 'other', which the dashboard shows as "Unassigned".
 */
function normalizeCategory(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return CATEGORIES.some((c) => c.id === id) ? id : null;
}

/**
 * Fetches every transaction from Supabase and merges in any manual
 * edits (renamed merchant, recategorised, corrected amount, hidden
 * flag) stored in the transactions_metadata table.
 *
 * @returns {Promise<Array<Object>>} transactions shaped for the
 *   dashboard: { id, date, merchant, category, amount, account, user, hidden }
 */
export async function fetchTransactions() {
  // event_id breaks ties between same-day rows, so pages never overlap or skip.
  const [transactionsResult, metadataResult] = await Promise.all([
    fetchAllRows((options) => supabaseClient
      .from('transactions')
      .select('event_id, date, merchant, amount, account_id, user', options)
      .order('date', { ascending: true })
      .order('event_id', { ascending: true })),

    fetchAllRows((options) => supabaseClient
      .from('transactions_metadata')
      .select('event_id, llm_merchant, llm_category, manual_merchant, manual_category, manual_amount, manual_date, hidden', options)
      .order('event_id', { ascending: true })),
  ]);

  if (transactionsResult.error) {
    console.error('[Ledger data] Transaction request failed:', transactionsResult.error);
    throw new Error(`Failed to load transactions: ${transactionsResult.error.message}`);
  }

  if (metadataResult.error) {
    console.error('[Ledger data] Transaction metadata request failed:', metadataResult.error);
    throw new Error(`Failed to load transaction metadata: ${metadataResult.error.message}`);
  }

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

  return transactions;
}

// ============================================================
// CALENDAR EVENTS
// ============================================================

/**
 * Fetches the Google Calendar events synced into calendar_events, each
 * with the rough budget and category the LLM extracted.
 *
 * @returns {Promise<Array<Object>>} { id, date, title, budget, category }
 */
export async function fetchCalendarEvents() {
  const { data, error } = await fetchAllRows((options) => supabaseClient
    .from('calendar_events')
    .select('event_id, title, event_date, budget, category', options)
    .order('event_date', { ascending: true })
    .order('event_id', { ascending: true }));

  if (error) {
    console.error('[Ledger data] Calendar events request failed:', error);
    throw new Error(`Failed to load calendar events: ${error.message}`);
  }

  return data.map((row) => ({
    id: row.event_id,
    date: row.event_date,
    title: row.title,
    budget: Number(row.budget) || 0,
    category: normalizeCategory(row.category) ?? 'other',
  }));
}
