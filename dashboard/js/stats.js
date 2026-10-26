/**
 * stats.js
 * ---------------------------------------------------------------------
 * Renders the stat tiles at the top of the dashboard: the large total
 * spend tile (with its pace against the target, the transaction count
 * and the running-total chart from charts.js), then income, total saved,
 * daily average, and the number of budget categories that are over
 * budget, each with its change on last month and a six-month sparkline.
 * ---------------------------------------------------------------------
 */

import { renderPaceChart } from './charts.js';
import { MONTH_LABEL, MONTHS } from './data.js';
import {
  daysIn,
  expectedSalaries,
  forecastSpend,
  lastLoadedDate,
  spendingAllowance,
  sumAbs,
} from './forecast.js';
import { currency, currencyShort, escapeAttr, moneyMarkup, signedFixed } from './format.js';
import { motion } from './motion.js';
import {
  BUDGET_GROUP_COLORS,
  budgetGroupActuals,
  BUDGETS,
  getMonthTransactions,
  isExpense,
  isVariableExpense,
  MONTHLY_SAVINGS_TARGET,
  state,
} from './state.js';

/**
 * How many days of a month have data loaded: up to the latest loaded
 * transaction in the month it falls in, every day of months before it.
 * Statements arrive in batches, so this can trail today.
 */
export function daysLoaded(month) {
  const loadedTo = lastLoadedDate();
  if (!loadedTo || loadedTo.slice(0, 7) < month) return 0;
  if (loadedTo.slice(0, 7) > month) return daysIn(month);
  return Number(loadedTo.slice(8, 10));
}

/**
 * How far into a month to compare it with the month before: the days
 * loaded while it's still coming in, so a part month is set against the
 * same days of last month rather than all of it. Null once it's complete.
 */
function comparisonDay(month) {
  const loaded = daysLoaded(month);
  return loaded > 0 && loaded < daysIn(month) ? loaded : null;
}

/** A month's transactions, or with `upTo` only those in its first `upTo` days. */
function transactionsTo(month, upTo) {
  const txs = getMonthTransactions(month);
  return upTo === null ? txs : txs.filter((t) => Number(t.date.slice(8, 10)) <= upTo);
}

/**
 * A month's fixed expenses, as the pace without them counts them: what
 * was actually paid once the month is complete; before then, what's been
 * paid so far or the usual amount (the forecast's 3-month average),
 * whichever is more, since some bills may still be to come.
 */
function expectedFixed(month) {
  const paid = sumAbs(getMonthTransactions(month).filter((t) => t.category === 'fixed_expense'));
  if (daysLoaded(month) >= daysIn(month)) return paid;
  return Math.max(paid, forecastSpend(month).fixed);
}

/**
 * Spend so far against the month's spending target (spendingAllowance),
 * pro rata for the days loaded — or against the whole target once the
 * month is complete. With `withoutFixed`, both leave out fixed expenses:
 * `spent` should be everyday spending, and the target drops the month's
 * fixed costs (expectedFixed). Null when there's no target (no salary
 * last month, or fixed costs that use all of it).
 */
function monthPace(month, spent, { withoutFixed = false } = {}) {
  const allowance = spendingAllowance(month);
  if (allowance === null) return null;
  const fixed = withoutFixed ? expectedFixed(month) : 0;
  const target = allowance - fixed;
  if (target <= 0) return null;
  const days = daysIn(month);
  const loaded = daysLoaded(month);
  const expected = target * (loaded / days);
  return { target, expected, gap: expected - spent, complete: loaded >= days, loaded, withoutFixed, fixed };
}

/**
 * Renders the stat tiles for the currently selected month.
 * API: replace with `fetch(`/api/analytics/summary?month=${month}`)`
 */
export function renderStats() {
  const txs = getMonthTransactions(state.month);
  // The tile's "Fixed costs" switch: off, its figure, change on last month,
  // transaction count, pace and chart are all everyday spending only.
  const withoutFixed = state.paceWithoutFixed;
  const keep = withoutFixed ? isVariableExpense : isExpense;
  const total = sumAbs(txs.filter(keep));

  const idx = MONTHS.findIndex((m) => m.key === state.month);
  const prevKey = idx > 0 ? MONTHS[idx - 1].key : null;
  // A month still coming in is compared with last month up to the same day.
  const upTo = comparisonDay(state.month);
  const prevTotal = prevKey ? sumAbs(transactionsTo(prevKey, upTo).filter(keep)) : null;

  // Headline figures: pence set smaller (moneyMarkup in format.js).
  document.getElementById('stat-total-label').textContent = withoutFixed ? 'Everyday spend' : 'Total spend';
  document.getElementById('stat-total').innerHTML = moneyMarkup(currency(total));
  const deltaEl = document.getElementById('stat-total-delta');
  if (prevTotal !== null && prevTotal > 0) {
    const pct = ((total - prevTotal) / prevTotal) * 100;
    const prevName = MONTH_LABEL(prevKey).split(' ')[0].slice(0, 3);
    deltaEl.textContent = `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}% vs ${upTo ? `same point in ${prevName}` : 'last month'}`;
    deltaEl.className = 'stat-tile__delta stat-tile__delta--pill ' + (pct >= 0 ? 'is-up' : 'is-down');
    deltaEl.title = upTo
      ? `${currency(total)} by day ${upTo}, against ${currency(prevTotal)} by day ${upTo} of ${MONTH_LABEL(prevKey)}`
      : `${MONTH_LABEL(prevKey)}: ${currency(prevTotal)}`;
  } else {
    deltaEl.textContent = 'No prior month';
    deltaEl.className = 'stat-tile__delta stat-tile__delta--pill';
    deltaEl.title = '';
  }

  // "£180 under pace": spend so far against where the target says it should be by now
  // (or, with the chart's "Fixed costs" switch off, everyday spend against the target less fixed costs).
  const paceEl = document.getElementById('stat-pace');
  const pace = monthPace(state.month, total, { withoutFixed });
  paceEl.hidden = !pace;
  if (pace) {
    const under = pace.gap >= 0;
    const what = `${withoutFixed ? 'everyday ' : ''}${pace.complete ? 'target' : 'pace'}`;
    paceEl.textContent = `${currencyShort(Math.abs(pace.gap))} ${under ? 'under' : 'over'} ${what}`;
    paceEl.className = 'stat-tile__delta ' + (under ? 'is-positive' : 'is-negative');
    const target = withoutFixed
      ? `${currency(pace.target)} everyday target (last month's salary less ${currencyShort(MONTHLY_SAVINGS_TARGET)} savings and ${currency(pace.fixed)} fixed costs)`
      : `${currency(pace.target)} target (last month's salary less ${currencyShort(MONTHLY_SAVINGS_TARGET)} savings)`;
    paceEl.title = pace.complete ? `Against the ${target}` : `By day ${pace.loaded} the ${target} allows ${currency(pace.expected)}`;
  }

  const figures = monthFigures(state.month);
  const { income, saved } = figures;
  document.getElementById('stat-income').innerHTML = moneyMarkup(currency(income));
  // A salary not paid in yet is counted at last month's amount (monthFigures); the note says whose.
  const incomeNote = document.getElementById('stat-income-note');
  const { expected } = figures;
  incomeNote.textContent = !expected.length ? 'Salary + Interest'
    : expected.length === 1 ? `Incl. ${expected[0].person}'s expected salary` : `Incl. ${expected.length} expected salaries`;
  incomeNote.title = expected.length
    ? `Not paid in yet, so counted at last month's amount: ${expected.map((salary) => `${salary.person} ${currency(salary.amount)}`).join(', ')}`
    : '';
  // "EST." beside the Income and Total saved figures while either counts an assumed salary.
  const assumed = expected.map((salary) => `${salary.person}'s salary (last month's ${currency(salary.amount)})`).join(' and ');
  [['stat-income-est', 'Includes'], ['stat-saved-est', 'Counts']].forEach(([id, verb]) => {
    const badge = document.getElementById(id);
    badge.hidden = !expected.length;
    badge.title = expected.length ? `${verb} ${assumed}, not paid in yet` : '';
  });
  document.getElementById('stat-saved').innerHTML = moneyMarkup(currency(saved));
  const savedNote = document.getElementById('stat-saved-note');
  if (income > 0) {
    savedNote.textContent = `${signedFixed((saved / income) * 100, 1)}% of income`;
    savedNote.className = 'stat-tile__delta ' + (saved >= 0 ? 'is-positive' : 'is-negative');
  } else {
    savedNote.textContent = 'Income − total spend';
    savedNote.className = 'stat-tile__delta';
  }

  const shown = withoutFixed ? txs.filter((t) => t.category !== 'fixed_expense') : txs;
  const expenseCount = shown.filter(keep).length;
  const avg = expenseCount ? total / expenseCount : 0;
  document.getElementById('stat-count-note').textContent = `${shown.length} transaction${shown.length === 1 ? '' : 's'}`
    + (expenseCount ? ` · ${currency(avg)} avg` : '');

  document.getElementById('stat-daily-avg').innerHTML = moneyMarkup(currency(figures.dailyAvg));
  document.getElementById('stat-daily-note').textContent = 'Excluding Fixed Expenses';
  document.getElementById('stat-daily-avg').title = upTo ? `Everyday spending over the ${upTo} days loaded so far` : '';

  renderOverBudget(state.month);

  renderTileTrends(idx, upTo);

  document.getElementById('page-subtitle').textContent = `Spending overview — ${MONTH_LABEL(state.month)}`;
  renderPaceChart(pace);
}

/**
 * Each budget group's standing for a month, in BUDGETS order: what's
 * spent against its budget, and whether it's 'over', 'ahead' (under
 * budget but past an even pace for the days loaded — not Fixed Expenses,
 * whose bills land on set dates) or 'ok'.
 */
function budgetStanding(month) {
  const actualByGroup = budgetGroupActuals(month);
  const days = daysIn(month);
  const loaded = daysLoaded(month);
  const complete = loaded >= days;
  const groups = Object.entries(BUDGETS).map(([group, budget]) => {
    const actual = actualByGroup[group] || 0;
    const pace = budget * (loaded / days);
    const status = budget && actual > budget ? 'over'
      : budget && group !== 'Fixed Expenses' && !complete && loaded > 0 && actual > pace ? 'ahead'
        : 'ok';
    return { group, actual, budget, status };
  });
  return { groups, complete };
}

/**
 * The "Over budget" tile: "2 of 6", beside a stack of thin bars, one per
 * budget group in the budget chart's order and colours, filled to how
 * much of its budget is spent. As in the chart, a group over budget is
 * drawn to the scale of what was spent: its colour runs to the budget and
 * the overspend carries on in rose. So the tile
 * stays the same size however many groups are over; each bar's name and
 * figures are in its tooltip, and the strip jumps to the budget chart.
 * Below, a short note: the total overspend, how many are ahead of pace,
 * or what's left.
 */
function renderOverBudget(month) {
  const { groups, complete } = budgetStanding(month);
  const over = groups.filter((g) => g.status === 'over');
  const ahead = groups.filter((g) => g.status === 'ahead');
  document.getElementById('stat-over-budget').innerHTML =
    `${over.length}<span class="stat-tile__value-of"> of ${groups.length}</span>`;

  const describe = (g) => `${g.group}: ${currencyShort(g.actual)} of ${currencyShort(g.budget)}`
    + (g.status === 'over' ? `, ${currencyShort(g.actual - g.budget)} over` : g.status === 'ahead' ? ', ahead of pace' : '');
  const strip = document.getElementById('budget-strip');
  strip.innerHTML = groups.map((g) => {
    const scale = Math.max(g.budget, g.actual) || 1;
    const filled = (Math.min(g.actual, g.budget) / scale) * 100;
    return `<span class="budget-strip__bar is-${g.status}" title="${escapeAttr(describe(g))}">`
      + `<span class="budget-strip__fill" style="width:${filled.toFixed(1)}%; background:${BUDGET_GROUP_COLORS[g.group] || 'var(--text-faint)'}"></span>`
      + (g.status === 'over' ? `<span class="budget-strip__over" style="left:${filled.toFixed(1)}%"></span>` : '')
      + '</span>';
  }).join('');
  strip.title = groups.map(describe).join('\n');
  strip.setAttribute('aria-label', `${groups.map(describe).join('; ')}. Go to budget vs actual`);

  const note = document.getElementById('stat-over-budget-note');
  const overBy = over.reduce((sum, g) => sum + g.actual - g.budget, 0);
  const left = groups.filter((g) => g.status !== 'over').reduce((sum, g) => sum + g.budget - g.actual, 0);
  let tone;
  if (over.length) {
    note.textContent = `${currencyShort(overBy)} over in total`;
    tone = 'is-negative';
  } else if (ahead.length) {
    note.textContent = `${ahead.length} ahead of pace`;
    tone = 'is-ahead';
  } else {
    note.textContent = `All within · ${currencyShort(left)} ${complete ? 'unspent' : 'left'}`;
    tone = 'is-positive';
  }
  note.className = `stat-tile__delta stat-tile__delta--truncate ${tone}`;

  // Which groups are over and by how much — "Dining Out (↑£78)" — biggest overspend first, in a
  // two-column grid (six groups fill three rows). The amount always shows; a long name is cut short.
  const UP = '<svg class="over-list__arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor"/></svg>';
  // It takes the note's place, so the total overspend moves to its tooltip.
  const list = document.getElementById('over-budget-list');
  list.hidden = !over.length;
  note.hidden = over.length > 0;
  list.title = over.length ? `${currencyShort(overBy)} over in total` : '';
  list.innerHTML = over
    .slice()
    .sort((a, b) => (b.actual - b.budget) - (a.actual - a.budget))
    .map((g) => `<li title="${escapeAttr(describe(g))}">`
      + `<span class="over-list__dot" style="background:${BUDGET_GROUP_COLORS[g.group] || 'var(--text-faint)'}"></span>`
      + `<span class="over-list__name">${escapeAttr(g.group)}</span>`
      + `<span class="over-list__amount">(${UP}${currencyShort(g.actual - g.budget)}<span class="visually-hidden"> over</span>)</span></li>`)
    .join('');
}

/** The over-budget tile's strip of bars scrolls to the budget chart. */
export function initBudgetStrip() {
  document.getElementById('budget-strip').addEventListener('click', () => {
    document.getElementById('budget-list').closest('.tile')
      .scrollIntoView({ block: 'center', behavior: motion.reduced() ? 'auto' : 'smooth' });
  });
}

/**
 * The "Fixed costs" switch under the Total spend chart: off, the whole
 * tile — its figure (relabelled Everyday spend), change on last month,
 * transaction count, pace, and the chart's lines and target — leaves out
 * fixed expenses. Remembered on this device.
 */
export function initPaceFixedToggle() {
  const toggle = document.getElementById('pace-fixed-toggle');
  const sync = () => toggle.setAttribute('aria-checked', String(!state.paceWithoutFixed));
  sync();
  toggle.addEventListener('click', () => {
    state.paceWithoutFixed = !state.paceWithoutFixed;
    try { localStorage.setItem('ledger-pace-without-fixed', state.paceWithoutFixed ? '1' : '0'); } catch { /* storage unavailable */ }
    sync();
    renderStats();
  });
}

/**
 * A month's figures for the four smaller tiles (and their sparklines).
 * Income counts any salary still expected this month (expectedSalaries),
 * so Income and Total saved don't dip while a payday is still to come.
 * The daily average is over the days loaded so far (all of them once the
 * month is complete). With `upTo`, Total saved and Over budget count only
 * spending in the month's first `upTo` days, set against the whole
 * month's income, to compare with a month still coming in.
 */
function monthFigures(month, upTo = null) {
  const txs = getMonthTransactions(month);
  const expected = expectedSalaries(month);
  const income = txs
    .filter((t) => t.category === 'salary' || t.category === 'interest')
    .reduce((sum, t) => sum + t.amount, 0)
    + expected.reduce((sum, salary) => sum + salary.amount, 0);
  const actualByGroup = budgetGroupActuals(month, upTo);
  return {
    income,
    expected,
    saved: income - sumAbs(transactionsTo(month, upTo).filter(isExpense)),
    dailyAvg: sumAbs(txs.filter(isVariableExpense)) / (daysLoaded(month) || daysIn(month)),
    overBudget: Object.keys(BUDGETS).filter((group) => (actualByGroup[group] || 0) > BUDGETS[group]),
  };
}

const SPARK_MONTHS = 6;
const poundsPence = (n) => `£${Math.abs(n).toFixed(2)}`;

/**
 * For each smaller tile: a pill with the change on last month (green
 * when it's the good direction for that figure, rose when not), and a
 * sparkline of the last six months ending at the selected one. While the
 * month is coming in (`upTo` is its days loaded), Total saved and Over
 * budget compare with last month at the same day; Income (already a
 * whole month's, expected salaries included) and the daily average (a
 * rate) compare with last month as a whole.
 */
function renderTileTrends(idx, upTo) {
  const months = MONTHS.slice(Math.max(0, idx - SPARK_MONTHS + 1), idx + 1).map((m) => m.key);
  const series = months.map((month) => ({ month, ...monthFigures(month) }));
  const now = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const prevToDate = prev && upTo ? monthFigures(prev.month, upTo) : prev;

  const tiles = [
    { key: 'income', value: (f) => f.income, show: (n) => currencyShort(n), betterWhen: 'up' },
    { key: 'saved', value: (f) => f.saved, show: (n) => currencyShort(n), betterWhen: 'up', toDate: true },
    { key: 'daily', value: (f) => f.dailyAvg, show: poundsPence, betterWhen: 'down' },
    { key: 'over-budget', value: (f) => f.overBudget.length, show: (n) => String(n), betterWhen: 'down', count: true, toDate: true },
  ];
  tiles.forEach((tile) => {
    const pill = document.getElementById(`stat-${tile.key}-change`);
    pill.hidden = !prev;
    if (prev) {
      const sameDay = tile.toDate && upTo;
      const base = sameDay ? prevToDate : prev;
      const change = tile.value(now) - tile.value(base);
      const flat = tile.count ? change === 0 : Math.abs(change) < 0.5;
      const good = tile.betterWhen === 'up' ? change > 0 : change < 0;
      pill.textContent = flat
        ? 'No change'
        : tile.count
          ? `${change > 0 ? '+' : '−'}${Math.abs(change)}`
          : `${change > 0 ? '↑' : '↓'} ${tile.key === 'daily' ? poundsPence(change) : currencyShort(Math.abs(change))}`;
      pill.className = `stat-tile__delta stat-tile__delta--pill${flat ? '' : good ? ' is-good' : ' is-bad'}`;
      pill.title = `vs ${MONTH_LABEL(prev.month)}${sameDay ? ` by day ${upTo}` : ''}: ${tile.show(tile.value(base))}`;
    }
    // Over budget lists its groups instead of a sparkline.
    const spark = document.getElementById(`spark-${tile.key}`);
    if (spark) renderSparkline(spark, series.map((f) => ({ month: f.month, value: tile.value(f) })), tile.show);
  });
}

/**
 * A small line of `points` ({ month, value }) filling its box, with a
 * soft wash beneath and a gold dot on the latest month. It draws itself
 * in from the left, but only when its numbers change, so edits elsewhere
 * on the page don't keep replaying it.
 */
function renderSparkline(el, points, show) {
  const key = points.map((p) => `${p.month}:${Math.round(p.value * 100)}`).join('|');
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.hidden = points.length < 2;
  if (el.hidden) { el.innerHTML = ''; return; }

  const width = 100;
  const height = 28;
  const pad = 3;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const xy = points.map((p, i) => [
    (i / (points.length - 1)) * width,
    max === min ? height / 2 : pad + (1 - (p.value - min) / (max - min)) * (height - 2 * pad),
  ]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const [lastX, lastY] = xy[xy.length - 1];
  const fill = `${el.id}-wash`;
  el.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${fill}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="currentColor" stop-opacity="0.16"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${line} L${width} ${height} L0 ${height} Z" fill="url(#${fill})"/>
      <path class="sparkline__line" d="${line}" stroke="currentColor" fill="none"/>
    </svg>
    <span class="sparkline__dot" style="left:${lastX}%; top:${(lastY / height) * 100}%"></span>`;
  const summary = points.map((p) => `${MONTH_LABEL(p.month).slice(0, 3)} ${show(p.value)}`).join(' · ');
  el.title = summary;
  el.setAttribute('aria-label', `Last ${points.length} months: ${summary}`);
}
