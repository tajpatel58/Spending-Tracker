/**
 * stats.js
 * ---------------------------------------------------------------------
 * Renders the stat tiles at the top of the dashboard: the large total
 * spend tile (with its pace against the target, the transaction count
 * and the running-total chart from charts.js), then income, total saved,
 * daily average, and the number of budget categories that are over
 * budget.
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
 * Spend so far against the month's spending target (spendingAllowance),
 * pro rata for the days loaded — or against the whole target once the
 * month is complete. Null when there's no target (no salary last month).
 */
function monthPace(month, spent) {
  const target = spendingAllowance(month);
  if (target === null) return null;
  const days = daysIn(month);
  const loaded = daysLoaded(month);
  const expected = target * (loaded / days);
  return { target, expected, gap: expected - spent, complete: loaded >= days, loaded };
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

  // "£180 under pace": spend so far against where the target says it should be by now.
  const paceEl = document.getElementById('stat-pace');
  const pace = monthPace(state.month, total);
  paceEl.hidden = !pace;
  if (pace) {
    const under = pace.gap >= 0;
    paceEl.textContent = `${currencyShort(Math.abs(pace.gap))} ${under ? 'under' : 'over'} ${pace.complete ? 'target' : 'pace'}`;
    paceEl.className = 'stat-tile__delta ' + (under ? 'is-positive' : 'is-negative');
    paceEl.title = pace.complete
      ? `Target ${currency(pace.target)} (last month's salary less ${currencyShort(MONTHLY_SAVINGS_TARGET)} savings)`
      : `By day ${pace.loaded} the ${currency(pace.target)} target allows ${currency(pace.expected)}`;
  }

  const income = txs
    .filter((t) => t.category === 'salary' || t.category === 'interest')
    .reduce((sum, t) => sum + t.amount, 0);
  document.getElementById('stat-income').innerHTML = moneyMarkup(currency(income));

  const saved = income - total;
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

  const [y, m] = state.month.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const variableTotal = txs.filter(isVariableExpense).reduce((s, t) => s + Math.abs(t.amount), 0);
  document.getElementById('stat-daily-avg').innerHTML = moneyMarkup(currency(variableTotal / dim));
  document.getElementById('stat-daily-note').textContent = 'Excluding Fixed Expenses';

  const actualByGroup = budgetGroupActuals(state.month);
  const overBudget = Object.keys(BUDGETS).filter((group) => (actualByGroup[group] || 0) > BUDGETS[group]);
  document.getElementById('stat-over-budget').textContent = overBudget.length;
  const overBudgetNote = document.getElementById('stat-over-budget-note');
  overBudgetNote.textContent = overBudget.length ? overBudget.join(', ') : `All ${Object.keys(BUDGETS).length} within budget`;
  overBudgetNote.title = overBudgetNote.textContent;
  overBudgetNote.className = 'stat-tile__delta stat-tile__delta--truncate ' + (overBudget.length ? 'is-negative' : 'is-positive');

  document.getElementById('page-subtitle').textContent = `Spending overview — ${MONTH_LABEL(state.month)}`;
  renderPaceChart(pace);
}
