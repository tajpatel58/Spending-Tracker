/**
 * state.js
 * ---------------------------------------------------------------------
 * The dashboard's current view state (selected month, active filters,
 * search text, sort order) plus helpers that derive filtered/aggregated
 * data from TRANSACTIONS for that state. Every render function reads
 * from `state`.
 * ---------------------------------------------------------------------
 */

/** The month last picked on either page, so Overview and Calendar stay in step. */
function savedMonth() {
  try { return sessionStorage.getItem('ledger-month'); } catch { return null; }
}

const state = {
  month: savedMonth(), // falls back to the most recent month once transactions load
  categories: new Set(), // table category filter; empty = every category
  activeAccounts: new Set(), // populated after accounts.csv loads
  selectedTransactionIds: new Set(),
  search: '',
  sort: { key: 'date', dir: 'desc' },
};

// Lookup tables used throughout the rendering code.
const accountById = {}; // filled in once accounts.csv has loaded
const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

/** True for anything that counts as spending rather than income. */
function isExpense(t) {
  return !['salary', 'interest', 'refund'].includes(t.category);
}

/** Expenses minus fixed costs (rent, bills) — used for daily averages and the category/user donuts. */
function isVariableExpense(t) {
  return isExpense(t) && t.category !== 'fixed_expense';
}

// Monthly targets. Spending covers everything, fixed expenses included.
const MONTHLY_SAVINGS_TARGET = 4400; // drives the Calendar's "Forecast savings"
const MONTHLY_SPEND_TARGET = 2000;   // drives the Calendar's "Max spend per day"

// Edit these monthly budget values as the household budget evolves.
const BUDGETS = {
  'Fixed Expenses': 800,
  'Dining Out': 300,
  Groceries: 300,
  Shopping: 150,
  Transport: 150,
  Extras: 400,
};

// Maps raw category IDs into the budget groups shown on the dashboard.
const BUDGET_GROUPS = {
  dining: 'Dining Out',
  groceries: 'Groceries',
  housing: 'Fixed Expenses',
  shopping: 'Shopping',
  transport: 'Transport',
  health: 'Extras',
  holiday: 'Extras',
  subscriptions: 'Extras',
  fixed_expense: 'Fixed Expenses',
  'birthday/gifts': 'Extras',
  activities: 'Extras',
  other: 'Extras',
};

/** Sums the (absolute) amount of a list of transactions, grouped by category. */
function categoryTotals(txs) {
  const totals = {};
  txs.forEach((t) => { totals[t.category] = (totals[t.category] || 0) + Math.abs(t.amount); });
  return totals;
}

/** Expense totals for a month, grouped into the budget groups above, e.g. { Groceries: 212.40, ... }. */
function budgetGroupActuals(month) {
  const actual = {};
  Object.entries(categoryTotals(getMonthTransactions(month).filter(isExpense))).forEach(([categoryId, amount]) => {
    const group = BUDGET_GROUPS[categoryId] || 'Extras';
    actual[group] = (actual[group] || 0) + amount;
  });
  return actual;
}

/**
 * Transactions for a given month, with hidden transactions and
 * unselected accounts already filtered out.
 * API: replace with `fetch(`/api/transactions?month=${month}&accounts=${[...state.activeAccounts]}`)`
 */
function getMonthTransactions(month) {
  const all = TRANSACTIONS[month] || [];
  return all.filter((t) => {
    if (t.hidden === true) return false;
    return state.activeAccounts.has(t.account);
  });
}

/** Total spend (expenses only) for a given month. */
function monthTotal(month) {
  return getMonthTransactions(month)
    .filter(isExpense)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

/** Transactions for the current month, after category filters and search are applied. */
function getFilteredTransactions() {
  return getMonthTransactions(state.month)
    .filter((t) => !state.categories.size || state.categories.has(t.category))
    .filter((t) => !state.search || t.merchant.toLowerCase().includes(state.search));
}
