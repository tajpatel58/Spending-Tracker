/**
 * calendar.js
 * ---------------------------------------------------------------------
 * Entry point for calendar.html — a month calendar of spend per day.
 * Each day is shaded by how heavy its spending was compared with the
 * other spending days that month (quintiles, so one big rent payment
 * doesn't wash out every other day): green for the lightest days,
 * neutral in the middle, rose for the heaviest. Clicking a day lists its
 * transactions and calendar events (with their rough budgets) alongside
 * the calendar; days with an event get a small dot.
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
  const daysInMonth = new Date(y, m, 0).getDate();
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
  document.getElementById('cal-max').textContent = heaviest ? currency(heaviest[1].total) : '—';
  document.getElementById('cal-max-note').textContent = heaviest ? formatDate(heaviest[0]) : '—';
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
