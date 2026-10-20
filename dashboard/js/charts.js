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

/** Blends two '#RRGGBB' colours: t = 0 gives `a`, 1 gives `b`. */
function mixHex(a, b, t) {
  const rgb = (hex) => hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Draws a doughnut with a label in its centre and a legend beside it.
 * The centre shows the total; hovering (or tapping) a slice or its legend
 * row lifts that slice, dims the rest and swaps the centre to its name,
 * amount and share. Legends longer than LEGEND_LIMIT get a "+N more" toggle.
 *
 * With `onSelect`, choosing the highlighted slice (a click on desktop,
 * where hovering highlights it; a second tap on touch screens) or a
 * legend row (click, tap or Enter) calls onSelect(entry). `sweep` redraws
 * the ring sweeping round, as when the doughnut switches to new contents.
 *
 *   entries: [{ id, label, total, color: 'var(--token)' or '#RRGGBB' }]
 *   noun: ['category', 'categories'] — for the centre's "10 categories"
 *   count: the number the centre counts, when it isn't entries.length
 */
function renderDonut({ chart, canvasId, legendId, entries, totalLabel, noun, emptyText, onSelect, sweep = false, count = entries.length }) {
  const canvas = document.getElementById(canvasId);
  const wrap = canvas.parentElement;
  const legend = document.getElementById(legendId);
  const colors = entries.map((e) => (e.color.startsWith('var(') ? cssVar(e.color.slice(4, -1)) : e.color));
  const total = entries.reduce((s, e) => s + e.total, 0);
  let active = null;
  let activatedAt = 0;
  let pointer = 'mouse'; // how the last press came in: a touch tap highlights, a second one selects

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
    metaEl.textContent = e ? `${shareOf(e.total, total)} of total` : `${count} ${noun[count === 1 ? 0 : 1]}`;
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
      // First load (and switching contents): the ring sweeps round; other changes are quick.
      animation: firstDraw || sweep ? { duration: firstDraw ? 1100 : 750, easing: 'easeOutQuart' } : { duration: 350 },
      onHover: (_event, elements) => setActive(elements.length ? elements[0].index : null),
      // Touch screens: a tap highlights a slice; tapping it again selects it (or,
      // without onSelect, clears it), as does tapping the middle.
      onClick: (_event, elements) => {
        const index = elements.length ? elements[0].index : null;
        // A tap fires touchstart (which already highlighted it) then click — don't let the click act on it too.
        if (pointer !== 'mouse' && index === active && Date.now() - activatedAt < 500) return;
        if (index !== null && index === active && onSelect) {
          // Selecting usually redraws this chart, so let Chart.js finish handling the click first.
          setTimeout(() => onSelect(entries[index]), 0);
          return;
        }
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
  canvas.onpointerdown = (event) => { pointer = event.pointerType; };
  canvas.style.cursor = onSelect && entries.length ? 'pointer' : '';

  // ---- Legend ----
  const expanded = expandedLegends.has(legendId);
  const extra = Math.max(0, entries.length - LEGEND_LIMIT);
  legend.classList.toggle('is-expanded', expanded);
  legend.classList.toggle('is-selectable', Boolean(onSelect));
  legend.classList.remove('has-active'); // a fresh chart starts with nothing highlighted
  legend.innerHTML = entries.map((e, i) => `
    <li data-index="${i}" data-id="${escapeAttr(e.id)}" tabindex="0" style="--i:${Math.min(i, LEGEND_LIMIT)}"${i >= LEGEND_LIMIT ? ' class="legend__extra"' : ''}>
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
    const i = rowIndex(event);
    if (i === null) return;
    if (onSelect) { onSelect(entries[i]); return; }
    setActive(i === active ? null : i); // tap on touch screens
  };
  legend.onkeydown = (event) => {
    const i = rowIndex(event);
    if (i === null || !onSelect || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onSelect(entries[i], { keyboard: true });
  };

  canvas.setAttribute('aria-label', entries.length
    ? `${totalLabel} ${currency(total)}: ${entries.map((e) => `${e.label} ${currency(e.total)} (${shareOf(e.total, total)})`).join(', ')}`
    : emptyText);
  showCenter(null);
  return instance;
}
renderDonut.rerender = {};

let categoryDrill = null; // the category the doughnut is opened into, if any

/**
 * Renders the "spending by category" doughnut (excl. fixed expenses).
 * Choosing a category opens it: the ring sweeps round into that
 * category's merchants, shaded from its colour, with a back arrow (or
 * Escape) to return and "Show transactions" to filter the table to it.
 * It stays open across month changes while the category has spending.
 * `sweep` plays the sweep (when opening or closing).
 */
function renderCategoryChart({ sweep = false } = {}) {
  const variable = getMonthTransactions(state.month).filter(isVariableExpense);
  const totals = categoryTotals(variable);
  if (categoryDrill && !totals[categoryDrill]) categoryDrill = null;
  const category = categoryDrill && catById[categoryDrill];

  let entries;
  if (category) {
    // One slice per merchant, in shades of the category's colour.
    entries = shadeEntries(merchantEntries(variable.filter((t) => t.category === category.id)), category.color);
  } else {
    entries = CATEGORIES
      .filter((c) => isVariableExpense({ category: c.id }))
      .map((c) => ({ id: c.id, label: c.label, color: c.color, total: totals[c.id] || 0 }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);
  }

  categoryChart = renderDonut({
    chart: categoryChart,
    canvasId: 'category-chart',
    legendId: 'category-legend',
    entries,
    totalLabel: category ? category.label : 'Excl. fixed',
    noun: category ? ['merchant', 'merchants'] : ['category', 'categories'],
    emptyText: 'No spending this month',
    onSelect: category ? null : (entry, how) => openCategory(entry.id, how),
    sweep,
  });

  document.getElementById('category-chart-meta').textContent = `${entries.length} categories`;
  setDrillHeader('category', category ? category.label : null, 'Spending by category', sweep);
}

/**
 * Updates a doughnut tile's header for being opened (`drilledLabel`) or
 * not: the title, back arrow, "Show transactions" and meta. Elements are
 * found by prefix, e.g. 'category' -> #category-chart-title. `sweep`
 * lets the title and legend settle in with the new ring.
 */
function setDrillHeader(prefix, drilledLabel, title, sweep) {
  const drilled = drilledLabel !== null;
  const tile = document.getElementById(`${prefix}-chart`).closest('.chart-tile');
  tile.classList.toggle('is-drilled', drilled);
  document.getElementById(`${prefix}-chart-title`).textContent = drilled ? drilledLabel : title;
  document.getElementById(`${prefix}-back`).hidden = !drilled;
  document.getElementById(`${prefix}-show-table`).hidden = !drilled;
  document.getElementById(`${prefix}-chart-meta`).hidden = drilled;
  if (sweep && !motion.reduced()) {
    tile.classList.remove('is-switching');
    void tile.offsetWidth;
    tile.classList.add('is-switching');
    clearTimeout(tile.switchTimer);
    tile.switchTimer = setTimeout(() => tile.classList.remove('is-switching'), 700);
  }
}
renderDonut.rerender['category-legend'] = () => renderCategoryChart();

/**
 * Opens the doughnut into a category's merchants (or, with null, back
 * to all categories). From the keyboard, focus moves to the back arrow.
 */
function openCategory(categoryId, { keyboard = false } = {}) {
  categoryDrill = categoryId;
  expandedLegends.delete('category-legend'); // each view starts with its legend folded
  renderCategoryChart({ sweep: true });
  if (categoryId && keyboard) document.getElementById('category-back').focus({ preventScroll: true });
}

/** Wires up the category doughnut's back arrow, Escape and "Show transactions". */
function initCategoryDrill() {
  initDrill({
    prefix: 'category',
    current: () => categoryDrill,
    open: openCategory,
    showTable: () => setCategoryFilter(categoryDrill),
  });
}

/**
 * Wires up an openable doughnut's back arrow, Escape (while the pointer
 * is over the tile or focus is in it) and "Show transactions", which
 * filters the table and scrolls to it.
 */
function initDrill({ prefix, current, open, showTable }) {
  const tile = document.getElementById(`${prefix}-chart`).closest('.chart-tile');
  const back = document.getElementById(`${prefix}-back`);
  back.addEventListener('click', (event) => {
    const from = current();
    open(null);
    // From the keyboard (Enter, or Escape below), focus returns to the opened row.
    if (event.detail === 0) document.querySelector(`#${prefix}-legend [data-id="${CSS.escape(from)}"]`)?.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !current()) return;
    if (tile.matches(':hover') || tile.contains(document.activeElement)) back.click();
  });
  document.getElementById(`${prefix}-show-table`).addEventListener('click', () => {
    showTable();
    document.querySelector('.table-tile').scrollIntoView({ block: 'start', behavior: motion.reduced() ? 'auto' : 'smooth' });
  });
}

/** Filters the transactions table down to a single category. */
function setCategoryFilter(categoryId) {
  state.categories = new Set([categoryId]);
  syncTableFilters();
  renderTable();
}

let userDrill = null;        // the user the doughnut is opened into, if any
const USER_DRILL_LIMIT = 10; // transactions given their own slice when opened into a user

/** One doughnut entry per merchant (names matched regardless of case/spacing), biggest first. */
function merchantEntries(transactions) {
  const byMerchant = new Map();
  transactions.forEach((t) => {
    const key = t.merchant.trim().toLowerCase();
    const entry = byMerchant.get(key) || { id: key, label: t.merchant.trim(), total: 0 };
    entry.total += Math.abs(t.amount);
    byMerchant.set(key, entry);
  });
  return [...byMerchant.values()].sort((a, b) => b.total - a.total);
}

/** Colours entries in shades of `color`, fading towards the card for smaller ones. */
function shadeEntries(entries, color) {
  const base = color.startsWith('var(') ? cssVar(color.slice(4, -1)) : color;
  const surface = cssVar('--surface');
  entries.forEach((e, i) => { e.color = mixHex(base, surface, entries.length > 1 ? (i / (entries.length - 1)) * 0.62 : 0); });
  return entries;
}

/**
 * Renders the "spending by user" doughnut. Fixed expenses get their own
 * slice rather than counting towards a user, so spend splits into Fixed
 * Expenses plus each user (e.g. Joint, Taj). Colours follow the user (see
 * spendOwnerColor), not their rank, so they don't swap month to month.
 *
 * Choosing a user opens it, as the category doughnut does: into that
 * user's biggest transactions (the rest share one "Other" slice), with a
 * back arrow (or Escape) and "Show transactions" to filter the table to them.
 */
function renderUserChart({ sweep = false } = {}) {
  const expenses = (TRANSACTIONS[state.month] || []).filter((transaction) => !transaction.hidden && isExpense(transaction));
  const totals = {};
  expenses.forEach((transaction) => {
    const user = spendOwner(transaction);
    totals[user] = (totals[user] || 0) + Math.abs(transaction.amount);
  });
  if (userDrill && !totals[userDrill]) userDrill = null;

  let entries;
  let count;
  if (userDrill) {
    // The user's biggest transactions, in shades of their colour; the rest share a grey "Other" slice.
    const own = expenses
      .filter((t) => spendOwner(t) === userDrill)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    count = own.length;
    entries = shadeEntries(own.slice(0, USER_DRILL_LIMIT).map((t, i) => ({
      id: String(t.id ?? i),
      label: `${t.merchant.trim()} · ${formatDate(t.date).replace(/^0/, '')}`,
      total: Math.abs(t.amount),
    })), spendOwnerColor(userDrill));
    const rest = own.slice(USER_DRILL_LIMIT);
    if (rest.length) {
      entries.push({
        id: 'other',
        label: `Other (${rest.length})`,
        total: rest.reduce((sum, t) => sum + Math.abs(t.amount), 0),
        color: cssVar('--border'),
      });
    }
  } else {
    entries = Object.entries(totals)
      .map(([user, total]) => ({ id: user, label: user, total, color: spendOwnerColor(user) }))
      .filter((entry) => entry.total > 0)
      .sort((a, b) => b.total - a.total);
  }

  userChart = renderDonut({
    chart: userChart,
    canvasId: 'user-chart',
    legendId: 'user-legend',
    entries,
    totalLabel: userDrill || 'Total spend',
    noun: userDrill ? ['transaction', 'transactions'] : ['group', 'groups'],
    count,
    emptyText: 'No spending this month',
    onSelect: userDrill ? null : (entry, how) => openUser(entry.id, how),
    sweep,
  });
  if (!userDrill) {
    const userCount = entries.filter((entry) => entry.id !== FIXED_EXPENSES_LABEL).length;
    document.getElementById('user-chart-meta').textContent = `${userCount} user${userCount === 1 ? '' : 's'}`;
  }
  setDrillHeader('user', userDrill, 'Spending by user', sweep);
}
renderDonut.rerender['user-legend'] = () => renderUserChart();

/**
 * Opens the user doughnut into a user's spending (or, with null, back to
 * everyone). From the keyboard, focus moves to the back arrow.
 */
function openUser(user, { keyboard = false } = {}) {
  userDrill = user;
  expandedLegends.delete('user-legend'); // each view starts with its legend folded
  renderUserChart({ sweep: true });
  if (user && keyboard) document.getElementById('user-back').focus({ preventScroll: true });
}

/** Wires up the user doughnut's back arrow, Escape and "Show transactions". */
function initUserDrill() {
  initDrill({
    prefix: 'user',
    current: () => userDrill,
    open: openUser,
    showTable: () => {
      state.users = new Set([userDrill]);
      syncTableFilters();
      renderTable();
    },
  });
}

/** Each budget group's colour, shared by the budget bars and the Over budget tile's strip. */
const BUDGET_GROUP_COLORS = {
  'Fixed Expenses': 'var(--cat-fixed-expense)',
  'Dining Out': 'var(--cat-dining)',
  Groceries: 'var(--cat-groceries)',
  Shopping: 'var(--cat-shopping)',
  Transport: 'var(--cat-transport)',
  Extras: 'var(--budget-extras)',
};

/** The date each budget group's running total first went over its budget, e.g. { Groceries: '2026-10-14' }. */
function budgetCrossings(month) {
  const running = {};
  const crossed = {};
  getMonthTransactions(month)
    .filter(isExpense)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((t) => {
      const group = BUDGET_GROUPS[t.category] || 'Extras';
      running[group] = (running[group] || 0) + Math.abs(t.amount);
      if (!crossed[group] && BUDGETS[group] && running[group] > BUDGETS[group]) crossed[group] = t.date;
    });
  return crossed;
}

/**
 * Renders the budget-vs-actual bars. Each bar carries a fine gold tick
 * at where spending would be by now if spread evenly over the month (it
 * and the note turn amber when a group is ahead of it). A group over
 * budget is drawn to the scale of what was spent: its colour fills to
 * the budget line, and the overspend runs on past it as rose stripes.
 * Under each bar, a quiet note says what's left per day, how far ahead
 * of pace it is, or when it went over. Fixed Expenses skips the pace and
 * per-day figures, as bills land on set dates rather than evenly.
 */
function renderBudgetChart() {
  const groupNames = Object.keys(BUDGETS); // chart order follows BUDGETS in state.js
  const actualByGroup = budgetGroupActuals(state.month);

  const entries = groupNames.map((name) => ({
    label: name,
    actual: actualByGroup[name] || 0,
    budget: BUDGETS[name] || 0,
    color: BUDGET_GROUP_COLORS[name],
  }));
  // How far through the month the data runs (statements arrive in batches).
  const days = daysIn(state.month);
  const loaded = daysLoaded(state.month);
  const complete = loaded >= days;
  const daysLeft = days - loaded;
  const crossings = budgetCrossings(state.month);

  const list = document.getElementById('budget-list');
  list.classList.toggle('is-entering', isFirstDraw('budget-list')); // bars grow in on first load
  list.innerHTML = entries.map((entry, i) => {
    const { actual, budget } = entry;
    const percentage = budget ? Math.round((actual / budget) * 100) : 0;
    const over = budget > 0 && actual > budget;
    const steady = entry.label !== 'Fixed Expenses'; // spent through the month, so pace applies
    const paceAmount = budget * (loaded / days);
    const showPace = steady && budget > 0 && !complete && loaded > 0 && !over;
    const ahead = showPace && actual > paceAmount;

    // The bar's scale: the budget, or what was spent once that's more.
    const scale = Math.max(budget, actual) || 1;
    const fillWidth = (Math.min(actual, budget) / scale) * 100;
    const limitAt = (budget / scale) * 100;
    const pacePosition = (paceAmount / scale) * 100;

    // Under budget: "78%". Over: "£20 over", in rose.
    const status = over ? `${currencyShort(actual - budget)} over` : `${percentage}%`;
    let note = '';
    let tone = '';
    if (over) {
      const date = crossings[entry.label];
      note = date ? `Went over on ${formatDate(date).replace(/^0/, '')}` : 'Over budget';
      tone = 'is-negative';
    } else if (budget > 0 && complete) {
      note = `${currencyShort(budget - actual)} unspent`;
      tone = 'is-positive';
    } else if (budget > 0 && !steady) {
      note = `${currencyShort(budget - actual)} left`;
    } else if (budget > 0) {
      const perDay = daysLeft > 0 ? `${currencyShort((budget - actual) / daysLeft)}/day left` : `${currencyShort(budget - actual)} left`;
      note = ahead ? `${currencyShort(actual - paceAmount)} ahead of pace · ${perDay}` : perDay;
      tone = ahead ? 'is-ahead' : '';
    }

    const label = `${entry.label}: ${currencyShort(actual)} of ${currencyShort(budget)} budget (${percentage}%)`
      + (showPace ? `, pace for today ${currencyShort(paceAmount)}` : '');
    return `
      <li class="budget-item${over ? ' is-over' : ''}${ahead ? ' is-ahead' : ''}" style="--i:${i}">
        <div class="budget-item__header">
          <span class="budget-item__category">${entry.label}</span>
          <span class="budget-item__summary">
            <span class="budget-item__amounts">${currencyShort(actual)} of ${currencyShort(budget)}</span>
            <span class="budget-item__status">${status}</span>
          </span>
        </div>
        <div class="budget-item__bar" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="${Math.max(100, percentage)}" aria-label="${label}">
          <span class="budget-item__track">
            <span class="budget-item__fill" style="width:${fillWidth}%; background:${entry.color}"></span>
            ${over ? `<span class="budget-item__overflow" style="left:${limitAt}%; width:${100 - limitAt}%"></span>` : ''}
          </span>
          ${over ? `<span class="budget-item__limit" style="left:${limitAt}%" title="Budget ${currencyShort(budget)}"></span>` : ''}
          ${showPace ? `<span class="budget-item__pace" style="left:${pacePosition}%" title="Pace for day ${loaded}: ${currencyShort(paceAmount)}"></span>` : ''}
        </div>
        ${note ? `<p class="budget-item__note ${tone}">${note}</p>` : ''}
      </li>
    `;
  }).join('') || '<li class="legend__name">No spending this month</li>';
  document.getElementById('budget-chart-meta').textContent = complete || !loaded
    ? `${entries.length} groups`
    : `Day ${loaded} of ${days}`;
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

/** A month's spending (the transactions `keep` accepts) as a running total, one value per day. */
function runningTotals(month, keep = isExpense) {
  const byDay = new Array(daysIn(month)).fill(0);
  getMonthTransactions(month).filter(keep).forEach((t) => {
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
 * monthPace (stats.js) and is null when there's no target. With the
 * tile's "Fixed costs" switch off, all three leave out fixed expenses.
 */
function renderPaceChart(pace) {
  const month = state.month;
  const days = daysIn(month);
  const labels = Array.from({ length: days }, (_, i) => i + 1);
  const loaded = daysLoaded(month);
  // The tile's "Fixed costs" switch: off, every line here is everyday spending only.
  const keep = state.paceWithoutFixed ? isVariableExpense : isExpense;
  // (The tooltip says which target; the legend keeps one wording so the switch beside it never shifts.)
  const targetLabel = state.paceWithoutFixed ? 'Everyday target' : 'Target pace';
  const thisMonth = runningTotals(month, keep).map((value, i) => (i < loaded ? value : null));
  const prevKey = shiftMonth(month, -1);
  const prev = TRANSACTIONS[prevKey]?.length ? runningTotals(prevKey, keep) : null;
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
          label: targetLabel,
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
  canvas.setAttribute('aria-label', `Running total${state.paceWithoutFixed ? ' of everyday spending (excluding fixed expenses)' : ''} for ${MONTH_LABEL(month)}: ${currency(thisMonth[loaded - 1] || 0)} by day ${loaded}`
    + (prev ? `, against ${currency(lastMonth[Math.max(loaded, 1) - 1])} by the same day last month` : '')
    + (pace ? `, and a ${currency(pace.target)} target` : ''));
}

/**
 * The three figures along the foot of the Spending trend tile: the
 * average of the full months shown, the highest of them, and this
 * month's forecast against its target (or, when this month isn't
 * shown, the latest month against the average).
 */
function renderTrendSummary({ months, fixed, everyday, toCome, target, currentMonth }) {
  const spent = months.map((_, i) => fixed[i] + everyday[i]);
  const full = months.map((key, i) => ({ key, total: spent[i] })).filter((m) => m.key !== currentMonth && m.total > 0);
  const average = full.length ? full.reduce((s, m) => s + m.total, 0) / full.length : null;
  const highest = full.reduce((best, m) => (!best || m.total > best.total ? m : best), null);
  const monthName = (key) => MONTH_LABEL(key).split(' ')[0];
  const versus = (value, base, noun) => {
    const gap = value - base;
    return { text: `${currencyShort(Math.abs(gap))} ${gap > 0 ? 'over' : 'under'} ${noun}`, tone: gap > 0 ? 'is-negative' : 'is-positive' };
  };

  const items = [];
  if (average !== null) {
    items.push({ label: 'Monthly average', value: currencyShort(average), note: { text: `Last ${full.length} full month${full.length === 1 ? '' : 's'}` } });
  }
  if (highest) {
    items.push({ label: 'Highest', value: currencyShort(highest.total), note: { text: MONTH_LABEL(highest.key) } });
  }
  const i = months.indexOf(currentMonth);
  if (i >= 0) {
    const forecast = spent[i] + toCome[i];
    items.push({
      label: `${monthName(currentMonth)} forecast`,
      value: currencyShort(forecast),
      note: target[i] !== null ? versus(forecast, target[i], 'target') : average !== null ? versus(forecast, average, 'average') : { text: '' },
    });
  } else {
    const last = months.length - 1;
    items.push({
      label: monthName(months[last]),
      value: currencyShort(spent[last]),
      note: average !== null ? versus(spent[last], average, 'average') : { text: '' },
    });
  }

  document.getElementById('trend-summary').innerHTML = items.map((item) => `
    <div class="trend-summary__item">
      <dt>${item.label}</dt>
      <dd class="trend-summary__value">${item.value}</dd>
      <dd class="trend-summary__note ${item.note.tone || ''}">${item.note.text}</dd>
    </div>`).join('');
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

  renderTrendSummary({ months, fixed, everyday, toCome, target, currentMonth });

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
