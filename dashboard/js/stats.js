/**
 * stats.js
 * ---------------------------------------------------------------------
 * Renders the stat tiles at the top of the dashboard: total spend,
 * income, total saved, transaction count, and daily average.
 * ---------------------------------------------------------------------
 */

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

  document.getElementById('stat-total').textContent = currency(total);
  const deltaEl = document.getElementById('stat-total-delta');
  if (prevTotal !== null && prevTotal > 0) {
    const pct = ((total - prevTotal) / prevTotal) * 100;
    const sign = pct >= 0 ? '+' : '';
    deltaEl.textContent = `${sign}${pct.toFixed(1)}% vs last month`;
    deltaEl.className = 'stat-tile__delta ' + (pct >= 0 ? 'is-up' : 'is-down');
  } else {
    deltaEl.textContent = 'No prior month data';
    deltaEl.className = 'stat-tile__delta';
  }

  const income = txs
    .filter((t) => t.category === 'salary' || t.category === 'interest')
    .reduce((sum, t) => sum + t.amount, 0);
  document.getElementById('stat-income').textContent = currency(income);

  const saved = income - total;
  document.getElementById('stat-saved').textContent = saved < 0 ? `-${currency(-saved)}` : currency(saved);
  const savedNote = document.getElementById('stat-saved-note');
  if (income > 0) {
    savedNote.textContent = `${((saved / income) * 100).toFixed(1)}% of income`;
    savedNote.className = 'stat-tile__delta ' + (saved >= 0 ? 'is-positive' : 'is-negative');
  } else {
    savedNote.textContent = 'Income − total spend';
    savedNote.className = 'stat-tile__delta';
  }

  const expenseCount = txs.filter(isExpense).length;
  document.getElementById('stat-count').textContent = txs.length;
  const avg = expenseCount ? total / expenseCount : 0;
  document.getElementById('stat-avg').textContent = expenseCount ? `${currency(avg)} avg / expense` : '—';

  const [y, m] = state.month.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  document.getElementById('stat-daily-avg').textContent = currency(total / dim);
  document.getElementById('stat-daily-note').textContent = `Across ${dim} days`;

  document.getElementById('page-subtitle').textContent = `Spending summary — ${MONTH_LABEL(state.month)}`;
}
