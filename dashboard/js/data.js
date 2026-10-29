/**
 * data.js
 * ---------------------------------------------------------------------
 * Loads the data the dashboard renders:
 *
 *   CATEGORIES                -> static list below
 *   ACCOUNT_GROUPS / ACCOUNTS -> Supabase, via the accounts table
 *   MONTHS / TRANSACTIONS     -> Supabase, via supabase-client.js
 *
 * Merchant/category/amount are editable in place from the table (see
 * table.js) and are written back through transactions-api.js.
 *
 * Everything else waits on the `accountsReady` promise below before
 * reading ACCOUNTS/ACCOUNT_GROUPS/MONTHS/TRANSACTIONS. After the first
 * visit that's instant: the data is drawn from a copy saved on this
 * device and refreshed in the background (see refreshData).
 * ---------------------------------------------------------------------
 */

import {
  authReady,
  LEDGER_DATA_CACHE_KEY,
  localCache,
  localDataCleared,
  storedSession,
  supabaseClient,
} from './auth.js';
import { fetchCalendarEvents, fetchTransactions } from './supabase-client.js';

// ---- Categories (id, label, CSS var for color) -------------------------
export const CATEGORIES = [
  { id: 'groceries',     label: 'Groceries',       color: 'var(--cat-groceries)' },
  { id: 'dining',        label: 'Dining Out',      color: 'var(--cat-dining)' },
  { id: 'transport',     label: 'Transport',       color: 'var(--cat-transport)' },
  { id: 'holiday',       label: 'Holiday',         color: 'var(--cat-holiday)' },
  { id: 'housing',       label: 'Housing',         color: 'var(--cat-housing)' },
  { id: 'subscriptions', label: 'Subscriptions',   color: 'var(--cat-subscriptions)' },
  { id: 'fixed_expense', label: 'Fixed Expense',  color: 'var(--cat-fixed-expense)' },
  { id: 'health',        label: 'Health',          color: 'var(--cat-health)' },
  { id: 'shopping',      label: 'Shopping',        color: 'var(--cat-shopping)' },
  { id: 'birthday/gifts',label: 'Birthday/Gifts',  color: 'var(--cat-birthday)' },
  { id: 'activities',    label: 'Activities',      color: 'var(--cat-activities)' },
  { id: 'other',         label: 'Unassigned',      color: 'var(--cat-other)' },
  { id: 'salary',        label: 'Salary',          color: 'var(--cat-salary)' },
  { id: 'interest',      label: 'Interest Payments', color: 'var(--cat-interest)' },
  { id: 'refund',        label: 'Refund',           color: 'var(--cat-refund)' },
];

// ---- Accounts, grouped by owner --------------------------------------
export let ACCOUNT_GROUPS = [];
export let ACCOUNTS = [];

/** Builds ACCOUNT_GROUPS / ACCOUNTS from rows of the accounts table. */
function applyAccounts(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const groupId = row.user.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, label: row.user, accounts: [] });
    groups.get(groupId).accounts.push({ id: row.account_id, label: row.account_id, bank: row.account_name });
  });
  ACCOUNT_GROUPS = [...groups.values()];
  ACCOUNTS = ACCOUNT_GROUPS.flatMap((group) =>
    group.accounts.map((account) => ({ ...account, groupId: group.id, groupLabel: group.label }))
  );
}

/** Reads the accounts table (ordered by user, bank, account). */
async function fetchAccountRows() {
  const { data, error } = await supabaseClient
    .from('accounts')
    .select('account_id, account_name, user')
    .order('user', { ascending: true })
    .order('account_name', { ascending: true })
    .order('account_id', { ascending: true });
  if (error) {
    console.error('[Ledger data] Accounts request failed:', error);
    throw new Error(`Failed to load accounts: ${error.message}`);
  }
  return data;
}

// Both are filled in by `accountsReady` below, in ascending month order.
export const MONTHS = [];             // [ { key: '2026-08' }, ... ]
export const TRANSACTIONS = {};       // { '2026-08': [ {id,date,merchant,category,amount}, ... ] }
export const CALENDAR_EVENTS = [];    // [ {id,date,title,budget,category}, ... ] — used by the Calendar page

/** Groups transactions by month into TRANSACTIONS and rebuilds MONTHS (in place, so references stay valid). */
function applyTransactions(transactions) {
  Object.keys(TRANSACTIONS).forEach((key) => delete TRANSACTIONS[key]);
  transactions.forEach((transaction) => {
    const month = transaction.date.slice(0, 7);
    (TRANSACTIONS[month] || (TRANSACTIONS[month] = [])).push(transaction);
  });
  MONTHS.splice(0, MONTHS.length, ...Object.keys(TRANSACTIONS).sort().map((key) => ({ key })));
}

function applyEvents(events) {
  CALENDAR_EVENTS.splice(0, CALENDAR_EVENTS.length, ...events);
}

// ============================================================
// LOCAL CACHE + BACKGROUND REFRESH
// ============================================================
// The data changes about once a day, so each page draws straight away
// from the copy saved on this device, then checks Supabase in the
// background and only re-renders if something actually changed. The
// copy is tied to the signed-in email and cleared on sign out (auth.js).

export const dataStatus = {
  user: null,        // email the data belongs to
  syncedAt: null,    // when this device last pulled fresh data (ms)
  refreshing: null,  // the in-flight refresh promise, if any
};

/** Everything the pages need, as plain data (what gets cached). */
function currentDataBundle() {
  return {
    accountRows: currentDataBundle.accountRows || [],
    transactions: Object.values(TRANSACTIONS).flat(),
    events: CALENDAR_EVENTS.slice(),
  };
}

function applyDataBundle(bundle) {
  currentDataBundle.accountRows = bundle.accountRows;
  applyAccounts(bundle.accountRows);
  applyTransactions(bundle.transactions);
  applyEvents(bundle.events || []);
}

/**
 * This user's saved copy, or null. Reads IndexedDB; a copy from before it
 * moved there (in localStorage) is read once, moved across and removed.
 */
async function readDataCache(email) {
  // Version 2 added each transaction's subCategory: an older copy is skipped and fetched afresh.
  const valid = (cached) => (cached && cached.user === email && cached.version === 2 ? cached : null);
  let stored = null;
  try { stored = await localCache.get(LEDGER_DATA_CACHE_KEY); } catch { /* IndexedDB unavailable */ }
  if (stored) return valid(stored);
  try {
    const legacy = valid(JSON.parse(localStorage.getItem(LEDGER_DATA_CACHE_KEY)));
    if (legacy) localCache.set(LEDGER_DATA_CACHE_KEY, legacy).then(() => localStorage.removeItem(LEDGER_DATA_CACHE_KEY), () => {});
    return legacy;
  } catch { return null; }
}

/** Writes the copy now: to IndexedDB, or localStorage if that's unavailable. */
async function writeDataCache() {
  saveDataCache.timer = null;
  if (!dataStatus.user || localDataCleared) return;
  const copy = { version: 2, user: dataStatus.user, syncedAt: dataStatus.syncedAt, ...currentDataBundle() };
  try {
    await localCache.set(LEDGER_DATA_CACHE_KEY, copy);
  } catch {
    try {
      localStorage.setItem(LEDGER_DATA_CACHE_KEY, JSON.stringify(copy));
    } catch (error) {
      console.warn('[Ledger data] Could not save the local copy:', error.message); // e.g. storage full/private mode
    }
  }
}

/**
 * Saves what's on screen (also called after edits, so a reload shows them
 * straight away). An edit, its save and an undo can each ask within a few
 * moments; they share one write, made just after, or as the page is left.
 */
export function saveDataCache() {
  if (!saveDataCache.timer) saveDataCache.timer = setTimeout(writeDataCache, 300);
}
// Leaving the page (or the app going to the background) writes a pending save straight away.
const flushDataCache = () => { if (saveDataCache.timer) { clearTimeout(saveDataCache.timer); writeDataCache(); } };
window.addEventListener('pagehide', flushDataCache);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDataCache(); });

/** Marks the saved copy as due a check, so the next page loaded fetches fresh data (e.g. after an upload). */
export function markDataStale() {
  dataStatus.syncedAt = null;
  saveDataCache();
}

/** Pulls accounts, transactions and calendar events from Supabase in parallel. */
async function fetchDataBundle() {
  const [accountRows, transactions, events] = await Promise.all([
    fetchAccountRows(),
    fetchTransactions(),
    // Events are optional — the dashboard still works if the table is missing or fails.
    fetchCalendarEvents().catch((error) => { console.error(error); return []; }),
  ]);
  return { accountRows, transactions, events };
}

const sameData = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const notify = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

/**
 * Fetches fresh data and, if it differs from what's shown, applies it and
 * fires `ledger:data-changed` (pages re-render on it). Progress is
 * announced with `ledger:sync` events for the "Updated …" control.
 * Resolves to { changed, accountsChanged }.
 */
export function refreshData() {
  if (dataStatus.refreshing) return dataStatus.refreshing;
  notify('ledger:sync', { state: 'checking' });
  dataStatus.refreshing = (async () => {
    try {
      const fresh = await fetchDataBundle();
      const current = currentDataBundle();
      const changed = !sameData(fresh, current);
      const accountsChanged = changed && !sameData(fresh.accountRows, current.accountRows);
      if (changed) applyDataBundle(fresh);
      dataStatus.syncedAt = Date.now();
      saveDataCache();
      notify('ledger:sync', { state: 'done', changed });
      if (changed) notify('ledger:data-changed', { accountsChanged });
      return { changed, accountsChanged };
    } catch (error) {
      notify('ledger:sync', { state: 'error' });
      throw error;
    } finally {
      dataStatus.refreshing = null;
    }
  })();
  return dataStatus.refreshing;
}

/**
 * A device that already holds this user's data can draw it before the
 * session and access checks finish: the copy is already on the device,
 * so showing it early reveals nothing new. If authReady then fails,
 * initializeAuth clears the copy and redirects to login.html.
 */
const quickStart = (async () => {
  const session = storedSession();
  const cached = session && await readDataCache(session.user.email);
  return cached ? { session, cached } : null;
})();

/**
 * The session a page can draw with: the stored one straight away when
 * there's a local copy of the data (quickStart), otherwise the result
 * of the full check in authReady. Pages that write on the user's behalf
 * (Upload) wait for authReady itself.
 */
export const pageSession = quickStart.then((quick) => (quick ? quick.session : authReady));

/**
 * Resolves once there's data to draw: immediately from the local copy
 * when there is one (pages then call refreshData() after rendering),
 * otherwise after the auth check and the first fetch — a signed-out
 * visitor is being redirected to login.html.
 */
export const accountsReady = pageSession.then(async (session) => {
  if (!session) return;
  dataStatus.user = session.user.email;

  const quick = await quickStart;
  const cached = quick ? quick.cached : await readDataCache(dataStatus.user);
  if (cached) {
    applyDataBundle(cached);
    dataStatus.syncedAt = cached.syncedAt;
    dataStatus.fromCache = true;
    return;
  }
  applyDataBundle(await fetchDataBundle());
  dataStatus.syncedAt = Date.now();
  saveDataCache();
});

// Failures are handled where it's awaited (main.js / calendar.js show a
// Retry message); this stops the browser also logging an "unhandled" error.
accountsReady.catch(() => {});

/**
 * Re-files a transaction under the month of its (new) date, adding that
 * month to MONTHS if it's the first transaction there. Used when a date
 * edit moves a transaction into a different month.
 */
export function refileTransaction(transaction, previousDate) {
  const from = previousDate.slice(0, 7);
  const to = transaction.date.slice(0, 7);
  if (from === to) return;
  TRANSACTIONS[from] = (TRANSACTIONS[from] || []).filter((t) => t !== transaction);
  if (!TRANSACTIONS[to]) {
    TRANSACTIONS[to] = [];
    MONTHS.push({ key: to });
    MONTHS.sort((a, b) => a.key.localeCompare(b.key));
  }
  TRANSACTIONS[to].push(transaction);
}

/** Formats a month key like '2026-08' as "August 2026". */
export const MONTH_LABEL = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
