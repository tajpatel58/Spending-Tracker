/**
 * calendar.js
 * ---------------------------------------------------------------------
 * Entry point for calendar.html — a month calendar of spend per day.
 * Each day is shaded by how heavy its spending was compared with the
 * other spending days that month (quintiles, so one big rent payment
 * doesn't wash out every other day): a single green, light for the
 * lightest days through to deep green for the heaviest. Clicking a day lists its
 * transactions and calendar events (with their rough budgets) alongside
 * the calendar; days with an event get a small dot. A stat tile
 * forecasts the month's total spend (see forecastSpend).
 *
 * Reuses the dashboard's data loading (data.js), filters (state.js,
 * filters.js) and expense rules (isExpense), so totals match the
 * Overview page for the same month and accounts.
 * ---------------------------------------------------------------------
 */

const calendarView = {
  selectedDate: null, // 'YYYY-MM-DD'; reset when the month changes — today in the current month, else the heaviest day
  month: null,
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Makes every month with transactions or events selectable, plus the
 * current month (even if it's empty so far), and opens on the current
 * month unless one was already picked this session.
 */
function initCalendarMonths() {
  const currentMonth = todayIso().slice(0, 7);
  const keys = new Set([
    ...MONTHS.map((m) => m.key),
    ...Object.keys(EVENTS_BY_DATE).map((date) => date.slice(0, 7)),
    currentMonth,
  ]);
  MONTHS.splice(0, MONTHS.length, ...[...keys].sort().map((key) => ({ key })));
  if (!keys.has(state.month)) state.month = currentMonth;
}

const monthName = (key) => MONTH_LABEL(key).split(' ')[0];

/**
 * Renders a breakdown card's visual: a stacked bar (one segment per
 * part, sized by amount) and a worked sum underneath — one row per part
 * with its operator, explanation and amount, then the result.
 *
 *   rows: [{ op: '+', label, detail?, amount, color?, kind?: 'subtotal' | 'total' }]
 *   segments: [{ label, amount, color }] — what the bar shows
 */
function renderBreakdown(prefix, segments, rows) {
  const bar = document.getElementById(`${prefix}-bar`);
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.amount), 0);
  bar.innerHTML = total > 0
    ? segments.filter((seg) => seg.amount > 0).map((seg) => `
        <span class="breakdown-bar__seg" style="flex-grow:${seg.amount};background:var(${seg.color})" title="${escapeAttr(seg.label)}: ${currency(seg.amount)}"></span>
      `).join('')
    : '';
  bar.setAttribute('aria-label', segments.map((seg) => `${seg.label} ${currency(seg.amount)}`).join(', '));

  document.getElementById(`${prefix}-list`).innerHTML = rows.map((row) => `
    <div class="breakdown-row${row.kind ? ` breakdown-row--${row.kind}` : ''}${row.negative ? ' is-negative' : ''}">
      <span class="breakdown-row__op" aria-hidden="true">${row.op || ''}</span>
      <span class="breakdown-row__swatch"${row.color ? ` style="background:var(${row.color})"` : ''} aria-hidden="true"></span>
      <span class="breakdown-row__label">${row.label}${row.detail ? `<small>${row.detail}</small>` : ''}</span>
      <span class="breakdown-row__amount">${row.amount}</span>
    </div>
  `).join('');
}

/** Forecast spend card: what the month's total is expected to be, and why. */
function renderForecastBreakdown(forecast) {
  document.getElementById('cal-forecast').innerHTML = moneyMarkup(currency(forecast.total));
  document.getElementById('cal-forecast-note').textContent = forecast.daysLeft
    ? `${plural(forecast.daysLeft, 'day')} still to come${forecast.loadedTo ? ` · data to ${formatDate(forecast.loadedTo)}` : ''}`
    : 'Every day has loaded';

  const parts = [
    { label: 'Fixed expenses', detail: 'Average of the last 3 months', amount: forecast.fixed, color: '--forecast-fixed' },
    { label: 'Spent so far', detail: 'Excluding fixed expenses', amount: forecast.spent, color: '--forecast-spent' },
    { label: 'Projected spending', detail: `${currency(forecast.dailyAvg)}/day × ${plural(forecast.daysLeft, 'day')} · excl. fixed & holidays`, amount: forecast.projected, color: '--forecast-projected' },
    { label: 'Upcoming events', detail: forecast.eventCount ? `${plural(forecast.eventCount, 'event')} still to come` : 'No events still to come', amount: forecast.eventBudget, color: '--forecast-events' },
  ];
  renderBreakdown('cal-forecast', parts, [
    ...parts.map((p, i) => ({ ...p, op: i ? '+' : '', amount: currency(p.amount) })),
    { op: '=', label: 'Forecast spend', amount: currency(forecast.total), kind: 'total' },
  ]);
}

/**
 * "Max spend per day": how much can be spent on each day not loaded yet
 * while still hitting the savings target.
 *
 *   allowed   = last month's salary − MONTHLY_SAVINGS_TARGET
 *   remaining = allowed − spent so far (excl. fixed)
 *                       − fixed expenses (3-month average)
 *                       − budgets of events still to come (days not loaded yet)
 *   max/day   = remaining ÷ days not loaded yet
 */
function renderMaxSpendPerDay(month, forecast) {
  const value = document.getElementById('cal-max-day');
  const note = document.getElementById('cal-max-day-note');
  note.className = 'stat-tile__delta';

  const prev = shiftMonth(month, -1);
  const salary = monthSalary(prev);
  if (salary <= 0) {
    value.textContent = '—';
    note.textContent = `Needs last month's salary — none found in ${monthName(prev)}`;
    renderBreakdown('cal-max-day', [], []);
    return;
  }

  const allowed = salary - MONTHLY_SAVINGS_TARGET;
  const remaining = allowed - forecast.spent - forecast.fixed - forecast.eventBudget;
  const perDay = forecast.daysLeft ? remaining / forecast.daysLeft : null;

  if (remaining <= 0) {
    value.innerHTML = moneyMarkup(currency(0));
    note.textContent = `${currency(-remaining)} over budget`;
    note.classList.add('is-negative');
  } else if (perDay === null) {
    value.textContent = '—';
    note.textContent = `Every day has loaded · ${currency(remaining)} under budget`;
  } else {
    value.innerHTML = `${moneyMarkup(currency(perDay))}<span class="breakdown-card__unit">/day</span>`;
    note.textContent = `${currency(remaining)} left over ${plural(forecast.daysLeft, 'day')}`;
  }

  // The bar is the month's spending budget, split into what's committed and what's left.
  const committed = [
    { label: 'Spent so far', amount: forecast.spent, color: '--forecast-spent' },
    { label: 'Fixed expenses', amount: forecast.fixed, color: '--forecast-fixed' },
    { label: 'Upcoming events', amount: forecast.eventBudget, color: '--forecast-events' },
  ];
  const segments = [...committed, { label: 'Left to spend', amount: Math.max(0, remaining), color: '--forecast-projected' }];
  renderBreakdown('cal-max-day', segments, [
    { op: '', label: 'Available to spend', detail: `${currencyShort(salary)} ${monthName(prev)} salary − ${currencyShort(MONTHLY_SAVINGS_TARGET)} savings target`, amount: currency(allowed), kind: 'subtotal' },
    { op: '−', ...committed[0], detail: 'Excluding fixed expenses', amount: currency(forecast.spent) },
    { op: '−', ...committed[1], detail: 'Average of the last 3 months', amount: currency(forecast.fixed) },
    { op: '−', ...committed[2], detail: forecast.eventCount ? `${plural(forecast.eventCount, 'event')} still to come` : 'No events still to come', amount: currency(forecast.eventBudget) },
    { op: '=', label: 'Left to spend', color: remaining > 0 ? '--forecast-projected' : null, amount: currency(remaining), kind: 'subtotal', negative: remaining < 0 },
    ...(perDay !== null && remaining > 0 ? [
      { op: '÷', label: 'Max spend per day', detail: `${currency(remaining)} ÷ ${plural(forecast.daysLeft, 'day')} without transactions yet`, amount: currency(perDay), kind: 'total' },
    ] : []),
  ]);
}

/** Salary + interest received in a month (after the account filter). */
function monthIncome(month) {
  return getMonthTransactions(month)
    .filter((t) => t.category === 'salary' || t.category === 'interest')
    .reduce((s, t) => s + t.amount, 0);
}

/**
 * "Forecast savings": income minus forecast spend, against
 * MONTHLY_SAVINGS_TARGET. Uses this month's income once salary has
 * landed, otherwise the average of the previous three months with data.
 */
function renderForecastSavings(month, forecast) {
  const salaryIn = getMonthTransactions(month).some((t) => t.category === 'salary');
  const history = [1, 2, 3].map((n) => shiftMonth(month, -n)).filter((key) => TRANSACTIONS[key]?.length);
  const income = salaryIn || !history.length
    ? monthIncome(month)
    : history.reduce((s, key) => s + monthIncome(key), 0) / history.length;
  const savings = income - forecast.total;
  const gap = savings - MONTHLY_SAVINGS_TARGET;

  document.getElementById('cal-savings').innerHTML = moneyMarkup(currency(savings));
  document.getElementById('cal-savings-bar').style.width = `${Math.max(0, Math.min(1, savings / MONTHLY_SAVINGS_TARGET)) * 100}%`;
  const note = document.getElementById('cal-savings-note');
  note.className = `stat-tile__delta stat-tile__delta--truncate ${gap >= 0 ? 'is-positive' : 'is-negative'}`;
  note.textContent = gap >= 0
    ? `${currencyShort(gap)} above ${currencyShort(MONTHLY_SAVINGS_TARGET)} target`
    : `${currencyShort(-gap)} short of ${currencyShort(MONTHLY_SAVINGS_TARGET)} target`;
  document.getElementById('cal-savings-tile').title =
    `Income ${currency(income)} (${salaryIn ? 'this month' : '3-month average — salary not in yet'}) − forecast spend ${currency(forecast.total)}`;
}

/**
 * "Vs last month": spend so far (excl. fixed expenses) against last
 * month's by the same day of the month. "So far" ends at the last loaded day, so a part-loaded
 * month isn't compared with all of last month.
 */
function renderVsLastMonth(month) {
  const value = document.getElementById('cal-vs-last');
  const note = document.getElementById('cal-vs-last-note');
  note.className = 'stat-tile__delta stat-tile__delta--truncate';

  const prev = shiftMonth(month, -1);
  const loadedTo = lastLoadedDate();
  const cutoffDay = loadedTo >= `${month}-${pad2(daysIn(month))}` ? daysIn(month)
    : loadedTo.startsWith(month) ? Number(loadedTo.slice(8, 10)) : 0;
  if (!cutoffDay || !TRANSACTIONS[prev]?.length) {
    value.textContent = '—';
    note.textContent = cutoffDay ? `No data for ${MONTH_LABEL(prev).split(' ')[0]}` : 'No data loaded yet';
    return;
  }

  const prevCutoff = `${prev}-${pad2(Math.min(cutoffDay, daysIn(prev)))}`;
  const spendTo = (key, last) => sumAbs(getMonthTransactions(key).filter((t) => isVariableExpense(t) && t.date <= last));
  const current = spendTo(month, `${month}-${pad2(cutoffDay)}`);
  const previous = spendTo(prev, prevCutoff);
  const diff = current - previous;

  const when = cutoffDay === daysIn(month) ? MONTH_LABEL(prev).split(' ')[0] : `by ${formatDate(prevCutoff)}`;
  if (Math.abs(diff) < 0.005) {
    value.innerHTML = moneyMarkup(currency(0));
    note.textContent = `Same as ${when}`;
  } else {
    value.innerHTML = moneyMarkup(`${diff < 0 ? MINUS : '+'}${currency(Math.abs(diff))}`);
    const pct = previous ? `${Math.abs((diff / previous) * 100).toFixed(1)}% ` : '';
    note.textContent = `${pct}${diff < 0 ? 'less' : 'more'} than ${when}`;
    note.classList.add(diff < 0 ? 'is-positive' : 'is-negative');
  }
  value.closest('.stat-tile').title = `${currency(current)} spent vs ${currency(previous)} ${when === MONTH_LABEL(prev).split(' ')[0] ? `in ${when}` : when}`;
}

/** Groups a month's expenses by date: { '2026-09-14': { total, txs } }. */
function dailySpend(month) {
  const days = {};
  getMonthTransactions(month).filter(isExpense).forEach((t) => {
    const day = days[t.date] || (days[t.date] = { total: 0, txs: [] });
    day.total += Math.abs(t.amount);
    day.txs.push(t);
  });
  return days;
}

/**
 * Quintile cut-offs across the month's spending days, used to shade
 * days into levels 1–5 (level 0 = no spend).
 */
function heatThresholds(totals) {
  const sorted = totals.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return [0, 0, 0, 0];
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return [at(0.2), at(0.4), at(0.6), at(0.8)];
}

function heatLevel(value, thresholds) {
  if (value <= 0) return 0;
  const above = thresholds.findIndex((t) => value <= t);
  return above === -1 ? thresholds.length + 1 : above + 1;
}

/** Formats an ISO date as e.g. "Sunday 14 September". */
function longDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Re-renders the whole calendar page. Called by filters.js when the month or accounts change. */
function renderAll() {
  const month = state.month;
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = daysIn(month);
  const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday = 0
  const days = dailySpend(month);
  const totals = Object.values(days).map((d) => d.total);
  const thresholds = heatThresholds(totals);
  const total = totals.reduce((s, v) => s + v, 0);

  document.getElementById('page-subtitle').textContent = `Daily spending — ${MONTH_LABEL(month)}`;

  // ---- Stat tiles ----
  const spendDays = totals.filter((v) => v > 0).length;
  const heaviest = Object.entries(days).sort((a, b) => b[1].total - a[1].total)[0];
  document.getElementById('cal-total').innerHTML = moneyMarkup(currency(total));
  document.getElementById('cal-total-note').textContent = `${spendDays} spending day${spendDays === 1 ? '' : 's'}`;
  // Averages leave out fixed expenses so rent and bills don't inflate a typical day.
  const variableTotals = Object.values(days).map((d) => d.txs.filter(isVariableExpense).reduce((s, t) => s + Math.abs(t.amount), 0));
  const variableTotal = variableTotals.reduce((s, v) => s + v, 0);
  document.getElementById('cal-avg').innerHTML = moneyMarkup(currency(variableTotal / daysInMonth));
  document.getElementById('cal-avg-note').textContent = 'Excluding Fixed Expenses';
  // Forecast and daily limit only make sense for the month we're in.
  const isCurrentMonth = month === todayIso().slice(0, 7);
  document.getElementById('cal-forecast-tile').hidden = !isCurrentMonth;
  document.getElementById('cal-max-day-tile').hidden = !isCurrentMonth;
  document.getElementById('cal-savings-tile').hidden = !isCurrentMonth;
  document.querySelector('.stats-grid--four').classList.toggle('is-current-month', isCurrentMonth);
  if (isCurrentMonth) {
    const forecast = forecastSpend(month);
    renderForecastBreakdown(forecast);
    renderMaxSpendPerDay(month, forecast);
    renderForecastSavings(month, forecast);
  }
  renderVsLastMonth(month);

  // ---- Legend ranges (shown on hover) ----
  const [t1, t2, t3, t4] = thresholds;
  const keyTitles = [
    `Up to ${currency(t1)}`,
    `${currency(t1)} – ${currency(t2)}`,
    `${currency(t2)} – ${currency(t3)}`,
    `${currency(t3)} – ${currency(t4)}`,
    `Over ${currency(t4)}`,
  ];
  keyTitles.forEach((title, i) => { document.getElementById(`heat-key-${i + 1}`).title = title; });

  // ---- Day cells ----
  const today = todayIso();
  const monthChanged = calendarView.month !== month;
  if (monthChanged || !calendarView.selectedDate?.startsWith(month)) {
    calendarView.month = month;
    calendarView.selectedDate = today.startsWith(month) ? today : heaviest ? heaviest[0] : `${month}-01`;
  }

  const cells = Array.from({ length: firstWeekday }, () => '<span class="calendar__pad" aria-hidden="true"></span>');
  let weekTotal = 0;
  // Each row ends with that week's total (Mon–Sun, within this month).
  const endWeek = () => {
    cells.push(`<span class="calendar__week" role="gridcell" aria-label="Week total ${currency(weekTotal)}">${weekTotal ? currencyShort(weekTotal) : '—'}</span>`);
    weekTotal = 0;
  };
  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = `${month}-${pad2(d)}`;
    const value = days[iso]?.total || 0;
    const level = heatLevel(value, thresholds);
    const classes = [
      'calendar__day', `heat-${level}`,
      iso === today ? 'is-today' : '',
      iso === calendarView.selectedDate ? 'is-selected' : '',
      iso > today ? 'is-future' : '',
    ].filter(Boolean).join(' ');
    const eventCount = EVENTS_BY_DATE[iso]?.length || 0;
    const label = `${longDate(iso)}: ${value ? currency(value) : 'no spending'}${eventCount ? `, ${plural(eventCount, 'event')}` : ''}`;
    cells.push(`
      <button type="button" class="${classes}" data-date="${iso}" role="gridcell" aria-label="${label}" aria-pressed="${iso === calendarView.selectedDate}" style="--cell-i:${firstWeekday + d - 1}">
        ${eventCount ? '<span class="calendar__event-dot" aria-hidden="true"></span>' : ''}
        <span class="calendar__date">${d}</span>
        ${categoryDots(days[iso])}
        <span class="calendar__amount">${value ? currencyShort(value) : ''}</span>
      </button>
    `);
    weekTotal += value;
    if ((firstWeekday + d) % 7 === 0) endWeek();
  }
  if ((firstWeekday + daysInMonth) % 7) {
    const fill = 7 - ((firstWeekday + daysInMonth) % 7);
    cells.push(...Array.from({ length: fill }, () => '<span class="calendar__pad" aria-hidden="true"></span>'));
    endWeek();
  }
  const grid = document.getElementById('calendar-days');
  grid.innerHTML = cells.join('');
  // A new month's cells cascade in (only on month changes, not on every day click).
  if (monthChanged) {
    grid.classList.remove('is-entering');
    void grid.offsetWidth; // restart the animation
    grid.classList.add('is-entering');
    clearTimeout(grid.enterTimer);
    grid.enterTimer = setTimeout(() => grid.classList.remove('is-entering'), 900);
  }

  renderDayDetail(days);
}

/** Up to three dots showing what a day's money went on, biggest category first. */
function categoryDots(day) {
  if (!day) return '';
  const byCategory = {};
  day.txs.forEach((t) => { byCategory[t.category] = (byCategory[t.category] || 0) + Math.abs(t.amount); });
  const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `<span class="calendar__dots" aria-hidden="true">${top.map(([id]) => `<i style="background:${catById[id]?.color || "var(--text-faint)"}"></i>`).join('')}</span>`;
}

/**
 * The everyday budget for one day of a month: the month's spending
 * allowance (last month's salary − savings target), minus the 3-month
 * average of fixed costs, spread evenly over the month. Null without a salary.
 */
function dailyBudget(month) {
  const allowance = spendingAllowance(month);
  if (allowance === null) return null;
  return Math.max(0, (allowance - forecastSpend(month).fixed) / daysIn(month));
}

/** The day panel's bar: that day's everyday spending against the daily budget. */
function renderDayBudget(iso, day) {
  const box = document.getElementById('day-budget');
  const budget = dailyBudget(iso.slice(0, 7));
  const loaded = iso <= lastLoadedDate();
  box.hidden = budget === null || !budget || !loaded;
  if (box.hidden) return;

  const everyday = sumAbs((day?.txs || []).filter(isVariableExpense));
  const fixed = sumAbs((day?.txs || []).filter((t) => t.category === 'fixed_expense'));
  const over = everyday > budget;
  box.classList.toggle('is-over', over);
  document.getElementById('day-budget-text').textContent = `${currency(everyday)} of ${currency(budget)} daily budget`;
  document.getElementById('day-budget-meta').textContent = over
    ? `${currency(everyday - budget)} over`
    : `${currency(budget - everyday)} left`;
  document.getElementById('day-budget-fill').style.width = `${Math.min(100, (everyday / budget) * 100)}%`;
  document.getElementById('day-budget-note').textContent = fixed ? `Plus ${currency(fixed)} of fixed costs, which aren't counted here.` : '';
}

/** Lists the selected day's expenses (largest first) and its calendar events. */
function renderDayDetail(days) {
  const iso = calendarView.selectedDate;
  const day = days[iso];
  const txs = (day?.txs || []).slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  document.getElementById('day-title').textContent = longDate(iso);
  document.getElementById('day-meta').textContent = day ? `${txs.length} · ${currency(day.total)}` : '';
  renderDayBudget(iso, day);
  document.getElementById('day-empty').hidden = txs.length > 0;
  const notLoaded = iso > lastLoadedDate();
  document.getElementById('day-empty-title').textContent = notLoaded ? 'Not loaded yet' : 'No Spending';
  document.getElementById('day-empty-hint').textContent = notLoaded
    ? "This day's transactions haven't come in yet."
    : 'A no-spend day.';
  document.getElementById('day-list').innerHTML = txs.map((t) => {
    const cat = catById[t.category];
    const acc = accountById[t.account];
    return `
      <li class="day-list__item">
        <span class="day-list__dot" style="background:${cat.color}" aria-hidden="true"></span>
        <span class="day-list__main">
          <span class="day-list__merchant">${escapeAttr(t.merchant)}</span>
          <span class="day-list__meta">${cat.label}${acc ? ` · ${acc.groupLabel}` : ''}</span>
        </span>
        <span class="day-list__amount">${currency(Math.abs(t.amount))}</span>
      </li>
    `;
  }).join('');

  const events = EVENTS_BY_DATE[iso] || [];
  const budget = events.reduce((s, e) => s + e.budget, 0);
  document.getElementById('day-events-meta').textContent = events.length ? `${events.length} · ${currency(budget)} budget` : '';
  document.getElementById('event-empty').hidden = events.length > 0;
  document.getElementById('event-list').innerHTML = events.map((e) => {
    const cat = catById[e.category];
    return `
      <li class="day-list__item">
        <span class="day-list__dot" style="background:${cat.color}" aria-hidden="true"></span>
        <span class="day-list__main">
          <span class="day-list__merchant">${escapeAttr(e.title)}</span>
          <span class="day-list__meta">${cat.label}</span>
        </span>
        <span class="day-list__amount">${currency(e.budget)}</span>
      </li>
    `;
  }).join('');
}

/** Click to select a day; hover (desktop) shows a small summary tooltip. */
function initCalendarInteractions() {
  const grid = document.getElementById('calendar-days');
  const tooltip = document.getElementById('calendar-tooltip');

  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.calendar__day');
    if (!cell) return;
    calendarView.selectedDate = cell.dataset.date;
    renderAll();
  });

  grid.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.calendar__day');
    if (!cell || !window.matchMedia('(hover: hover)').matches) return;
    const day = dailySpend(state.month)[cell.dataset.date];
    const top = day?.txs.slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
    const events = EVENTS_BY_DATE[cell.dataset.date] || [];
    tooltip.innerHTML = `
      <span class="calendar-tooltip__date">${longDate(cell.dataset.date)}</span>
      <span class="calendar-tooltip__value">${day ? currency(day.total) : 'No Spending'}</span>
      ${day ? `<span class="calendar-tooltip__meta">${day.txs.length} transaction${day.txs.length === 1 ? '' : 's'} · largest: ${escapeAttr(top.merchant)}</span>` : ''}
      ${events.length ? `<span class="calendar-tooltip__meta">${plural(events.length, 'event')} · ${escapeAttr(events[0].title)}${events.length > 1 ? ' …' : ''}</span>` : ''}
    `;
    tooltip.hidden = false;
    const rect = cell.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - tipRect.width / 2), window.innerWidth - tipRect.width - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${rect.top - tipRect.height - 8}px`;
  });
  grid.addEventListener('mouseleave', () => { tooltip.hidden = true; });
  window.addEventListener('scroll', () => { tooltip.hidden = true; }, { passive: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  // Placeholder day cells while the data loads (replaced by renderAll).
  document.getElementById('calendar-days').innerHTML = '<span class="calendar__skeleton"></span>'.repeat(35);

  // Straight away when this device has a copy of the data; otherwise after the auth check (data.js).
  const session = await pageSession;
  if (!session) return; // auth.js is already redirecting to login.html

  initUserMenu(session);
  initPageHeading(session);
  document.getElementById('signout-button').addEventListener('click', signOut);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  try {
    await accountsReady;
    indexEvents();
    initCalendarMonths();
    state.activeAccounts = new Set(ACCOUNTS.map((a) => a.id));
    Object.assign(accountById, Object.fromEntries(ACCOUNTS.map((a) => [a.id, a])));

    initAccountFilter();
    initMonthSelect();
    initCalendarInteractions();

    renderAll();
    finishLoading();
    initSync({
      onChange: () => {
        indexEvents();
        initCalendarMonths();
        renderMonthOptions();
        renderAll();
      },
    });
  } catch (error) {
    showLoadError(error);
  }
});
