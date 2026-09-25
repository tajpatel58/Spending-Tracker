/**
 * state.js
 * ---------------------------------------------------------------------
 * The dashboard's current view state (selected month, active filters,
 * search text, sort order) plus helpers that derive filtered/aggregated
 * data from TRANSACTIONS for that state. Every render function reads
 * from `state`.
 * ---------------------------------------------------------------------
 */

const state = {
  month: null, // set to the most recent month once transactions load
  activeCategories: new Set(CATEGORIES.map((c) => c.id)), // all active
  categoryFilter: null,
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

// Edit these monthly budget values as the household budget evolves.
const BUDGETS = {
  'Dining Out': 250,
  Groceries: 300,
  Housing: 500,
  Shopping: 250,
  Transport: 250,
  Health: 200,
  Extras: 400,
};

// Maps raw category IDs into the budget groups shown on the dashboard.
const BUDGET_GROUPS = {
  dining: 'Dining Out',
  groceries: 'Groceries',
  housing: 'Housing',
  shopping: 'Shopping',
  transport: 'Transport',
  health: 'Health',
  holiday: 'Extras',
  subscriptions: 'Extras',
  'birthday/gifts': 'Extras',
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
    .filter((t) => state.activeCategories.has(t.category))
    .filter((t) => !state.categoryFilter || t.category === state.categoryFilter)
    .filter((t) => !state.search || t.merchant.toLowerCase().includes(state.search));
}
