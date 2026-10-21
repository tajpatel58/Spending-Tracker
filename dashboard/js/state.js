/**
 * state.js
 * ---------------------------------------------------------------------
 * The dashboard's current view state (selected month, active filters,
 * search text, sort order) plus helpers that derive filtered/aggregated
 * data from TRANSACTIONS for that state. Every render function reads
 * from `state`.
 * ---------------------------------------------------------------------
 */

import { CATEGORIES, TRANSACTIONS } from './data.js';
import { motion } from './motion.js';

/** The month last picked on either page, so Overview and Calendar stay in step. */
function savedMonth() {
  try { return sessionStorage.getItem('ledger-month'); } catch { return null; }
}

export const state = {
  month: savedMonth(), // falls back to the most recent month once transactions load
  categories: new Set(), // table category filter; empty = every category
  users: new Set(),      // table user filter (see spendOwner); empty = everyone
  activeAccounts: new Set(), // populated after accounts.csv loads
  selectedTransactionIds: new Set(),
  search: '',
  sort: { key: 'date', dir: 'desc' },
  // The Total spend tile's pace chart without fixed expenses (remembered on this device).
  paceWithoutFixed: (() => { try { return localStorage.getItem('ledger-pace-without-fixed') === '1'; } catch { return false; } })(),
  // The By User doughnut: 'spending' or 'savings' (remembered on this device).
  userMode: (() => { try { return localStorage.getItem('ledger-user-mode') === 'savings' ? 'savings' : 'spending'; } catch { return 'spending'; } })(),
};

// Lookup tables used throughout the rendering code.
export const accountById = {}; // filled in once accounts.csv has loaded
export const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// Fixed expenses are grouped as their own "user" in the Spending by user
// chart and the table's user filter, rather than counting towards a person.
export const FIXED_EXPENSES_LABEL = 'Fixed Expenses';

/** Who a transaction's spend belongs to: 'Fixed Expenses', or its user. */
export function spendOwner(t) {
  return t.category === 'fixed_expense' ? FIXED_EXPENSES_LABEL : (t.user || 'Unknown');
}

/** Every spend owner across all loaded transactions: Fixed Expenses, then users A–Z. */
export function spendOwners() {
  const users = new Set(Object.values(TRANSACTIONS).flat().map((t) => t.user || 'Unknown'));
  return [FIXED_EXPENSES_LABEL, ...[...users].sort()];
}

/** True for the shared (joint) account, as opposed to one person's. */
const isJointOwner = (owner) => /^joint$/i.test(owner || '');

/** The people the household's money belongs to: every account owner except the joint account (e.g. Radhika, Taj). */
export function people() {
  return spendOwners().filter((owner) => owner !== FIXED_EXPENSES_LABEL && owner !== 'Unknown' && !isJointOwner(owner));
}

/**
 * Each person's income, spending and savings for a month (biggest saver
 * first). A transaction on someone's own account counts to them, fixed
 * expenses included; anything on the joint account is split evenly
 * between them. Income and spending are as the Total saved tile counts
 * them (salary + interest in; every expense out), so the savings add up
 * to that tile.
 *   [{ person: 'Taj', income: 5200, spent: 2900, saved: 2300 }, ...]
 */
export function savingsByPerson(month) {
  const everyone = people();
  const totals = Object.fromEntries(everyone.map((person) => [person, { income: 0, spent: 0 }]));
  getMonthTransactions(month).forEach((t) => {
    const owner = t.user || 'Unknown';
    const shares = isJointOwner(owner) ? everyone : totals[owner] ? [owner] : [];
    const income = t.category === 'salary' || t.category === 'interest';
    if (!shares.length || (!income && !isExpense(t))) return;
    const amount = income ? t.amount : Math.abs(t.amount);
    shares.forEach((person) => { totals[person][income ? 'income' : 'spent'] += amount / shares.length; });
  });
  return everyone
    .map((person) => ({ person, ...totals[person], saved: totals[person].income - totals[person].spent }))
    .sort((a, b) => b.saved - a.saved);
}

/** A spend owner's colour as a CSS var() — fixed by name, so it never changes month to month. */
export function spendOwnerColor(owner) {
  if (owner === FIXED_EXPENSES_LABEL) return 'var(--cat-fixed-expense)';
  const index = spendOwners().indexOf(owner) - 1; // -1 skips Fixed Expenses
  return `var(--user-${(Math.max(index, 0) % 3) + 1})`;
}

/** Clears the loading placeholders once the page has rendered real data. */
export function finishLoading() {
  document.body.classList.remove('is-loading');
  document.body.removeAttribute('aria-busy');
  const reveal = () => motion.reveal();
  const root = document.documentElement;
  if (!root.classList.contains('is-launching')) { reveal(); return; }
  // Launch mark showing (first page of a visit): let it finish drawing, then
  // lift it as the cards rise in beneath it.
  setTimeout(() => {
    root.classList.add('is-launched');
    reveal();
    setTimeout(() => root.classList.remove('is-launching', 'is-launched'), 700);
  }, Math.max(0, LAUNCH_MS - performance.now()));
}

/** How long (from page start) the launch mark stays up at least: long enough to finish drawing. */
const LAUNCH_MS = 1500;

/** Swaps the loading placeholders for a short message with a Retry button. */
export function showLoadError(error) {
  console.error('[Ledger] Failed to load the dashboard:', error);
  finishLoading();
  // Blank the figures so the page doesn't show placeholder "£0"s as if they were real.
  document.querySelectorAll('.stat-tile__value').forEach((el) => { el.textContent = '—'; });
  document.querySelectorAll('.stat-tile__delta').forEach((el) => { el.textContent = ''; });
  const banner = document.createElement('div');
  banner.className = 'load-error';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <span>Couldn't load your spending data.</span>
    <button type="button" class="load-error__retry">Retry</button>`;
  banner.querySelector('button').addEventListener('click', () => window.location.reload());
  document.querySelector('main').prepend(banner);
}

/** True for anything that counts as spending rather than income. */
export function isExpense(t) {
  return !['salary', 'interest', 'refund'].includes(t.category);
}

/** Expenses minus fixed costs (rent, bills) — used for daily averages and the category/user donuts. */
export function isVariableExpense(t) {
  return isExpense(t) && t.category !== 'fixed_expense';
}

// Monthly targets. Spending covers everything, fixed expenses included.
// Monthly savings target. Drives the Calendar's "Forecast savings", and
// "Max spend per day" (last month's salary minus this is what can be spent).
export const MONTHLY_SAVINGS_TARGET = 4400;

// Edit these monthly budget values as the household budget evolves.
export const BUDGETS = {
  'Fixed Expenses': 800,
  'Dining Out': 250,
  Groceries: 250,
  Shopping: 150,
  Transport: 150,
  Extras: 400,
};

// Maps raw category IDs into the budget groups shown on the dashboard.
export const BUDGET_GROUPS = {
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

/** Each budget group's colour, shared by the budget bars and the Over budget tile's strip. */
export const BUDGET_GROUP_COLORS = {
  'Fixed Expenses': 'var(--cat-fixed-expense)',
  'Dining Out': 'var(--cat-dining)',
  Groceries: 'var(--cat-groceries)',
  Shopping: 'var(--cat-shopping)',
  Transport: 'var(--cat-transport)',
  Extras: 'var(--budget-extras)',
};

/** Sums the (absolute) amount of a list of transactions, grouped by category. */
export function categoryTotals(txs) {
  const totals = {};
  txs.forEach((t) => { totals[t.category] = (totals[t.category] || 0) + Math.abs(t.amount); });
  return totals;
}

/** Expense totals for a month, grouped into the budget groups above, e.g. { Groceries: 212.40, ... }. */
export function budgetGroupActuals(month) {
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
export function getMonthTransactions(month) {
  const all = TRANSACTIONS[month] || [];
  return all.filter((t) => {
    if (t.hidden === true) return false;
    return state.activeAccounts.has(t.account);
  });
}

/** Total spend (expenses only) for a given month. */
export function monthTotal(month) {
  return getMonthTransactions(month)
    .filter(isExpense)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

/** Transactions for the current month, after category filters and search are applied. */
export function getFilteredTransactions() {
  return getMonthTransactions(state.month)
    .filter((t) => !state.categories.size || state.categories.has(t.category))
    .filter((t) => !state.users.size || state.users.has(spendOwner(t)))
    .filter((t) => !state.search || t.merchant.toLowerCase().includes(state.search));
}
