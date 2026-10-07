/**
 * calendar.js
 * ---------------------------------------------------------------------
 * Entry point for calendar.html — a month calendar of spend per day.
 * Each day is shaded by how heavy its spending was compared with the
 * other spending days that month (quintiles, so one big rent payment
 * doesn't wash out every other day): green for the lightest days,
 * neutral in the middle, rose for the heaviest. Clicking a day lists its
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
  selectedDate: null, // 'YYYY-MM-DD'; reset to the heaviest day when the month changes
  month: null,
};

/** Calendar events grouped by date: { '2026-09-14': [ {id,title,budget,category}, ... ] }. */
const EVENTS_BY_DATE = {};

/** Loads calendar_events into EVENTS_BY_DATE. A failure leaves the calendar working without events. */
async function loadCalendarEvents() {
  try {
    const events = await fetchCalendarEvents();
    events.forEach((e) => (EVENTS_BY_DATE[e.date] || (EVENTS_BY_DATE[e.date] = [])).push(e));
  } catch (err) {
    console.error(err);
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Today's date as 'YYYY-MM-DD' in local time. */
function todayIso() {
  const today = new Date();
  return `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
}

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
 *   + 3-month daily average (excl. fixed) × days not loaded yet
 *   + event budgets on days not loaded yet.
 * Both averages cover the previous three months that have data.
 */
function forecastSpend(month) {
  const spent = sumAbs(getMonthTransactions(month).filter(isVariableExpense));

  const history = [1, 2, 3].map((n) => shiftMonth(month, -n)).filter((key) => TRANSACTIONS[key]?.length);
  const historyFixed = history.reduce((s, key) => s + sumAbs(getMonthTransactions(key).filter((t) => t.category === 'fixed_expense')), 0);
  const fixed = history.length ? historyFixed / history.length : 0;
  const historyDays = history.reduce((s, key) => s + daysIn(key), 0);
  const historySpend = history.reduce((s, key) => s + sumAbs(getMonthTransactions(key).filter(isVariableExpense)), 0);
  const dailyAvg = historyDays ? historySpend / historyDays : 0;

  const loadedTo = lastLoadedDate();
  let daysLeft = 0;
  let eventBudget = 0;
  for (let d = 1; d <= daysIn(month); d += 1) {
    const iso = `${month}-${pad2(d)}`;
    if (iso <= loadedTo) continue;
    daysLeft += 1;
    eventBudget += (EVENTS_BY_DATE[iso] || []).reduce((s, e) => s + e.budget, 0);
  }

  const projected = dailyAvg * daysLeft;
  return {
    total: fixed + spent + projected + eventBudget,
    fixed, spent, projected, dailyAvg, daysLeft, eventBudget, loadedTo,
  };
}

// The forecast's parts, in doughnut order, each with its colour token.
const FORECAST_PARTS = [
  { key: 'fixed', label: 'Fixed expenses', color: '--forecast-fixed' },
  { key: 'spent', label: 'Spent so far', color: '--forecast-spent' },
  { key: 'projected', label: 'Projected daily spend', color: '--forecast-projected' },
  { key: 'eventBudget', label: 'Event budgets', color: '--forecast-events' },
];

// Extra line shown under the hovered part in the tooltip.
const FORECAST_DETAIL = {
  fixed: () => 'Average of the last 3 months',
  spent: () => 'Excluding fixed expenses',
  projected: (f) => `${currency(f.dailyAvg)}/day × ${plural(f.daysLeft, 'day')}`,
  eventBudget: () => 'Events on days not yet loaded',
};

let forecastChart;
let lastForecast = null;

/**
 * Draws the forecast breakdown doughnut. Hovering a segment shows every
 * part in the page's tooltip, with the hovered one highlighted. Called
 * with no argument (e.g. on theme change) it redraws the last forecast.
 */
function renderForecastChart(forecast = lastForecast) {
  if (!forecast || typeof Chart === 'undefined') return;
  lastForecast = forecast;
  const canvas = document.getElementById('forecast-chart');
  const values = FORECAST_PARTS.map((p) => forecast[p.key]);
  const empty = forecast.total <= 0;

  canvas.setAttribute('aria-label', `Forecast spend breakdown: ${FORECAST_PARTS
    .map((p, i) => `${p.label} ${currency(values[i])}`).join(', ')}`);

  if (forecastChart) forecastChart.destroy();
  forecastChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      datasets: [{
        // An empty forecast still shows a faint track rather than nothing.
        data: empty ? [1] : values,
        backgroundColor: empty ? [cssVar('--border')] : FORECAST_PARTS.map((p) => cssVar(p.color)),
        borderWidth: 2,
        borderColor: cssVar('--surface'),
        hoverOffset: 0,
      }],
    },
    options: {
      cutout: '64%',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false, external: empty ? undefined : showForecastTooltip },
      },
    },
  });
}

/** Chart.js external tooltip: lists every forecast part in #calendar-tooltip. */
function showForecastTooltip({ chart, tooltip }) {
  const el = document.getElementById('calendar-tooltip');
  if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) { el.hidden = true; return; }
  const active = tooltip.dataPoints[0].dataIndex;
  const f = lastForecast;

  el.innerHTML = `
    <span class="calendar-tooltip__date">Forecast · ${f.loadedTo ? `data to ${formatDate(f.loadedTo)}` : 'no data loaded'}</span>
    ${FORECAST_PARTS.map((p, i) => `
      <span class="forecast-tip__row${i === active ? ' is-active' : ''}">
        <span class="forecast-tip__swatch" style="background:var(${p.color})"></span>
        <span>${p.label}</span>
        <span class="forecast-tip__amount">${currency(f[p.key])}</span>
      </span>
      ${i === active && FORECAST_DETAIL[p.key] ? `<span class="forecast-tip__detail">${FORECAST_DETAIL[p.key](f)}</span>` : ''}
    `).join('')}
  `;
  el.hidden = false;
  const rect = chart.canvas.getBoundingClientRect();
  const tipRect = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - tipRect.width / 2), window.innerWidth - tipRect.width - 8);
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(8, rect.top - tipRect.height - 8)}px`;
}

/**
 * "Max spend per day": what's left of MONTHLY_SPEND_TARGET after the
 * 3-month fixed-expense average and this month's spend so far (excl.
 * fixed), spread over the days whose transactions haven't loaded yet.
 */
function renderMaxSpendPerDay(forecast) {
  const value = document.getElementById('cal-max-day');
  const note = document.getElementById('cal-max-day-note');
  const remaining = MONTHLY_SPEND_TARGET - forecast.fixed - forecast.spent;
  note.className = 'stat-tile__delta stat-tile__delta--truncate';

  if (remaining <= 0) {
    value.textContent = currency(0);
    note.textContent = `${currency(-remaining)} over ${currencyShort(MONTHLY_SPEND_TARGET)} target`;
    note.classList.add('is-negative');
  } else if (!forecast.daysLeft) {
    value.textContent = '—';
    note.textContent = `${currency(remaining)} under target`;
  } else {
    value.textContent = currency(remaining / forecast.daysLeft);
    note.textContent = `${currencyShort(remaining)} left · ${plural(forecast.daysLeft, 'day')}`;
  }
  value.closest('.stat-tile').title = `${currencyShort(MONTHLY_SPEND_TARGET)} target − ${currency(forecast.fixed)} fixed (3-month average) − ${currency(forecast.spent)} spent so far`;
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

  document.getElementById('cal-savings').textContent = savings < 0 ? `-${currency(-savings)}` : currency(savings);
  document.getElementById('cal-savings-bar').style.width = `${Math.max(0, Math.min(1, savings / MONTHLY_SAVINGS_TARGET)) * 100}%`;
  const note = document.getElementById('cal-savings-note');
  note.className = `stat-tile__delta stat-tile__delta--truncate ${gap >= 0 ? 'is-positive' : 'is-negative'}`;
  note.textContent = gap >= 0
    ? `${currencyShort(gap)} above ${currencyShort(MONTHLY_SAVINGS_TARGET)} target`
    : `${currencyShort(-gap)} short of ${currencyShort(MONTHLY_SAVINGS_TARGET)} target`;
  document.getElementById('cal-savings-tile').title =
    `Income ${currency(income)} (${salaryIn ? 'this month' : '3-month average — salary not in yet'}) − forecast spend ${currency(forecast.total)}`;
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
  document.getElementById('cal-total').textContent = currency(total);
  document.getElementById('cal-total-note').textContent = `${spendDays} spending day${spendDays === 1 ? '' : 's'}`;
  // Averages leave out fixed expenses so rent and bills don't inflate a typical day.
  const variableTotals = Object.values(days).map((d) => d.txs.filter(isVariableExpense).reduce((s, t) => s + Math.abs(t.amount), 0));
  const variableTotal = variableTotals.reduce((s, v) => s + v, 0);
  document.getElementById('cal-avg').textContent = currency(variableTotal / daysInMonth);
  document.getElementById('cal-avg-note').textContent = 'Excluding Fixed Expenses';
  // Forecast and daily limit only make sense for the month we're in.
  const isCurrentMonth = month === todayIso().slice(0, 7);
  document.getElementById('cal-forecast-tile').hidden = !isCurrentMonth;
  document.getElementById('cal-max-day-tile').hidden = !isCurrentMonth;
  document.getElementById('cal-savings-tile').hidden = !isCurrentMonth;
  document.querySelector('.stats-grid--four').classList.toggle('is-current-month', isCurrentMonth);
  if (isCurrentMonth) {
    const forecast = forecastSpend(month);
    document.getElementById('cal-forecast').textContent = currency(forecast.total);
    document.getElementById('cal-forecast-note').textContent = !forecast.daysLeft
      ? 'All days loaded'
      : `${plural(forecast.daysLeft, 'day')} forecast`;
    renderForecastChart(forecast);
    renderMaxSpendPerDay(forecast);
    renderForecastSavings(month, forecast);
  }
  document.getElementById('cal-zero').textContent = daysInMonth - spendDays;
  document.getElementById('cal-zero-note').textContent = `of ${daysInMonth} days`;

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
  if (calendarView.month !== month || !calendarView.selectedDate?.startsWith(month)) {
    calendarView.month = month;
    calendarView.selectedDate = heaviest ? heaviest[0] : `${month}-01`;
  }
  const today = todayIso();

  const cells = Array.from({ length: firstWeekday }, () => '<span class="calendar__pad" aria-hidden="true"></span>');
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
      <button type="button" class="${classes}" data-date="${iso}" role="gridcell" aria-label="${label}" aria-pressed="${iso === calendarView.selectedDate}">
        ${eventCount ? '<span class="calendar__event-dot" aria-hidden="true"></span>' : ''}
        <span class="calendar__date">${d}</span>
        <span class="calendar__amount">${value ? currencyShort(value) : ''}</span>
      </button>
    `);
  }
  document.getElementById('calendar-days').innerHTML = cells.join('');

  renderDayDetail(days);
}

/** Lists the selected day's expenses (largest first) and its calendar events. */
function renderDayDetail(days) {
  const iso = calendarView.selectedDate;
  const day = days[iso];
  const txs = (day?.txs || []).slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  document.getElementById('day-title').textContent = longDate(iso);
  document.getElementById('day-meta').textContent = day ? `${txs.length} · ${currency(day.total)}` : '';
  document.getElementById('day-empty').hidden = txs.length > 0;
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
      <span class="calendar-tooltip__value">${day ? currency(day.total) : 'No spending'}</span>
      ${day ? `<span class="calendar-tooltip__meta">${day.txs.length} transaction${day.txs.length === 1 ? '' : 's'} · largest ${escapeAttr(top.merchant)}</span>` : ''}
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

  const session = await authReady;
  if (!session) return; // auth.js is already redirecting to login.html

  document.getElementById('auth-loading').remove();
  initUserMenu(session);
  document.getElementById('signout-button').addEventListener('click', signOut);

  await Promise.all([accountsReady, loadCalendarEvents()]);
  initCalendarMonths();
  state.activeAccounts = new Set(ACCOUNTS.map((a) => a.id));
  Object.assign(accountById, Object.fromEntries(ACCOUNTS.map((a) => [a.id, a])));

  initAccountFilter();
  initMonthSelect();
  initCalendarInteractions();
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  renderAll();
});
