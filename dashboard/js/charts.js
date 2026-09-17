/**
 * charts.js
 * ---------------------------------------------------------------------
 * Renders the four charts: spending by category, spending by user, the
 * 6-month spending trend, and budget vs actual. Uses Chart.js, loaded
 * via CDN in index.html.
 * ---------------------------------------------------------------------
 */

let categoryChart, trendChart, userChart;

/**
 * Renders the "spending by category" donut chart and its legend.
 * Double-clicking a slice or legend row filters the transactions table
 * to that category (see setCategoryFilter below).
 * API: replace totals with `fetch(`/api/analytics/summary?month=${month}`)`
 */
function renderCategoryChart() {
  const txs = getMonthTransactions(state.month);
  const totals = categoryTotals(txs.filter(isExpense));
  const entries = CATEGORIES
    .filter((c) => isExpense({ category: c.id }))
    .map((c) => ({ ...c, total: totals[c.id] || 0 }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  const ctx = document.getElementById('category-chart');
  const colors = entries.map((e) => cssVar(e.color.replace('var(', '').replace(')', '')));

  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map((e) => e.label),
      datasets: [{
        data: entries.map((e) => e.total),
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: cssVar('--surface'),
      }],
    },
    options: {
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${currency(c.raw)}` } } },
      animation: { duration: 250 },
    },
  });

  ctx.ondblclick = (event) => {
    const elements = categoryChart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
    if (!elements.length) return;
    setCategoryFilter(entries[elements[0].index].id);
  };

  document.getElementById('category-chart-meta').textContent = `${entries.length} categories`;

  const legend = document.getElementById('category-legend');
  legend.innerHTML = entries.slice(0, 6).map((e) => `
    <li data-category-id="${e.id}">
      <span class="legend__swatch" style="background:${e.color}"></span>
      <span class="legend__name">${e.label}</span>
      <span class="legend__amount">${currencyShort(e.total)}</span>
    </li>
  `).join('') || '<li class="legend__name">No spending this month</li>';
  legend.ondblclick = (event) => {
    const item = event.target.closest('[data-category-id]');
    if (item) setCategoryFilter(item.dataset.categoryId);
  };
}

/** Filters the transactions table down to a single category. */
function setCategoryFilter(categoryId) {
  state.categoryFilter = categoryId;
  state.activeCategories.add(categoryId);
  document.querySelector(`.chip[data-cat="${categoryId}"]`)?.classList.add('is-active');
  updateCategoryFilterControl();
  renderTable();
}

/** Renders the "spending by user" donut chart and its legend. */
function renderUserChart() {
  const allTransactions = TRANSACTIONS[state.month] || [];
  const totals = {};
  allTransactions
    .filter((transaction) => !transaction.hidden && isExpense(transaction))
    .forEach((transaction) => {
      const user = transaction.user || 'Unknown';
      totals[user] = (totals[user] || 0) + Math.abs(transaction.amount);
    });

  const entries = Object.entries(totals)
    .map(([user, total]) => ({ user, total }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);
  const colors = entries.map((_, index) => [cssVar('--accent'), cssVar('--gold'), cssVar('--rose')][index % 3]);
  const ctx = document.getElementById('user-chart');

  if (userChart) userChart.destroy();
  userChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map((entry) => entry.user),
      datasets: [{
        data: entries.map((entry) => entry.total),
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: cssVar('--surface'),
      }],
    },
    options: {
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${currency(c.raw)}` } } },
      animation: { duration: 250 },
    },
  });

  document.getElementById('user-chart-meta').textContent = `${entries.length} users`;
  document.getElementById('user-legend').innerHTML = entries.map((entry, index) => `
    <li>
      <span class="legend__swatch" style="background:${colors[index]}"></span>
      <span class="legend__name">${entry.user}</span>
      <span class="legend__amount">${currencyShort(entry.total)}</span>
    </li>
  `).join('') || '<li class="legend__name">No spending this month</li>';
}

/** Renders the budget-vs-actual progress bars. */
function renderBudgetChart() {
  const totals = categoryTotals(getMonthTransactions(state.month).filter(isExpense));
  const groupNames = ['Dining Out', 'Groceries', 'Housing', 'Shopping', 'Transport', 'Health', 'Extras'];
  const groupColors = {
    'Dining Out': 'var(--cat-dining)',
    Groceries: 'var(--cat-groceries)',
    Housing: 'var(--cat-housing)',
    Shopping: 'var(--cat-shopping)',
    Transport: 'var(--cat-transport)',
    Health: 'var(--cat-health)',
    Extras: 'var(--cat-other)',
  };
  const actualByGroup = {};

  CATEGORIES.filter(isExpense).forEach((category) => {
    const groupName = BUDGET_GROUPS[category.id] || 'Extras';
    actualByGroup[groupName] = (actualByGroup[groupName] || 0) + (totals[category.id] || 0);
  });

  const entries = groupNames.map((name) => ({
    label: name,
    actual: actualByGroup[name] || 0,
    budget: BUDGETS[name] || 0,
    color: groupColors[name],
  }));
  document.getElementById('budget-list').innerHTML = entries.map((entry) => {
    const percentage = entry.budget ? Math.round((entry.actual / entry.budget) * 100) : 0;
    const progress = Math.min(percentage, 100);
    const fillColor = percentage > 100 ? 'var(--rose)' : entry.color;
    return `
      <li class="budget-item">
        <div class="budget-item__header">
          <span class="budget-item__category">${entry.label}</span>
          <span class="budget-item__summary">${currencyShort(entry.actual)} / ${currencyShort(entry.budget)} - ${percentage}%</span>
        </div>
        <div class="budget-item__track" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100" aria-label="${entry.label} budget usage">
          <span class="budget-item__fill" style="width:${progress}%; background:${fillColor}"></span>
        </div>
      </li>
    `;
  }).join('') || '<li class="legend__name">No spending this month</li>';
  document.getElementById('budget-chart-meta').textContent = `${entries.length} groups`;
}

/**
 * Renders the 6-month spending trend line chart.
 * API: replace with `fetch('/api/analytics/trend?months=6')`
 */
function renderTrendChart() {
  const labels = MONTHS.map((m) => MONTH_LABEL(m.key).split(' ')[0]);
  const data = MONTHS.map((m) => monthTotal(m.key));
  const accent = cssVar('--accent');
  const gridColor = cssVar('--border');
  const textColor = cssVar('--text-faint');

  const ctx = document.getElementById('trend-chart');
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: accent,
        backgroundColor: (c) => {
          const g = c.chart.ctx.createLinearGradient(0, 0, 0, 180);
          g.addColorStop(0, accent + '33');
          g.addColorStop(1, accent + '00');
          return g;
        },
        fill: true,
        tension: 0.35,
        pointRadius: (c) => (labels[c.dataIndex] === MONTH_LABEL(state.month).split(' ')[0] ? 4 : 0),
        pointBackgroundColor: accent,
        pointBorderColor: cssVar('--surface'),
        pointBorderWidth: 2,
        borderWidth: 2,
      }],
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${currency(c.raw)}` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { family: 'IBM Plex Mono', size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'IBM Plex Mono', size: 11 }, callback: (v) => currencyShort(v) }, beginAtZero: true },
      },
      animation: { duration: 250 },
    },
  });
}
