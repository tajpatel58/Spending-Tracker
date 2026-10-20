/**
 * charts.js
 * ---------------------------------------------------------------------
 * Renders the charts: the month's running total in the Total spend
 * tile, spending by category, spending by user, the 6-month spending
 * trend, and budget vs actual. Uses Chart.js, loaded via CDN in
 * index.html.
 * ---------------------------------------------------------------------
 */

let categoryChart, trendChart, userChart, paceChart;

const LEGEND_LIMIT = 6;               // legend rows shown before "+N more"
const expandedLegends = new Set();    // legends the viewer has expanded (kept across re-renders)
const drawnCharts = new Set();        // charts that have played their first, slower draw-in

/**
 * True the first time a chart is drawn on this page load (and motion is
 * allowed): that render sweeps/grows in slowly; later re-renders (month
 * changes, refreshes) stay quick.
 */
function isFirstDraw(id) {
  if (drawnCharts.has(id)) return false;
  drawnCharts.add(id);
  return !motion.reduced();
}

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
  const firstDraw = isFirstDraw(canvasId);
  const instance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: entries.map((e) => e.label),
      datasets: [{
        data: entries.length ? entries.map((e) => e.total) : [1],
        backgroundColor: entries.length
          ? (c) => (active === null || c.dataIndex === active ? colors[c.dataIndex] : fade(colors[c.dataIndex], 0.28))
          : [cssVar('--border')],
        // A slim ring of rounded slices with real gaps between them.
        borderWidth: 0,
        spacing: entries.length > 1 ? 3 : 0,
        borderRadius: 3, // softened ends; fully round turns small slices into beads
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: '84%',
      layout: { padding: 8 }, // room for the lifted slice
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      // First load: the ring sweeps round once; afterwards changes are quick.
      animation: firstDraw ? { duration: 1100, easing: 'easeOutQuart' } : { duration: 350 },
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
  const list = document.getElementById('budget-list');
  list.classList.toggle('is-entering', isFirstDraw('budget-list')); // bars grow in on first load
  list.innerHTML = entries.map((entry, i) => {
    const percentage = entry.budget ? Math.round((entry.actual / entry.budget) * 100) : 0;
    const progress = Math.min(percentage, 100);
    const over = entry.budget > 0 && entry.actual > entry.budget;
    // Under budget: "78%". Over: "£20 over", in rose (the bar simply fills).
    const status = over ? `${currencyShort(entry.actual - entry.budget)} over` : `${percentage}%`;
    return `
      <li class="budget-item${over ? ' is-over' : ''}">
        <div class="budget-item__header">
          <span class="budget-item__category">${entry.label}</span>
          <span class="budget-item__summary">
            <span class="budget-item__amounts">${currencyShort(entry.actual)} of ${currencyShort(entry.budget)}</span>
            <span class="budget-item__status">${status}</span>
          </span>
        </div>
        <div class="budget-item__track" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="${Math.max(100, percentage)}" aria-label="${entry.label}:${currencyShort(entry.actual)} of ${currencyShort(entry.budget)} budget (${percentage}%)">
          <span class="budget-item__fill" style="width:${progress}%; background:${entry.color}; --i:${i}"></span>
        </div>
      </li>
    `;
  }).join('') || '<li class="legend__name">No spending this month</li>';
  document.getElementById('budget-chart-meta').textContent = `${entries.length} groups`;
}

/** Diagonal stripes in `color` — the "still to come" part of this month's bar. */
function stripePattern(color) {
  const size = 8;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const g = tile.getContext('2d');
  g.fillStyle = fade(color, 0.16);
  g.fillRect(0, 0, size, size);
  g.strokeStyle = fade(color, 0.6);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-2, size + 2); g.lineTo(size + 2, -2);
  g.moveTo(-2, 2); g.lineTo(2, -2);
  g.moveTo(size - 2, size + 2); g.lineTo(size + 2, size - 2);
  g.stroke();
  return g.createPattern(tile, 'repeat');
}

/**
 * Chart.js `external` tooltip drawn as HTML, so it matches the app's menus
 * (frosted surface, serif title, tabular figures) and glides between bars.
 *
 *   build(dataPoints) -> { title, rows: [{ label, value, swatch }], footer: [label, value] }
 *   swatch is a CSS background, or 'line' for the dashed target line.
 */
function htmlTooltip(build) {
  return ({ chart, tooltip }) => {
    const wrap = chart.canvas.parentElement;
    let el = wrap.querySelector('.chart-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.className = 'chart-tooltip';
      el.setAttribute('aria-hidden', 'true');
      wrap.appendChild(el);
    }
    if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
      el.classList.remove('is-visible');
      return;
    }

    const { title, rows, footer } = build(tooltip.dataPoints);
    el.innerHTML = `
      <p class="chart-tooltip__title">${escapeAttr(title)}</p>
      ${rows.map((row) => `
        <p class="chart-tooltip__row">
          <i class="chart-tooltip__swatch${row.swatch === 'line' ? ' chart-tooltip__swatch--line' : ''}"${row.swatch === 'line' ? '' : ` style="background:${row.swatch}"`}></i>
          <span>${escapeAttr(row.label)}</span><b>${row.value}</b>
        </p>`).join('')}
      ${footer ? `<p class="chart-tooltip__row chart-tooltip__row--total"><span>${footer[0]}</span><b>${footer[1]}</b></p>` : ''}`;

    // Beside the hovered bar (flipping to the other side near the edge), vertically clamped.
    const gap = 14;
    const x0 = chart.canvas.offsetLeft + tooltip.caretX;
    const y0 = chart.canvas.offsetTop + tooltip.caretY;
    const { offsetWidth: w, offsetHeight: h } = el;
    const x = x0 + gap + w > wrap.clientWidth ? x0 - gap - w : x0 + gap;
    const y = Math.min(Math.max(y0 - h / 2, 0), wrap.clientHeight - h);
    if (!el.classList.contains('is-visible')) el.classList.add('is-placing'); // appear in place, don't glide in
    el.style.setProperty('--x', `${Math.round(x)}px`);
    el.style.setProperty('--y', `${Math.round(y)}px`);
    void el.offsetWidth;
    el.classList.remove('is-placing');
    el.classList.add('is-visible');
  };
}

/** A month's spending as a running total, one value per day. */
function runningTotals(month) {
  const byDay = new Array(daysIn(month)).fill(0);
  getMonthTransactions(month).filter(isExpense).forEach((t) => {
    byDay[Number(t.date.slice(8, 10)) - 1] += Math.abs(t.amount);
  });
  let sum = 0;
  return byDay.map((value) => (sum += value));
}

/**
 * The Total spend tile's chart: this month's running total day by day,
 * shaded beneath and ending in a dot on the last day with data; last
 * month's running total (dashed) for comparison; and a straight gold
 * line climbing to the month's spending target. `pace` comes from
 * monthPace (stats.js) and is null when there's no target.
 */
function renderPaceChart(pace) {
  const month = state.month;
  const days = daysIn(month);
  const labels = Array.from({ length: days }, (_, i) => i + 1);
  const loaded = daysLoaded(month);
  const thisMonth = runningTotals(month).map((value, i) => (i < loaded ? value : null));
  const prevKey = shiftMonth(month, -1);
  const prev = TRANSACTIONS[prevKey]?.length ? runningTotals(prevKey) : null;
  // Day 31 against a 30-day month compares with its last day.
  const lastMonth = prev ? labels.map((d) => prev[Math.min(d, prev.length) - 1]) : [];
  const target = pace ? labels.map((d) => pace.target * (d / days)) : [];

  const accent = cssVar('--accent');
  const gold = cssVar('--gold');
  const muted = cssVar('--text-faint');
  const surface = cssVar('--surface');
  const monthName = MONTH_LABEL(month).split(' ')[0];
  const peak = Math.max(0, ...thisMonth.filter((v) => v !== null), ...lastMonth, ...target);

  // A hairline down from the hovered day.
  const hoverLine = {
    id: 'hoverLine',
    afterDatasetsDraw(chart) {
      const active = chart.tooltip?.getActiveElements();
      if (!active?.length) return;
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.strokeStyle = cssVar('--border-strong');
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(active[0].element.x, chartArea.top);
      ctx.lineTo(active[0].element.x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  const canvas = document.getElementById('pace-chart');
  if (paceChart) paceChart.destroy();
  canvas.parentElement.querySelector('.chart-tooltip')?.classList.remove('is-visible');
  const firstDraw = isFirstDraw('pace-chart');
  paceChart = new Chart(canvas, {
    type: 'line',
    plugins: [hoverLine],
    data: {
      labels,
      datasets: [
        {
          label: monthName,
          data: thisMonth,
          borderColor: accent,
          borderWidth: 2,
          cubicInterpolationMode: 'monotone',
          fill: 'origin',
          // Soft wash of the accent fading to nothing at the baseline.
          backgroundColor: ({ chart }) => {
            const { ctx, chartArea } = chart;
            if (!chartArea) return 'transparent';
            const wash = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            wash.addColorStop(0, fade(accent, 0.2));
            wash.addColorStop(1, fade(accent, 0));
            return wash;
          },
          pointRadius: (c) => (c.dataIndex === loaded - 1 ? 4 : 0), // the latest day with data
          pointHoverRadius: 4,
          pointBackgroundColor: surface,
          pointBorderColor: accent,
          pointBorderWidth: 2,
          order: 1,
        },
        {
          label: MONTH_LABEL(prevKey).split(' ')[0],
          data: lastMonth,
          borderColor: muted,
          borderWidth: 1.25,
          borderDash: [3, 3],
          cubicInterpolationMode: 'monotone',
          pointRadius: 0,
          pointHoverRadius: 3,
          pointBackgroundColor: muted,
          order: 2,
        },
        {
          label: 'Target pace',
          data: target,
          borderColor: gold,
          borderWidth: 1.25,
          borderDash: [1, 3],
          pointRadius: 0,
          pointHoverRadius: 3,
          pointBackgroundColor: gold,
          order: 2,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      layout: { padding: { top: 6, left: 2, right: 6 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          filter: (item) => item.raw !== null && item.raw !== undefined,
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          external: htmlTooltip((points) => ({
            title: `${points[0].label} ${monthName}`,
            rows: points.map((p) => ({
              label: p.dataset.label,
              value: currency(p.raw),
              swatch: [accent, 'line', gold][p.datasetIndex],
            })),
          })),
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            padding: 4,
            color: muted,
            font: { family: 'Geist', size: 11 },
            callback: (_value, i) => ([0, 7, 14, 21, days - 1].includes(i) ? `${labels[i]} ${monthName.slice(0, 3)}` : ''),
          },
        },
        y: { display: false, beginAtZero: true, suggestedMax: peak * 1.08 },
      },
      // First load: the lines rise in slowly; later changes (month, edits) are quick.
      animation: firstDraw ? { duration: 1000, easing: 'easeOutQuart' } : { duration: 400 },
    },
  });
  document.getElementById('pace-legend-this').textContent = monthName;
  document.getElementById('pace-legend-last').textContent = MONTH_LABEL(prevKey).split(' ')[0];
  document.getElementById('pace-legend-last-item').hidden = !prev;
  document.getElementById('pace-legend-target-item').hidden = !pace;
  canvas.setAttribute('aria-label', `Running total for ${MONTH_LABEL(month)}: ${currency(thisMonth[loaded - 1] || 0)} by day ${loaded}`
    + (prev ? `, against ${currency(lastMonth[Math.max(loaded, 1) - 1])} by the same day last month` : '')
    + (pace ? `, and a ${currency(pace.target)} target` : ''));
}

/**
 * Renders the spending trend for the last six months: each month's bar
 * splits into fixed costs and everyday spending, the current month adds
 * a striped "still to come" segment up to its forecast (forecast.js), and
 * a dashed line marks each month's spending target (last month's salary
 * minus the savings target). The selected month is drawn in full colour;
 * clicking a bar jumps to that month.
 */
function renderTrendChart() {
  const months = MONTHS.slice(-6).map((m) => m.key);
  const currentMonth = todayIso().slice(0, 7);
  const sumOf = (key, keep) => sumAbs(getMonthTransactions(key).filter(keep));
  const fixed = months.map((key) => sumOf(key, (t) => t.category === 'fixed_expense'));
  const everyday = months.map((key) => sumOf(key, isVariableExpense));
  const toCome = months.map((key, i) => (key === currentMonth
    ? Math.max(0, forecastSpend(key).total - fixed[i] - everyday[i])
    : 0));
  const target = months.map((key) => spendingAllowance(key));

  const colors = { fixed: cssVar('--forecast-fixed'), everyday: cssVar('--forecast-spent'), toCome: cssVar('--forecast-projected') };
  const dimUnlessSelected = (color) => (c) => (months[c.dataIndex] === state.month ? color : fade(color, 0.45));
  const segment = { borderColor: cssVar('--surface'), borderWidth: 2, borderSkipped: false, borderRadius: 6, maxBarThickness: 36, stack: 'spend' };
  const swatches = { Fixed: colors.fixed, Everyday: colors.everyday, 'Still to come': colors.toCome };
  const text = cssVar('--text');
  const faint = cssVar('--text-faint');

  const ctx = document.getElementById('trend-chart');
  if (trendChart) trendChart.destroy();
  ctx.parentElement.querySelector('.chart-tooltip')?.classList.remove('is-visible'); // e.g. after clicking a bar
  const firstDraw = isFirstDraw('trend-chart');
  trendChart = new Chart(ctx, {
    data: {
      labels: months.map((key) => MONTH_LABEL(key).split(' ')[0].slice(0, 3)),
      datasets: [
        { type: 'bar', label: 'Fixed', data: fixed, backgroundColor: dimUnlessSelected(colors.fixed), ...segment, order: 2 },
        { type: 'bar', label: 'Everyday', data: everyday, backgroundColor: dimUnlessSelected(colors.everyday), ...segment, order: 2 },
        { type: 'bar', label: 'Still to come', data: toCome, backgroundColor: stripePattern(colors.toCome), ...segment, order: 2 },
        {
          type: 'line',
          label: 'Spending target',
          data: target,
          borderColor: cssVar('--text-muted'),
          borderWidth: 1.25,
          borderDash: [4, 4],
          pointRadius: 2.5,
          pointHoverRadius: 4,
          pointBackgroundColor: cssVar('--surface'),
          pointBorderColor: cssVar('--text-muted'),
          pointBorderWidth: 1.25,
          tension: 0,
          spanGaps: true,
          order: 1,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick: (_event, elements) => {
        if (!elements.length || typeof setMonth !== 'function') return;
        // Switching month redraws this chart, so let Chart.js finish handling the click first.
        const month = months[elements[0].index];
        setTimeout(() => setMonth(month), 0);
      },
      onHover: (event, elements) => { event.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          filter: (item) => item.raw !== null && item.raw !== 0,
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex, // bar parts bottom-up, then the target
          external: htmlTooltip((points) => {
            const i = points[0].dataIndex;
            const spent = fixed[i] + everyday[i];
            return {
              title: MONTH_LABEL(months[i]),
              rows: points.map((p) => ({
                label: p.dataset.label,
                value: currency(p.raw),
                swatch: p.dataset.type === 'line' ? 'line' : swatches[p.dataset.label],
              })),
              footer: toCome[i] ? ['Forecast', currency(spent + toCome[i])] : ['Total', currency(spent)],
            };
          }),
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { display: false },
          ticks: {
            padding: 6,
            font: (c) => ({ family: 'Geist', size: 11.5, weight: months[c.index] === state.month ? '600' : '400' }),
            color: (c) => (months[c.index] === state.month ? text : faint),
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          // Hairline dashed gridlines (border.dash styles the grid lines in Chart.js 4).
          border: { display: false, dash: [2, 4] },
          grid: { color: cssVar('--border-strong'), lineWidth: 1, drawTicks: false },
          ticks: { color: faint, padding: 10, maxTicksLimit: 5, font: { family: 'Geist', size: 11 }, callback: (v) => currencyShort(v) },
        },
      },
      // First load: bars rise one month after another; afterwards changes are quick.
      animation: firstDraw
        ? { duration: 800, easing: 'easeOutQuart', delay: (c) => (c.type === 'data' && c.mode === 'default' ? c.dataIndex * 70 : 0) }
        : { duration: 450 },
    },
  });
}
