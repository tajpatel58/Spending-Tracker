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

/**
 * How many days of a month have data loaded: up to the latest loaded
 * transaction in the month it falls in, every day of months before it.
 * Statements arrive in batches, so this can trail today.
 */
function daysLoaded(month) {
  const loadedTo = lastLoadedDate();
  if (!loadedTo || loadedTo.slice(0, 7) < month) return 0;
  if (loadedTo.slice(0, 7) > month) return daysIn(month);
  return Number(loadedTo.slice(8, 10));
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
function renderStats() {
  const txs = getMonthTransactions(state.month);
  const total = txs.filter(isExpense).reduce((s, t) => s + Math.abs(t.amount), 0);

  const idx = MONTHS.findIndex((m) => m.key === state.month);
  const prevKey = idx > 0 ? MONTHS[idx - 1].key : null;
  const prevTotal = prevKey ? monthTotal(prevKey) : null;

  // Headline figures: pence set smaller (moneyMarkup in format.js).
  document.getElementById('stat-total').innerHTML = moneyMarkup(currency(total));
  const deltaEl = document.getElementById('stat-total-delta');
  if (prevTotal !== null && prevTotal > 0) {
    const pct = ((total - prevTotal) / prevTotal) * 100;
    deltaEl.textContent = `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}% vs last month`;
    deltaEl.className = 'stat-tile__delta stat-tile__delta--pill ' + (pct >= 0 ? 'is-up' : 'is-down');
  } else {
    deltaEl.textContent = 'No prior month';
    deltaEl.className = 'stat-tile__delta stat-tile__delta--pill';
  }

  // "£180 under pace": spend so far against where the target says it should be by now
  // (or, with the chart's "Fixed costs" switch off, everyday spend against the target less fixed costs).
  const paceEl = document.getElementById('stat-pace');
  const withoutFixed = state.paceWithoutFixed;
  const paceSpend = withoutFixed ? sumAbs(txs.filter(isVariableExpense)) : total;
  const pace = monthPace(state.month, paceSpend, { withoutFixed });
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
  document.getElementById('stat-saved').innerHTML = moneyMarkup(currency(saved));
  const savedNote = document.getElementById('stat-saved-note');
  if (income > 0) {
    savedNote.textContent = `${signedFixed((saved / income) * 100, 1)}% of income`;
    savedNote.className = 'stat-tile__delta ' + (saved >= 0 ? 'is-positive' : 'is-negative');
  } else {
    savedNote.textContent = 'Income − total spend';
    savedNote.className = 'stat-tile__delta';
  }

  const expenseCount = txs.filter(isExpense).length;
  const avg = expenseCount ? total / expenseCount : 0;
  document.getElementById('stat-count-note').textContent = `${txs.length} transaction${txs.length === 1 ? '' : 's'}`
    + (expenseCount ? ` · ${currency(avg)} avg` : '');

  document.getElementById('stat-daily-avg').innerHTML = moneyMarkup(currency(figures.dailyAvg));
  document.getElementById('stat-daily-note').textContent = 'Excluding Fixed Expenses';

  const { overBudget } = figures;
  document.getElementById('stat-over-budget').textContent = overBudget.length;
  const overBudgetNote = document.getElementById('stat-over-budget-note');
  overBudgetNote.textContent = overBudget.length ? overBudget.join(', ') : `All ${Object.keys(BUDGETS).length} within budget`;
  overBudgetNote.title = overBudgetNote.textContent;
  overBudgetNote.className = 'stat-tile__delta stat-tile__delta--truncate ' + (overBudget.length ? 'is-negative' : 'is-positive');

  renderTileTrends(idx);

  document.getElementById('page-subtitle').textContent = `Spending overview — ${MONTH_LABEL(state.month)}`;
  renderPaceChart(pace);
}

/**
 * The "Fixed costs" switch under the Total spend chart: off, the chart's
 * lines, its target and the pace above it leave out fixed expenses, for
 * the pace of everyday spending. Remembered on this device.
 */
function initPaceFixedToggle() {
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

/** A month's figures for the four smaller tiles (and their sparklines). */
function monthFigures(month) {
  const txs = getMonthTransactions(month);
  const income = txs
    .filter((t) => t.category === 'salary' || t.category === 'interest')
    .reduce((sum, t) => sum + t.amount, 0);
  const actualByGroup = budgetGroupActuals(month);
  return {
    income,
    saved: income - sumAbs(txs.filter(isExpense)),
    dailyAvg: sumAbs(txs.filter(isVariableExpense)) / daysIn(month),
    overBudget: Object.keys(BUDGETS).filter((group) => (actualByGroup[group] || 0) > BUDGETS[group]),
  };
}

const SPARK_MONTHS = 6;
const poundsPence = (n) => `£${Math.abs(n).toFixed(2)}`;

/**
 * For each smaller tile: a pill with the change on last month (green
 * when it's the good direction for that figure, rose when not), and a
 * sparkline of the last six months ending at the selected one.
 */
function renderTileTrends(idx) {
  const months = MONTHS.slice(Math.max(0, idx - SPARK_MONTHS + 1), idx + 1).map((m) => m.key);
  const series = months.map((month) => ({ month, ...monthFigures(month) }));
  const now = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;

  const tiles = [
    { key: 'income', value: (f) => f.income, show: (n) => currencyShort(n), betterWhen: 'up' },
    { key: 'saved', value: (f) => f.saved, show: (n) => currencyShort(n), betterWhen: 'up' },
    { key: 'daily', value: (f) => f.dailyAvg, show: poundsPence, betterWhen: 'down' },
    { key: 'over-budget', value: (f) => f.overBudget.length, show: (n) => String(n), betterWhen: 'down', count: true },
  ];
  tiles.forEach((tile) => {
    const pill = document.getElementById(`stat-${tile.key}-change`);
    pill.hidden = !prev;
    if (prev) {
      const change = tile.value(now) - tile.value(prev);
      const flat = tile.count ? change === 0 : Math.abs(change) < 0.5;
      const good = tile.betterWhen === 'up' ? change > 0 : change < 0;
      pill.textContent = flat
        ? 'No change'
        : tile.count
          ? `${change > 0 ? '+' : '−'}${Math.abs(change)}`
          : `${change > 0 ? '↑' : '↓'} ${tile.key === 'daily' ? poundsPence(change) : currencyShort(Math.abs(change))}`;
      pill.className = `stat-tile__delta stat-tile__delta--pill${flat ? '' : good ? ' is-good' : ' is-bad'}`;
      pill.title = `vs ${MONTH_LABEL(prev.month)}: ${tile.show(tile.value(prev))}`;
    }
    renderSparkline(document.getElementById(`spark-${tile.key}`), series.map((f) => ({ month: f.month, value: tile.value(f) })), tile.show);
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
