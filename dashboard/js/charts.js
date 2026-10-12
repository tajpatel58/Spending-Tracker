/**
 * charts.js
 * ---------------------------------------------------------------------
 * Renders the four charts: spending by category, spending by user, the
 * 6-month spending trend, and budget vs actual. Uses Chart.js, loaded
 * via CDN in index.html.
 * ---------------------------------------------------------------------
 */

let categoryChart, trendChart, userChart;

const LEGEND_LIMIT = 6;               // legend rows shown before "+N more"
const expandedLegends = new Set();    // legends the viewer has expanded (kept across re-renders)

/** '#RRGGBB' -> 'rgba(r, g, b, a)', for dimming the slices that aren't highlighted. */
function fade(hex, alpha) {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

const shareOf = (part, whole) => {
  const pct = whole ? (part / whole) * 100 : 0;
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
};

/**
 * Draws a doughnut with a label in its centre and a legend beside it.
 * The centre shows the total; hovering (or tapping) a slice or its legend
 * row lifts that slice, dims the rest and swaps the centre to its name,
 * amount and share. Legends longer than LEGEND_LIMIT get a "+N more" toggle.
 *
 *   entries: [{ id, label, total, color: 'var(--token)' }]
 *   noun: ['category', 'categories'] — for the centre's "10 categories"
 */
function renderDonut({ chart, canvasId, legendId, entries, totalLabel, noun, emptyText, onDblClick }) {
  const canvas = document.getElementById(canvasId);
  const wrap = canvas.parentElement;
  const legend = document.getElementById(legendId);
  const colors = entries.map((e) => cssVar(e.color.slice(4, -1)));
  const total = entries.reduce((s, e) => s + e.total, 0);
  let active = null;
  let activatedAt = 0;

  // ---- Centre label ----
  let center = wrap.querySelector('.donut-center');
  if (!center) {
    center = document.createElement('div');
    center.className = 'donut-center';
    center.setAttribute('aria-hidden', 'true');
    center.innerHTML = '<span class="donut-center__label"></span><span class="donut-center__value"></span><span class="donut-center__meta"></span>';
    wrap.appendChild(center);
  }
  const [labelEl, valueEl, metaEl] = center.children;
  const showCenter = (index) => {
    const e = entries[index];
    center.classList.toggle('is-focused', Boolean(e));
    labelEl.textContent = e ? e.label : totalLabel;
    valueEl.textContent = currencyShort(e ? e.total : total);
    metaEl.textContent = e ? `${shareOf(e.total, total)} of total` : `${entries.length} ${noun[entries.length === 1 ? 0 : 1]}`;
    if (e) center.style.setProperty('--focus-color', colors[index]);
  };

  // ---- Chart ----
  if (chart) chart.destroy();
  const instance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: entries.map((e) => e.label),
      datasets: [{
        data: entries.length ? entries.map((e) => e.total) : [1],
        backgroundColor: entries.length
          ? (c) => (active === null || c.dataIndex === active ? colors[c.dataIndex] : fade(colors[c.dataIndex], 0.28))
          : [cssVar('--border')],
        borderWidth: 2,
        borderColor: cssVar('--surface'),
        hoverBorderColor: cssVar('--surface'),
        hoverOffset: 7,
        borderRadius: 3,
      }],
    },
    options: {
      cutout: '74%',
      layout: { padding: 8 }, // room for the lifted slice
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 350 },
      onHover: (_event, elements) => setActive(elements.length ? elements[0].index : null),
      // Touch screens: a tap selects a slice; tapping it again (or the middle) clears it.
      onClick: (_event, elements) => {
        const index = elements.length ? elements[0].index : null;
        // A tap fires touchstart (which already selected it) then click — don't let the click undo it.
        if (index === active && Date.now() - activatedAt < 500) return;
        setActive(index === active ? null : index);
      },
    },
  });

  function setActive(index) {
    if (!entries.length || index === active) return;
    active = index;
    activatedAt = Date.now();
    instance.setActiveElements(index === null ? [] : [{ datasetIndex: 0, index }]);
    instance.update('none');
    showCenter(index);
    legend.querySelectorAll('[data-index]').forEach((li) => {
      li.classList.toggle('is-active', Number(li.dataset.index) === index);
    });
    legend.classList.toggle('has-active', index !== null);
  }
  canvas.onmouseleave = () => setActive(null);
  if (onDblClick) {
    canvas.ondblclick = (event) => {
      const hit = instance.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
      if (hit.length) onDblClick(entries[hit[0].index]);
    };
  }

  // ---- Legend ----
  const expanded = expandedLegends.has(legendId);
  const extra = Math.max(0, entries.length - LEGEND_LIMIT);
  legend.classList.toggle('is-expanded', expanded);
  legend.innerHTML = entries.map((e, i) => `
    <li data-index="${i}" data-id="${escapeAttr(e.id)}" tabindex="0"${i >= LEGEND_LIMIT ? ' class="legend__extra"' : ''}>
      <span class="legend__swatch" style="background:${e.color}"></span>
      <span class="legend__name">${escapeAttr(e.label)}</span>
      <span class="legend__amount">${currencyShort(e.total)}</span>
    </li>
  `).join('')
    + (extra ? `<li class="legend__toggle"><button type="button">${expanded ? 'Show less' : `+${extra} more`}</button></li>` : '')
    || `<li class="legend__name">${emptyText}</li>`;

  const rowIndex = (event) => {
    const li = event.target.closest('[data-index]');
    return li ? Number(li.dataset.index) : null;
  };
  legend.onmouseover = (event) => { const i = rowIndex(event); if (i !== null) setActive(i); };
  legend.onmouseleave = () => setActive(null);
  legend.onfocusin = (event) => { const i = rowIndex(event); if (i !== null) setActive(i); };
  legend.onfocusout = (event) => { if (!legend.contains(event.relatedTarget)) setActive(null); };
  legend.onclick = (event) => {
    if (event.target.closest('.legend__toggle')) {
      expanded ? expandedLegends.delete(legendId) : expandedLegends.add(legendId);
      renderDonut.rerender[legendId]?.();
      return;
    }
    const i = rowIndex(event); // tap on touch screens
    if (i !== null) setActive(i === active ? null : i);
  };
  legend.ondblclick = (event) => {
    const i = rowIndex(event);
    if (i !== null && onDblClick) onDblClick(entries[i]);
  };

  canvas.setAttribute('aria-label', entries.length
    ? `${totalLabel} ${currency(total)}: ${entries.map((e) => `${e.label} ${currency(e.total)} (${shareOf(e.total, total)})`).join(', ')}`
    : emptyText);
  showCenter(null);
  return instance;
}
renderDonut.rerender = {};

/**
 * Renders the "spending by category" doughnut (excl. fixed expenses).
 * Double-clicking a slice or legend row filters the transactions table
 * to that category (see setCategoryFilter below).
 */
function renderCategoryChart() {
  const totals = categoryTotals(getMonthTransactions(state.month).filter(isVariableExpense));
  const entries = CATEGORIES
    .filter((c) => isVariableExpense({ category: c.id }))
    .map((c) => ({ id: c.id, label: c.label, color: c.color, total: totals[c.id] || 0 }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  categoryChart = renderDonut({
    chart: categoryChart,
    canvasId: 'category-chart',
    legendId: 'category-legend',
    entries,
    totalLabel: 'Excl. fixed',
    noun: ['category', 'categories'],
    emptyText: 'No spending this month',
    onDblClick: (entry) => setCategoryFilter(entry.id),
  });
  document.getElementById('category-chart-meta').textContent = `${entries.length} categories`;
}
renderDonut.rerender['category-legend'] = () => renderCategoryChart();

/** Filters the transactions table down to a single category. */
function setCategoryFilter(categoryId) {
  state.categories = new Set([categoryId]);
  syncTableFilters();
  renderTable();
}

/**
 * Renders the "spending by user" doughnut. Fixed expenses get their own
 * slice rather than counting towards a user, so spend splits into Fixed
 * Expenses plus each user (e.g. Joint, Taj). Colours follow the user (see
 * spendOwnerColor), not their rank, so they don't swap month to month.
 */
function renderUserChart() {
  const totals = {};
  (TRANSACTIONS[state.month] || [])
    .filter((transaction) => !transaction.hidden && isExpense(transaction))
    .forEach((transaction) => {
      const user = spendOwner(transaction);
      totals[user] = (totals[user] || 0) + Math.abs(transaction.amount);
    });
  const entries = Object.entries(totals)
    .map(([user, total]) => ({ id: user, label: user, total, color: spendOwnerColor(user) }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);

  userChart = renderDonut({
    chart: userChart,
    canvasId: 'user-chart',
    legendId: 'user-legend',
    entries,
    totalLabel: 'Total spend',
    noun: ['group', 'groups'],
    emptyText: 'No spending this month',
  });
  const userCount = entries.filter((entry) => entry.id !== FIXED_EXPENSES_LABEL).length;
  document.getElementById('user-chart-meta').textContent = `${userCount} user${userCount === 1 ? '' : 's'}`;
}
renderDonut.rerender['user-legend'] = () => renderUserChart();

/** Renders the budget-vs-actual progress bars. */
function renderBudgetChart() {
  const groupNames = Object.keys(BUDGETS); // chart order follows BUDGETS in state.js
  const groupColors = {
    'Fixed Expenses': 'var(--cat-fixed-expense)',
    'Dining Out': 'var(--cat-dining)',
    Groceries: 'var(--cat-groceries)',
    Shopping: 'var(--cat-shopping)',
    Transport: 'var(--cat-transport)',
    Extras: 'var(--budget-extras)',
  };
  const actualByGroup = budgetGroupActuals(state.month);

  const entries = groupNames.map((name) => ({
    label: name,
    actual: actualByGroup[name] || 0,
    budget: BUDGETS[name] || 0,
    color: groupColors[name],
  }));
  document.getElementById('budget-list').innerHTML = entries.map((entry) => {
    const percentage = entry.budget ? Math.round((entry.actual / entry.budget) * 100) : 0;
    const progress = Math.min(percentage, 100);
    return `
      <li class="budget-item">
        <div class="budget-item__header">
          <span class="budget-item__category">${entry.label}</span>
          <span class="budget-item__summary">${currencyShort(entry.actual)} / ${currencyShort(entry.budget)} - ${percentage}%</span>
        </div>
        <div class="budget-item__track" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100" aria-label="${entry.label} budget usage">
          <span class="budget-item__fill" style="width:${progress}%; background:${entry.color}"></span>
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
