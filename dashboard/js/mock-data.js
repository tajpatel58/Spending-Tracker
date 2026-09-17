/**
 * mock-data.js
 * ---------------------------------------------------------------------
 * Loads the data the dashboard renders from:
 *
 *   CATEGORIES               -> static list below
 *   ACCOUNT_GROUPS/ACCOUNTS  -> ../data/accounts/accounts.csv
 *   TRANSACTIONS             -> Supabase (see supabase.js)
 *
 * Merchant/category/amount are editable in place from the table and are
 * written back through transaction-api.js.
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
  { id: 'shopping',      label: 'Shopping',        color: 'var(--cat-shopping)' },
  { id: 'health',        label: 'Health',          color: 'var(--cat-health)' },
  { id: 'birthday/gifts',label: 'Birthday/Gifts',  color: 'var(--cat-birthday)' },
  { id: 'other',         label: 'Unassigned',      color: 'var(--cat-other)' },
  { id: 'salary',        label: 'Salary',          color: 'var(--cat-salary)' },
  { id: 'interest',      label: 'Interest Payments', color: 'var(--cat-interest)' },
  { id: 'refund',        label: 'Refund',           color: 'var(--cat-refund)' },
];

// ---- Accounts, grouped by owner --------------------------------------
let ACCOUNT_GROUPS = [];
let ACCOUNTS = [];

function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      field += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(field.trim());
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field.trim());
  return fields;
}

async function loadAccounts() {
  const response = await fetch('../data/accounts/accounts.csv');
  if (!response.ok) throw new Error(`Could not load accounts.csv (${response.status})`);

  const lines = (await response.text()).trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  const rows = lines.filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
  const groups = new Map();

  rows.forEach((row) => {
    const groupId = row.user.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, label: row.user, accounts: [] });
    groups.get(groupId).accounts.push({
      id: row.account_id,
      label: row.account_id,
      bank: row.account_name,
    });
  });

  ACCOUNT_GROUPS = [...groups.values()];
  ACCOUNTS = ACCOUNT_GROUPS.flatMap((group) =>
    group.accounts.map((account) => ({ ...account, groupId: group.id, groupLabel: group.label }))
  );
}

// Both are filled in by `accountsReady` below, in ascending month order.
const MONTHS = [];             // [ { key: '2026-08' }, ... ]
const TRANSACTIONS = {};       // { '2026-08': [ {id,date,merchant,category,amount}, ... ] }

const accountsReady = loadAccounts().then(async () => {
  const transactions = await loadSupabaseTransactions();
  transactions.forEach((transaction) => {
    const month = transaction.date.slice(0, 7);
    if (!TRANSACTIONS[month]) TRANSACTIONS[month] = [];
    TRANSACTIONS[month].push(transaction);
  });

  MONTHS.push(...Object.keys(TRANSACTIONS).sort().map((key) => ({ key })));
});

const MONTH_LABEL = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
