/**
 * forecast.js
 * ---------------------------------------------------------------------
 * Month maths shared by the Overview and Calendar pages: date helpers,
 * calendar events by date, and the month-end spending forecast. The
 * Calendar shows the forecast's workings; the Overview's spending-trend
 * chart shows it as the faint "still to come" part of this month's bar.
 * ---------------------------------------------------------------------
 */

/** Zero-pads a day/month number, e.g. 7 -> '07'. */
const pad2 = (n) => String(n).padStart(2, '0');

/** Number of days in a month key, e.g. '2026-02' -> 28. */
function daysIn(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Shifts a month key by n months, e.g. ('2026-01', -1) -> '2025-12'. */
function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

const sumAbs = (txs) => txs.reduce((s, t) => s + Math.abs(t.amount), 0);

/**
 * Latest transaction date loaded so far, across every account. Statements
 * arrive in batches (usually Sundays), so only days up to this date have
 * real data — later days are still forecast even if they're in the past.
 */
function lastLoadedDate() {
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
function forecastSpend(month) {
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
function todayIso() {
  const today = new Date();
  return `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
}

/** Calendar events grouped by date: { '2026-09-14': [ {id,title,budget,category}, ... ] }. */
const EVENTS_BY_DATE = {};

/** Groups the loaded calendar events (CALENDAR_EVENTS, from data.js) by date into EVENTS_BY_DATE. */
function indexEvents() {
  Object.keys(EVENTS_BY_DATE).forEach((date) => delete EVENTS_BY_DATE[date]);
  CALENDAR_EVENTS.forEach((e) => (EVENTS_BY_DATE[e.date] || (EVENTS_BY_DATE[e.date] = [])).push(e));
}

/** Salary received in a month (after the account filter). */
function monthSalary(month) {
  return getMonthTransactions(month)
    .filter((t) => t.category === 'salary')
    .reduce((s, t) => s + t.amount, 0);
}

/**
 * What a month can be spent while still hitting MONTHLY_SAVINGS_TARGET:
 * the previous month's salary minus the target. Null when there was no
 * salary that month to base it on.
 */
function spendingAllowance(month) {
  const salary = monthSalary(shiftMonth(month, -1));
  return salary > 0 ? salary - MONTHLY_SAVINGS_TARGET : null;
}
