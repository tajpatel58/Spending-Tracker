/**
 * forecast.js
 * ---------------------------------------------------------------------
 * Month maths shared by the Overview and Calendar pages: date helpers,
 * calendar events by date, and the month-end spending forecast. The
 * Calendar shows the forecast's workings; the Overview's spending-trend
 * chart shows it as the faint "still to come" part of this month's bar.
 * ---------------------------------------------------------------------
 */

import { CALENDAR_EVENTS, TRANSACTIONS } from './data.js';
import {
  getMonthTransactions,
  isExpense,
  isVariableExpense,
  MONTHLY_SAVINGS_TARGET,
  people,
  sharesOf,
} from './state.js';

/** Zero-pads a day/month number, e.g. 7 -> '07'. */
export const pad2 = (n) => String(n).padStart(2, '0');

/** Number of days in a month key, e.g. '2026-02' -> 28. */
export function daysIn(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Shifts a month key by n months, e.g. ('2026-01', -1) -> '2025-12'. */
export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export const sumAbs = (txs) => txs.reduce((s, t) => s + Math.abs(t.amount), 0);

/**
 * Latest transaction date loaded so far, across every account. Statements
 * arrive in batches (usually Sundays), so only days up to this date have
 * real data — later days are still forecast even if they're in the past.
 */
export function lastLoadedDate() {
  return Object.values(TRANSACTIONS).flat().reduce((max, t) => (t.date > max ? t.date : max), '');
}

/**
 * Forecasts a month's total spend:
 *     3-month average of monthly fixed expenses
 *   + variable spend (excl. fixed) on days already loaded
 *   + 3-month daily average (excl. fixed and holidays) × days not loaded yet
 *   + event budgets on days not loaded yet.
 * Both averages cover the previous three months that have data.
 */
export function forecastSpend(month) {
  const spent = sumAbs(getMonthTransactions(month).filter(isVariableExpense));

  const history = [1, 2, 3].map((n) => shiftMonth(month, -n)).filter((key) => TRANSACTIONS[key]?.length);
  const historyFixed = history.reduce((s, key) => s + sumAbs(getMonthTransactions(key).filter((t) => t.category === 'fixed_expense')), 0);
  const fixed = history.length ? historyFixed / history.length : 0;
  const historyDays = history.reduce((s, key) => s + daysIn(key), 0);
  // Holidays are one-offs, so they'd inflate a "typical day" — leave them out of the average.
  const isTypicalSpend = (t) => isVariableExpense(t) && t.category !== 'holiday';
  const historySpend = history.reduce((s, key) => s + sumAbs(getMonthTransactions(key).filter(isTypicalSpend)), 0);
  const dailyAvg = historyDays ? historySpend / historyDays : 0;

  const loadedTo = lastLoadedDate();
  let daysLeft = 0;
  let eventBudget = 0;
  let eventCount = 0;
  for (let d = 1; d <= daysIn(month); d += 1) {
    const iso = `${month}-${pad2(d)}`;
    if (iso <= loadedTo) continue;
    daysLeft += 1;
    eventBudget += (EVENTS_BY_DATE[iso] || []).reduce((s, e) => s + e.budget, 0);
    eventCount += (EVENTS_BY_DATE[iso] || []).length;
  }

  const projected = dailyAvg * daysLeft;
  return {
    total: fixed + spent + projected + eventBudget,
    fixed, spent, projected, dailyAvg, daysLeft, eventBudget, eventCount, loadedTo,
  };
}

/** Today's date as 'YYYY-MM-DD' in local time. */
export function todayIso() {
  const today = new Date();
  return `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
}

/** Calendar events grouped by date: { '2026-09-14': [ {id,title,budget,category}, ... ] }. */
export const EVENTS_BY_DATE = {};

/** Groups the loaded calendar events (CALENDAR_EVENTS, from data.js) by date into EVENTS_BY_DATE. */
export function indexEvents() {
  Object.keys(EVENTS_BY_DATE).forEach((date) => delete EVENTS_BY_DATE[date]);
  CALENDAR_EVENTS.forEach((e) => (EVENTS_BY_DATE[e.date] || (EVENTS_BY_DATE[e.date] = [])).push(e));
}

/** Salary received in a month (after the account filter). */
export function monthSalary(month) {
  return getMonthTransactions(month)
    .filter((t) => t.category === 'salary')
    .reduce((s, t) => s + t.amount, 0);
}

/**
 * What a month can be spent while still hitting MONTHLY_SAVINGS_TARGET:
 * the previous month's salary minus the target. Null when there was no
 * salary that month to base it on.
 */
export function spendingAllowance(month) {
  const salary = monthSalary(shiftMonth(month, -1));
  return salary > 0 ? salary - MONTHLY_SAVINGS_TARGET : null;
}

// ---- Salaries and savings per person ----

/** Each person's salary paid in a month (the joint account's split evenly): { Taj: 5200, Radhika: 0 }. */
function salaryPaid(month, everyone) {
  const paid = Object.fromEntries(everyone.map((person) => [person, 0]));
  getMonthTransactions(month).filter((t) => t.category === 'salary').forEach((t) => {
    const shares = sharesOf(t, everyone);
    shares.forEach((person) => { paid[person] += t.amount / shares.length; });
  });
  return paid;
}

/**
 * The salary each person can count on in a month. Everyone is paid once
 * a month, so while a month's statements are still coming in, someone
 * whose salary hasn't landed yet is taken to be paid what they were last
 * month (`expected`). A complete month shows only what was actually paid.
 *   { Taj: { paid: 0, expected: 5200 }, Radhika: { paid: 3900, expected: 0 } }
 */
export function salaries(month) {
  const everyone = people();
  const paid = salaryPaid(month, everyone);
  const stillComingIn = lastLoadedDate().slice(0, 7) <= month;
  const lastMonth = stillComingIn ? salaryPaid(shiftMonth(month, -1), everyone) : {};
  return Object.fromEntries(everyone.map((person) => [person, {
    paid: paid[person],
    expected: stillComingIn && paid[person] <= 0 && lastMonth[person] > 0 ? lastMonth[person] : 0,
  }]));
}

/** Salaries a month is still expecting (see salaries): [{ person: 'Taj', amount: 5200 }]. */
export function expectedSalaries(month) {
  return Object.entries(salaries(month))
    .filter(([, pay]) => pay.expected > 0)
    .map(([person, pay]) => ({ person, amount: pay.expected }));
}

/**
 * Each person's income, spending and savings for a month (biggest saver
 * first). A transaction on someone's own account counts to them, fixed
 * expenses included; anything on the joint account is split evenly
 * between them (sharesOf). Income and spending are as the Total saved
 * tile counts them (salary + interest in, including a salary still
 * expected; every expense out), so the savings add up to that tile.
 *   [{ person: 'Taj', income: 5200, expected: 5200, spent: 2900, saved: 2300 }, ...]
 */
export function savingsByPerson(month) {
  const everyone = people();
  const pay = salaries(month);
  const totals = Object.fromEntries(everyone.map((person) => [person, { income: pay[person].expected, expected: pay[person].expected, spent: 0 }]));
  getMonthTransactions(month).forEach((t) => {
    const income = t.category === 'salary' || t.category === 'interest';
    if (!income && !isExpense(t)) return;
    const shares = sharesOf(t, everyone);
    const amount = income ? t.amount : Math.abs(t.amount);
    shares.forEach((person) => { totals[person][income ? 'income' : 'spent'] += amount / shares.length; });
  });
  return everyone
    .map((person) => ({ person, ...totals[person], saved: totals[person].income - totals[person].spent }))
    .sort((a, b) => b.saved - a.saved);
}
