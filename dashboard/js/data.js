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

// ---- Categories (id, label, CSS var for color) -------------------------
const CATEGORIES = [
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
let ACCOUNT_GROUPS = [];
let ACCOUNTS = [];

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
const MONTHS = [];             // [ { key: '2026-08' }, ... ]
const TRANSACTIONS = {};       // { '2026-08': [ {id,date,merchant,category,amount}, ... ] }
const CALENDAR_EVENTS = [];    // [ {id,date,title,budget,category}, ... ] — used by the Calendar page

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

const dataStatus = {
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

function readDataCache(email) {
  try {
    const cached = JSON.parse(localStorage.getItem(LEDGER_DATA_CACHE_KEY));
    return cached && cached.user === email && cached.version === 1 ? cached : null;
  } catch { return null; }
}

/** Saves what's on screen (also called after edits, so a reload shows them straight away). */
function saveDataCache() {
  if (!dataStatus.user) return;
  try {
    localStorage.setItem(LEDGER_DATA_CACHE_KEY, JSON.stringify({
      version: 1, user: dataStatus.user, syncedAt: dataStatus.syncedAt, ...currentDataBundle(),
    }));
  } catch (error) {
    console.warn('[Ledger data] Could not save the local copy:', error.message); // e.g. storage full/private mode
  }
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
function refreshData() {
  if (dataStatus.refreshing) return dataStatus.refreshing;
  notify('ledger:sync', { state: 'checking' });
  dataStatus.refreshing = (async () => {
    try {
      const fresh = await fetchDataBundle();
      const current = currentDataBundle();
      const changed = !sameData(fresh, current);
      const accountsChanged = !sameData(fresh.accountRows, current.accountRows);
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
 * Resolves once there's data to draw: immediately from the local copy
 * when there is one (pages then call refreshData() after rendering),
 * otherwise after the first fetch. Waits for the auth check first — a
 * signed-out visitor is being redirected to login.html.
 */
const accountsReady = authReady.then(async (session) => {
  if (!session) return;
  dataStatus.user = session.user.email;

  const cached = readDataCache(dataStatus.user);
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
function refileTransaction(transaction, previousDate) {
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
const MONTH_LABEL = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
