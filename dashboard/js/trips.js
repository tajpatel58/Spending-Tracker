/**
 * trips.js
 * ---------------------------------------------------------------------
 * Entry point for trips.html — the household's trips, from the Supabase
 * `trips` table (where and when), each with the spending that belongs
 * to it: every Holiday-category transaction dated within its dates
 * (tagTransactions), counted under its Holiday sub-category (flights,
 * stay...). Spending without a sub-category is listed under "To sort" on
 * the trip's page, where choosing one saves it to Supabase.
 *
 * It opens on a home view of every trip — how many, how long away, what
 * they cost and who paid, what's next, a card for each place and the
 * ledger — and the stepper in the top bar (or a card, or a ledger row)
 * opens one. A trip's page changes with where the trip is (before you
 * go, away, or home) and shows its running total, who paid, each day's
 * spend and every transaction; a trip with nothing tagged yet shows the
 * same widgets empty. "Plan a trip" saves a new trip, and a trip's page
 * can delete it.
 *
 * A trip's page opens on its financial summary (Budget, Spent and
 * Remaining), then the itinerary. The budget is set part by part with
 * sliders on the "By part" tile (the `trips` table's part_budgets
 * column), and the trip's Budget is their sum. A savings pot and local
 * currency (trip.pot, trip.fx) are drawn when a trip has them; trips
 * from Supabase don't yet.
 * ---------------------------------------------------------------------
 */

import { initPageHeading, initUserMenu, signOut } from './auth.js';
import { fade, htmlTooltip } from './chart-kit.js';
import { categoryIcon } from './category-icons.js';
import { accountsReady, dataStatus, pageSession, refreshData, saveDataCache, TRANSACTIONS } from './data.js';
import { openDatePicker } from './datepicker.js';
import { cssVar, currency, currencyShort, escapeAttr, MINUS, moneyMarkup } from './format.js';
import { motion } from './motion.js';
import { finishLoading, people, showLoadError, spendOwnerColor } from './state.js';
import { initTheme, toggleTheme } from './theme.js';
import { showToast } from './toast.js';
import { updateTransactionSubCategory } from './transactions-api.js';
import { createTrip, deleteTrip, fetchTrips, updateTripBudgets } from './trips-api.js';

// ============================================================
// TRIPS
// ============================================================

/** Today, 'YYYY-MM-DD' (local time). */
const TODAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

/**
 * The parts of a trip: the Holiday sub-categories a transaction can be
 * given (manual_sub_category in transactions_metadata, stored by id, e.g.
 * 'flights'), plus 'unsorted' for Holiday spending not given one yet.
 * Each is drawn with a category's icon and colour. To change the
 * sub-categories, edit this list (and HOLIDAY_SUB_CATEGORIES below).
 */
const PARTS = {
  flights:    { label: 'Flights',        icon: 'holiday',    color: 'var(--cat-holiday)' },
  stay:       { label: 'Stay',           icon: 'housing',    color: 'var(--cat-health)' }, // not --cat-housing: too close to Flights' purple
  food:       { label: 'Food & drink',   icon: 'dining',     color: 'var(--cat-dining)' },
  activities: { label: 'Activities',     icon: 'activities', color: 'var(--cat-activities)' },
  transport:  { label: 'Getting around', icon: 'transport',  color: 'var(--cat-transport)' },
  parking:    { label: 'Parking',        icon: 'parking',    color: 'var(--cat-groceries)' },
  shopping:   { label: 'Shopping',       icon: 'shopping',   color: 'var(--cat-shopping)' },
  other:      { label: 'Other',          icon: 'other',      color: 'var(--cat-birthday)' },
  unsorted:   { label: 'To sort',        icon: 'other',      color: 'var(--cat-other)' }, // no sub-category yet
};

/** The sub-categories a Holiday transaction can be given, in the order they're offered. */
const HOLIDAY_SUB_CATEGORIES = ['flights', 'stay', 'food', 'activities', 'transport', 'parking', 'shopping', 'other'];

/** Parts booked ahead (no daily pace); the rest are spent day by day while away. */
const BOOKED_PARTS = new Set(['flights', 'stay']);

/**
 * Parts listed under "Essentials" above the days in Every transaction,
 * rather than on the day they're dated, so each day lists what was done
 * and eaten that day.
 */
const ESSENTIAL_PARTS = new Set(['flights', 'parking']);

/** The parts a trip's budget is set by: the sub-categories. */
const BUDGET_PARTS = HOLIDAY_SUB_CATEGORIES;

/** The category whose transactions, dated within a trip, belong to it. */
const TRIP_CATEGORY = 'holiday';

/** A trip's part budgets from a row's part_budgets, as numbers in BUDGET_PARTS order (jsonb doesn't keep the order). */
const partBudgets = (stored) => Object.fromEntries(BUDGET_PARTS
  .filter((part) => Number(stored?.[part]) > 0)
  .map((part) => [part, Number(stored[part])]));

/** A row of the Supabase `trips` table as a trip: where and when, with its spending tagged in by tagTransactions. */
const fromRow = (row) => {
  const budget = partBudgets(row.part_budgets);
  return {
    id: `trip-${row.id}`,
    dbId: row.id, // the row's id in Supabase
    name: row.location,
    place: '',
    start: row.start_date,
    end: row.end_date,
    // The trip's budget, in pounds: the sum of its parts, or (set before
    // there were parts) the budget column on its own.
    total: Object.keys(budget).length ? sum(Object.values(budget)) : row.budget != null && row.budget !== '' ? Number(row.budget) : null,
    budget, // per-part budgets, e.g. { flights: 420, stay: 900 }
    pot: null,
    txs: [],
  };
};

/** Every trip, earliest first. */
const TRIPS = [];
const sortTrips = () => TRIPS.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

/**
 * Gives every trip its spending: each Holiday transaction, not hidden,
 * dated from the trip's first day to its last, earliest first, counted
 * under its sub-category (or 'unsorted' until it has one). A
 * transaction's date is its manual_date when one is set, otherwise the
 * bank's date (supabase-client.js fetchTransactions). Run again whenever
 * the trips or transactions change.
 */
function tagTransactions() {
  const tagged = Object.values(TRANSACTIONS).flat().filter((t) => !t.hidden && t.category === TRIP_CATEGORY);
  TRIPS.forEach((trip) => {
    trip.txs = tagged
      .filter((t) => t.date >= trip.start && t.date <= trip.end)
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
      .map((t) => ({
        id: t.id,
        date: t.date,
        part: HOLIDAY_SUB_CATEGORIES.includes(t.subCategory) ? t.subCategory : 'unsorted',
        merchant: t.merchant,
        who: t.user || 'Unknown', // the account's owner (or the joint account)
        amount: Math.abs(t.amount),
      }));
  });
}

// ============================================================
// DATES
// ============================================================

const parse = (iso) => new Date(`${iso}T00:00:00`);
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const addDays = (iso, n) => {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Month keys ('2026-10') counted as whole months, so they subtract. */
const monthIndex = (key) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
const monthKey = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
const monthName = (key, style = 'short') => parse(`${key}-01`).toLocaleDateString('en-GB', { month: style });

/** "Sat 25 Oct". */
const dayLabel = (iso) => parse(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
/** "14 Aug". */
const shortDate = (iso) => parse(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** "24–29 October 2026", or "28 March – 2 April 2027" across months. */
function dateRange(trip, month = 'long') {
  const a = parse(trip.start);
  const b = parse(trip.end);
  const tail = b.toLocaleDateString('en-GB', { day: 'numeric', month, year: 'numeric' });
  if (trip.start === trip.end) return tail;
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${a.getDate()}–${tail}`
    : `${a.toLocaleDateString('en-GB', { day: 'numeric', month })} – ${tail}`;
}

// ============================================================
// THE MODEL
// ============================================================

const sum = (values) => values.reduce((s, v) => s + v, 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Everything the page shows about one trip, worked out from its dates and tagged spending. */
function tripModel(trip) {
  const status = TODAY < trip.start ? 'saving' : TODAY > trip.end ? 'done' : 'away';
  const days = daysBetween(trip.start, trip.end) + 1;
  const day = status === 'away' ? daysBetween(trip.start, TODAY) + 1 : status === 'done' ? days : 0;
  const daysLeft = status === 'away' ? days - day + 1 : 0; // today included
  // The days whose spending to show: so far while away, otherwise all of them
  // (before a trip, anything dated within it is booked ahead for those days).
  const through = status === 'away' ? day : days;

  const budget = trip.total ?? sum(Object.values(trip.budget)); // the trips table's budget, when set
  const spent = sum(trip.txs.map((t) => t.amount));
  const byPart = Object.fromEntries(Object.keys(trip.budget).map((part) => [part, 0]));
  // (filled in below, so a part with spending but no budget — like Holiday — is counted too)
  trip.txs.forEach((t) => { byPart[t.part] = (byPart[t.part] || 0) + t.amount; });
  const booked = sum(trip.txs.filter((t) => t.date < trip.start).map((t) => t.amount));

  // Day-to-day: the parts spent while away (anything paid for beforehand, like a train, doesn't count).
  const dailyParts = Object.keys(byPart).filter((p) => !BOOKED_PARTS.has(p));
  const dailyBudget = sum(dailyParts.map((p) => trip.budget[p] || 0)); // a part without a budget (Holiday) adds nothing
  const dailySpent = sum(trip.txs.filter((t) => t.date >= trip.start && dailyParts.includes(t.part)).map((t) => t.amount));

  // Who paid: what went through each account owner's cards (a person's, or the joint account's).
  const paid = {};
  trip.txs.forEach((t) => { paid[t.who] = (paid[t.who] || 0) + t.amount; });

  // The pot: paid into monthly from its start until the month of the trip (or this month).
  const startMonth = monthIndex(trip.start.slice(0, 7));
  const nextMonth = monthIndex(TODAY.slice(0, 7)) + 1;
  let pot = null;
  if (trip.pot) {
    const from = monthIndex(trip.pot.start);
    const months = Math.max(0, Math.min(nextMonth, startMonth) - from);
    const paydaysLeft = Math.max(0, startMonth - nextMonth);
    const saved = months * trip.pot.monthly;
    const toSave = Math.max(0, budget - saved);
    pot = {
      from,
      months,
      saved,
      toSave,
      paydaysLeft,
      needed: paydaysLeft ? toSave / paydaysLeft : 0,
      projected: saved + paydaysLeft * trip.pot.monthly,
      monthly: trip.pot.monthly,
    };
  }

  return { trip, status, days, day, daysLeft, through, budget, spent, byPart, booked, dailyParts, dailyBudget, dailySpent, paid, pot };
}

/** Totals by day of the trip, as [{ iso, total, txs }]. */
function tripDays(m) {
  return Array.from({ length: m.days }, (_, i) => {
    const iso = addDays(m.trip.start, i);
    const txs = m.trip.txs.filter((t) => t.date === iso);
    return { iso, txs, total: sum(txs.map((t) => t.amount)) };
  });
}

// ============================================================
// FINANCIAL SUMMARY
// ============================================================

let drawn = false; // the first draw grows in slowly; switching trips is quicker

function smallTile({ label, value, valueClass = '', note = '', tone = '', foot = '', action = '' }) {
  return `
    <div class="tile stat-tile">
      <div class="stat-tile__head"><span class="stat-tile__label">${label}</span>${action}</div>
      <span class="stat-tile__value${valueClass}">${value}</span>
      <span class="stat-tile__delta stat-tile__delta--truncate ${tone}">${note}</span>
      ${foot}
    </div>`;
}

/** A tile's foot: a label and its figure along the bottom edge. */
const tileFoot = (label, figure, tone = '') => `<p class="stat-tile__foot"><span>${label}</span><b class="${tone}">${figure}</b></p>`;

/**
 * Each: each person's share of the trip, what went through each account
 * (a person's, or the joint account's) as one bar in the Overview's
 * colours for them, and, for two people, who owes whom to even up —
 * what each paid on their own cards, halved (the joint account is
 * already shared evenly).
 */
function peopleTile(m) {
  const everyone = people();
  const owners = Object.keys(m.paid).sort((x, y) => m.paid[y] - m.paid[x]);
  let settle = '<span>All square</span>';
  if (everyone.length === 2) {
    const [a, b] = everyone;
    const diff = ((m.paid[a] || 0) - (m.paid[b] || 0)) / 2;
    if (Math.abs(diff) >= 1) settle = `<span>${diff > 0 ? b : a} owes ${diff > 0 ? a : b}</span><b>${currencyShort(Math.abs(diff))}</b>`;
  }
  return smallTile({
    label: 'Each',
    value: moneyMarkup(currencyShort(everyone.length ? m.spent / everyone.length : m.spent)),
    note: owners.map((o) => `${escapeAttr(o)} ${currencyShort(m.paid[o])}`).join(' · ') || [...everyone, 'Joint'].join(' · '),
    foot: `
      <span class="trip-split${owners.length ? '' : ' is-empty'}" aria-hidden="true">
        ${owners.map((o) => `<i style="flex:${m.paid[o]}; background:${spendOwnerColor(o)}" title="${escapeAttr(o)} ${currencyShort(m.paid[o])}"></i>`).join('')}
      </span>
      <p class="stat-tile__foot">${settle}</p>`,
  });
}

/** The pencil on the Budget tile, which opens the tile's editor. */
const editBudgetButton = (has) => `
  <button type="button" class="tile-edit" data-edit-budget aria-label="${has ? 'Edit' : 'Set'} the budget" title="${has ? 'Edit' : 'Set'} the budget">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 19.5l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3l-10 10-4 1.5ZM13.5 7l3 3" stroke="currentColor"/></svg>
  </button>`;

/**
 * The financial summary: four tiles across — the trip's Budget (from the
 * `trips` table, editable from its pencil), what's been Spent, what's
 * Remaining, and Each (who paid, and who owes whom). With no budget set,
 * Budget and Remaining show "Not set" and "—" in a quieter ink; with
 * nothing tagged yet, Spent and Each do.
 */
function renderStats(m) {
  const { trip, status } = m;
  const grid = document.getElementById('trip-stats');
  document.getElementById('trip-hero-eyebrow').textContent = 'Financial summary';
  const everyone = people();
  const unsorted = trip.txs.filter((t) => t.part === 'unsorted').length;
  const perDay = m.through ? m.spent / m.through : 0;
  const remaining = m.budget - m.spent;
  const over = m.budget > 0 && remaining < 0;

  const budgetTile = m.budget
    ? smallTile({
      label: 'Budget',
      action: editBudgetButton(true),
      value: moneyMarkup(currencyShort(m.budget)),
      note: `${currencyShort(m.budget / m.days)} a day · ${plural(m.days, 'day')}`,
      foot: tileFoot('Per person', currencyShort(m.budget / Math.max(everyone.length, 1))),
    })
    : smallTile({
      label: 'Budget',
      action: editBudgetButton(false),
      value: 'Not set',
      valueClass: ' stat-tile__value--text',
      note: '<button type="button" class="tile-link" data-edit-budget>Set a budget</button>',
      foot: tileFoot('Per person', '—'),
    });

  const spentTile = smallTile({
    label: 'Spent',
    value: moneyMarkup(currencyShort(m.spent)),
    note: !trip.txs.length
      ? `Nothing tagged to ${escapeAttr(trip.name)} yet`
      : unsorted
        ? `${plural(trip.txs.length, 'transaction')} · <a class="hero-tile__link is-ahead" href="#trip-sort-wrap">${unsorted} to sort</a>`
        : m.budget
          ? `${Math.round((m.spent / m.budget) * 100)}% of the budget`
          : plural(trip.txs.length, 'transaction'),
    foot: tileFoot('Per day', trip.txs.length ? currencyShort(perDay) : '—'),
  });

  let remainingTile;
  if (!m.budget) {
    remainingTile = smallTile({ label: 'Remaining', value: '—', valueClass: ' stat-tile__value--text', note: 'Set a budget to track it', foot: tileFoot('Per day', '—') });
  } else if (over) {
    remainingTile = smallTile({
      label: 'Over budget',
      value: moneyMarkup(currencyShort(-remaining)),
      valueClass: ' is-negative',
      note: `${Math.round((m.spent / m.budget) * 100)}% of the budget spent`,
      tone: 'is-negative',
      foot: tileFoot('Per day over', currencyShort(-remaining / m.days), 'is-negative'),
    });
  } else {
    const footByStatus = {
      saving: tileFoot('Per day', currencyShort(remaining / m.days)),
      away: tileFoot(`Per day, last ${plural(m.daysLeft, 'day')}`, currencyShort(remaining / m.daysLeft)),
      done: tileFoot('Came in under by', currencyShort(remaining), 'is-positive'),
    };
    remainingTile = smallTile({
      label: 'Remaining',
      value: moneyMarkup(currencyShort(remaining)),
      note: { saving: `to spend · ${plural(daysBetween(TODAY, trip.start), 'day')} to go`, away: `left for the last ${plural(m.daysLeft, 'day')}`, done: 'under budget' }[status],
      tone: status === 'done' ? 'is-positive' : '',
      foot: footByStatus[status],
    });
  }

  grid.className = 'stats-grid stats-grid--quad';
  grid.innerHTML = [budgetTile, spentTile, remainingTile, peopleTile(m)].join('');
  const tiles = grid.children;
  tiles[0].classList.add('budget-tile');
  tiles[0].classList.toggle('is-empty', !m.budget);
  tiles[1].classList.toggle('is-empty', !trip.txs.length);
  tiles[2].classList.toggle('is-empty', !m.budget);
  tiles[3].classList.toggle('is-empty', !trip.txs.length);
}

/**
 * Editing the budget, part by part, on the "By part" tile: its pencil
 * (or the Budget tile's, or "Set a budget") swaps the bars for a slider
 * and a £ field for each part, with the total adding up live in the
 * tile's corner. A faint tick on each slider marks what the part has
 * spent so far. Save (or Enter) updates the page straight away and the
 * `trips` table behind it, with Undo; Cancel or Escape leaves it as it
 * was. Nothing is saved while sliding.
 */
function initBudgetEditing() {
  const detail = document.getElementById('trip-detail');
  const section = document.querySelector('.trip-parts');
  const list = document.getElementById('trip-budget');
  const form = document.getElementById('trip-budget-form');
  const meta = document.getElementById('trip-budget-meta');
  let trip = null;
  let draft = {}; // { part: pounds } as it's being set
  let spentBy = {}; // { part: pounds } spent so far

  /** The slider's reach: at least £2,000, and room for the part's budget and spending. */
  const reach = (part, value) => Math.max(2000, Math.ceil((value * 2) / 100) * 100, Math.ceil((spentBy[part] || 0) / 100) * 100);

  const showTotal = () => {
    const total = sum(Object.values(draft));
    meta.textContent = `Total ${currencyShort(total)}`;
    meta.classList.add('is-editing');
  };

  /** Brings a part's slider, field and spent tick in line with draft[part] (growing the slider when the field goes past it). */
  const sync = (row, { from } = {}) => {
    const part = row.dataset.part;
    const value = draft[part];
    const range = row.querySelector('input[type="range"]');
    const amount = row.querySelector('.part-slider__amount');
    if (value > Number(range.max)) range.max = Math.ceil(value / 100) * 100;
    if (from !== range) range.value = value;
    if (from !== amount) amount.value = value || '';
    const max = Number(range.max);
    row.style.setProperty('--fill', `${(Math.min(value, max) / max) * 100}%`);
    row.style.setProperty('--spent', Math.min((spentBy[part] || 0) / max, 1));
  };

  const open = () => {
    trip = TRIPS.find((t) => t.id === view.trip);
    if (!trip) return;
    spentBy = tripModel(trip).byPart;
    draft = Object.fromEntries(BUDGET_PARTS.map((part) => [part, trip.budget[part] || 0]));
    const totalOnly = trip.total && !Object.keys(trip.budget).length;

    form.innerHTML = `
      <div class="part-sliders">
        ${BUDGET_PARTS.map((part, i) => {
          const info = PARTS[part];
          const spent = spentBy[part] || 0;
          return `
            <div class="part-slider" data-part="${part}" style="--avatar-color:${info.color}; --i:${i}">
              <div class="part-slider__head">
                <label class="budget-item__category trip-part" for="part-range-${part}">
                  <span class="trip-part__icon" aria-hidden="true">${categoryIcon(info.icon)}</span>${info.label}
                </label>
                <span class="trip-field__money part-slider__money">
                  <span class="trip-field__currency" aria-hidden="true">£</span>
                  <input class="trip-field__input part-slider__amount" type="number" min="0" step="any" inputmode="decimal" placeholder="0" aria-label="${info.label} budget, in pounds">
                </span>
              </div>
              <span class="part-slider__track">
                <input type="range" id="part-range-${part}" min="0" max="${reach(part, draft[part])}" step="10" value="${draft[part]}">
                ${spent ? `<span class="part-slider__spent" title="Spent ${currencyShort(spent)}"></span>` : ''}
              </span>
              <p class="budget-item__note">${spent ? `${currencyShort(spent)} spent so far` : BOOKED_PARTS.has(part) ? 'Not booked yet' : 'Nothing spent yet'}</p>
            </div>`;
        }).join('')}
      </div>
      <div class="part-sliders__foot">
        <p class="budget-edit__hint">${totalOnly ? `Was ${currencyShort(trip.total)} overall — split it across the parts.` : 'The trip’s budget is the total of its parts. Set a part to £0 to leave it out.'}</p>
        <div class="budget-edit__actions">
          <button type="button" class="btn btn--ghost" data-cancel-budget>Cancel</button>
          <button type="submit" class="btn btn--primary">Save</button>
        </div>
      </div>`;
    form.querySelectorAll('.part-slider').forEach((row) => sync(row));
    list.hidden = true;
    form.hidden = false;
    section.classList.add('is-editing');
    showTotal();
    section.scrollIntoView({ behavior: motion.reduced() ? 'auto' : 'smooth', block: 'start' });
    form.querySelector('input[type="range"]').focus({ preventScroll: true });
  };

  detail.addEventListener('click', (event) => {
    if (event.target.closest('[data-edit-budget]')) open();
    else if (event.target.closest('[data-cancel-budget]')) render();
  });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') render();
  });
  form.addEventListener('input', (event) => {
    const row = event.target.closest('.part-slider');
    if (!row) return;
    const value = Number(event.target.value);
    draft[row.dataset.part] = value > 0 ? Math.round(value * 100) / 100 : 0;
    sync(row, { from: event.target });
    showTotal();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setBudgets(trip, Object.fromEntries(Object.entries(draft).filter(([, amount]) => amount > 0)));
  });
}

/** Closes the part editor (render() redraws the bars in its place). */
function closeBudgetEditing() {
  document.getElementById('trip-budget-form').hidden = true;
  document.getElementById('trip-budget').hidden = false;
  document.querySelector('.trip-parts').classList.remove('is-editing');
  document.getElementById('trip-budget-meta').classList.remove('is-editing');
}

/** Sets a trip's part budgets on the page and in Supabase, with Undo; puts them back if the save fails. */
function setBudgets(trip, next) {
  const previous = { parts: trip.budget, total: trip.total ?? null };
  const nextTotal = Object.keys(next).length ? sum(Object.values(next)) : null;
  const apply = ({ parts, total }) => {
    trip.budget = parts;
    trip.total = total;
    render();
  };
  apply({ parts: next, total: nextTotal });
  const unchanged = nextTotal === previous.total && BUDGET_PARTS.every((p) => (next[p] || 0) === (previous.parts[p] || 0));
  if (unchanged) return;

  const saving = updateTripBudgets(trip.dbId, next);
  showToast({
    message: nextTotal === null ? `Removed the budget for ${trip.name}` : `Budget for ${trip.name} set to ${currencyShort(nextTotal)}`,
    action: {
      label: 'Undo',
      onClick: async () => {
        apply(previous);
        try {
          await saving.catch(() => {}); // nothing to undo server-side if the save itself failed
          await updateTripBudgets(trip.dbId, previous.parts, previous.total);
          showToast({ message: 'Change undone', tone: 'info', duration: 2500 });
        } catch (error) {
          console.error('[Ledger] Could not undo the budget:', error);
          apply({ parts: next, total: nextTotal });
          showToast({ message: 'Couldn’t undo — the change was kept', tone: 'error' });
        }
      },
    },
  });
  saving.catch((error) => {
    console.error('[Ledger] Could not save the budget:', error);
    apply(previous);
    showToast({ message: `Couldn’t save the budget — it’s been put back. ${describeError(error)}`, tone: 'error' });
  });
}

// ============================================================
// THE PLAN
// ============================================================

/** The budget's parts as bars, like Overview's Budget vs Actual (with the part's icon). */
function renderBudget(m) {
  const { trip, status } = m;
  const list = document.getElementById('trip-budget');
  list.classList.add('is-entering');
  if (!Object.keys(trip.budget).length) { renderUnbudgeted(m, list); return; }
  const pace = status === 'away' ? m.day / m.days : 0;

  list.innerHTML = Object.entries(trip.budget).map(([part, budget], i) => {
    const info = PARTS[part];
    const actual = m.byPart[part];
    const booked = BOOKED_PARTS.has(part);
    const percentage = Math.round((actual / budget) * 100);
    const over = actual > budget;
    const showPace = status === 'away' && !booked && !over;
    const paceAmount = budget * pace;
    const ahead = showPace && actual > paceAmount;

    const scale = Math.max(budget, actual);
    const fillWidth = (Math.min(actual, budget) / scale) * 100;
    const limitAt = (budget / scale) * 100;
    const firstTx = trip.txs.find((t) => t.part === part);

    let status_ = over ? `${currencyShort(actual - budget)} over` : `${percentage}%`;
    let note = '';
    let tone = '';
    if (status === 'saving') {
      if (!actual) { status_ = 'To book'; note = `About ${currencyShort(budget)} · not booked yet`; }
      else if (actual >= budget * 0.9) { note = `Booked ${shortDate(firstTx.date)} · ${currencyShort(budget - actual)} under plan`; tone = 'is-positive'; }
      else note = `${currencyShort(actual)} paid ${shortDate(firstTx.date)} · about ${currencyShort(budget - actual)} to go`;
    } else if (over) {
      note = `${currencyShort(actual - budget)} over`;
      tone = 'is-negative';
    } else if (status === 'done' || booked) {
      const under = budget - actual >= 1 ? `${currencyShort(budget - actual)} under` : 'on budget';
      note = booked && firstTx ? `Booked ${shortDate(firstTx.date)} · ${under}` : `${currencyShort(budget - actual)} unspent`;
      tone = status === 'done' ? 'is-positive' : '';
    } else {
      const perDay = `${currencyShort((budget - actual) / m.daysLeft)}/day left`;
      note = ahead ? `${currencyShort(actual - paceAmount)} ahead of pace · ${perDay}` : perDay;
      tone = ahead ? 'is-ahead' : '';
    }

    return `
      <li class="budget-item${over ? ' is-over' : ''}${ahead ? ' is-ahead' : ''}" style="--i:${i}">
        <div class="budget-item__header">
          <span class="budget-item__category trip-part" style="--avatar-color:${info.color}">
            <span class="trip-part__icon" aria-hidden="true">${categoryIcon(info.icon)}</span>${info.label}
          </span>
          <span class="budget-item__summary">
            <span class="budget-item__amounts">${currencyShort(actual)} of ${currencyShort(budget)}</span>
            <span class="budget-item__status">${status_}</span>
          </span>
        </div>
        <div class="budget-item__bar" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="${Math.max(100, percentage)}" aria-label="${info.label}: ${currencyShort(actual)} of ${currencyShort(budget)}">
          <span class="budget-item__track">
            <span class="budget-item__fill" style="width:${fillWidth}%; background:${info.color}"></span>
            ${over ? `<span class="budget-item__overflow" style="left:${limitAt}%; width:${100 - limitAt}%"></span>` : ''}
          </span>
          ${over ? `<span class="budget-item__limit" style="left:${limitAt}%"></span>` : ''}
          ${showPace ? `<span class="budget-item__pace" style="left:${(paceAmount / scale) * 100}%" title="Pace for day ${m.day}: ${currencyShort(paceAmount)}"></span>` : ''}
        </div>
        <p class="budget-item__note ${tone}">${note}</p>
      </li>`;
  }).join('') + Object.keys(PARTS) // then what's been spent on parts without a budget (and what's still to sort)
    .filter((part) => !trip.budget[part] && m.byPart[part])
    .map((part, i) => unbudgetedRow(m, part, Object.keys(trip.budget).length + i, m.byPart[part]))
    .join('');

  document.getElementById('trip-budget-meta').textContent = {
    saving: `${currencyShort(m.booked)} booked of ${currencyShort(m.budget)}`,
    away: `Day ${m.day} of ${m.days}`,
    done: `${currencyShort(m.spent)} of ${currencyShort(m.budget)}`,
  }[status];
}

/** A part without a budget: what it's spent, its bar as its share of the trip. */
function unbudgetedRow(m, part, i, actual) {
  const info = PARTS[part];
  const share = m.spent ? Math.round((actual / m.spent) * 100) : 0;
  return `
    <li class="budget-item${actual ? '' : ' is-empty'}" style="--i:${i}">
      <div class="budget-item__header">
        <span class="budget-item__category trip-part" style="--avatar-color:${info.color}">
          <span class="trip-part__icon" aria-hidden="true">${categoryIcon(info.icon)}</span>${info.label}
        </span>
        <span class="budget-item__summary">
          <span class="budget-item__amounts">${actual ? currencyShort(actual) : `${currencyShort(0)} of —`}</span>
          <span class="budget-item__status">${actual ? `${share}%` : '—'}</span>
        </span>
      </div>
      <div class="budget-item__bar" aria-label="${info.label}: ${currencyShort(actual)}, no budget set">
        <span class="budget-item__track">
          ${actual ? `<span class="budget-item__fill" style="width:${share}%; background:${info.color}"></span>` : ''}
        </span>
      </div>
      <p class="budget-item__note${part === 'unsorted' ? ' is-ahead' : ''}">${part === 'unsorted' ? `${share}% of the trip · choose what each was for, above` : actual ? `${share}% of the trip` : BOOKED_PARTS.has(part) ? 'Not booked yet' : 'Nothing yet'}</p>
    </li>`;
}

/**
 * Budget by part with no budget set yet: each part with spending, its
 * bar as its share of the trip, then the parts still waiting for a budget.
 */
function renderUnbudgeted(m, list) {
  const spentParts = Object.keys(PARTS).filter((p) => m.byPart[p]);
  list.innerHTML = [
    ...spentParts.map((p, i) => unbudgetedRow(m, p, i, m.byPart[p])),
    ...BUDGET_PARTS.filter((p) => !m.byPart[p]).map((p, i) => unbudgetedRow(m, p, spentParts.length + i, 0)),
  ].join('');
  document.getElementById('trip-budget-meta').textContent = m.spent ? `${currencyShort(m.spent)} in all` : '';
}

// ============================================================
// DAY BY DAY
// ============================================================

function txRow(m, t, { withDate = false } = {}) {
  const info = PARTS[t.part];
  const fx = m.trip.fx && t.date >= m.trip.start
    ? ` · ${m.trip.fx.symbol}${(t.amount * m.trip.fx.rate).toLocaleString('en-GB', { maximumFractionDigits: m.trip.fx.rate > 20 ? 0 : 2, minimumFractionDigits: m.trip.fx.rate > 20 ? 0 : 2 })}`
    : '';
  return `
    <li class="trip-tx">
      <span class="trip-tx__avatar" style="--avatar-color:${info.color}" aria-hidden="true">${categoryIcon(info.icon)}</span>
      <span class="trip-tx__main">
        <span class="trip-tx__merchant">${escapeAttr(t.merchant)}</span>
        <span class="trip-tx__meta">${withDate ? `${shortDate(t.date)} · ` : ''}${subCategorySelect(t)} · ${escapeAttr(t.who)}${fx}</span>
      </span>
      <span class="trip-tx__amount">${MINUS}${currency(t.amount)}</span>
    </li>`;
}

/** A transaction's sub-category as a quiet dropdown (like the transactions table's category), to change it. */
function subCategorySelect(t) {
  const options = [...HOLIDAY_SUB_CATEGORIES, 'unsorted']
    .map((id) => `<option value="${id}"${id === t.part ? ' selected' : ''}>${PARTS[id].label}</option>`).join('');
  return `<select class="category-select trip-tx__sub" data-tx-id="${escapeAttr(t.id)}" aria-label="Sub-category for ${escapeAttr(t.merchant)}">${options}</select>`;
}

/** One day of the itinerary: its number in the serif, its date, its total, and what was spent on it. */
function dayCard({ title, date = '', total = null, rows, flag = '', tone = '', i = 0 }) {
  return `
    <li class="itinerary-day ${tone}" style="--i:${i}">
      <div class="itinerary-day__head">
        <span class="itinerary-day__title">${title}</span>
        ${total != null ? `<span class="itinerary-day__total">${currencyShort(total)}</span>` : ''}
      </div>
      <p class="itinerary-day__date">${date}${flag ? `<span class="ledger-table__flag">${flag}</span>` : ''}</p>
      <ul class="itinerary-day__list">${rows}</ul>
    </li>`;
}

/** A line in a day card with nothing on it ("Nothing spent", "Still to come"). */
const quietRow = (text) => `<li class="itinerary-day__quiet">${text}</li>`;

/** A band across the itinerary above the days: Essentials, or what was booked before the trip. */
function itineraryStrip({ title, sub = '', total, rows }) {
  return `
    <div class="itinerary-strip">
      <div class="itinerary-strip__head">
        <span class="itinerary-strip__title">${title}</span>
        ${sub ? `<span class="itinerary-strip__sub">${sub}</span>` : ''}
        <span class="itinerary-strip__total">${currencyShort(total)}</span>
      </div>
      <ul class="itinerary-strip__list">${rows}</ul>
    </div>`;
}

/** The itinerary's title line: the dates and length of the trip. */
function itineraryHeading(m, meta) {
  document.getElementById('itinerary-sub').textContent = `${dateRange(m.trip)} · ${plural(m.days, 'day')}`;
  document.getElementById('itinerary-meta').textContent = meta;
}

/**
 * The itinerary: the trip day by day. Essentials (flights, parking) come
 * first as a band with each one's date, then a card for every day of the
 * trip with its total and what was spent on it — today picked out in
 * gold, days still to come faded.
 */
function renderItinerary(m) {
  const { trip } = m;
  const essential = (t) => ESSENTIAL_PARTS.has(t.part);
  const before = trip.txs.filter((t) => t.date < trip.start);
  const essentials = trip.txs.filter((t) => t.date >= trip.start && essential(t));
  document.getElementById('itinerary-strips').innerHTML = [
    before.length ? itineraryStrip({
      title: m.status === 'saving' ? 'Booked so far' : 'Booked before you went',
      total: sum(before.map((t) => t.amount)),
      rows: before.map((t) => txRow(m, t, { withDate: true })).join(''),
    }) : '',
    essentials.length ? itineraryStrip({
      title: 'Essentials',
      sub: [...ESSENTIAL_PARTS].map((p) => PARTS[p].label).join(' & '),
      total: sum(essentials.map((t) => t.amount)),
      rows: essentials.map((t) => txRow(m, t, { withDate: true })).join(''),
    }) : '',
  ].join('');

  const perDayLeft = m.daysLeft ? (m.budget - m.spent) / m.daysLeft : 0;
  document.getElementById('trip-days').innerHTML = tripDays(m).map((d, i) => {
    const future = m.status === 'away' && i + 1 > m.day;
    const today = d.iso === TODAY;
    const txs = d.txs.filter((t) => !essential(t));
    return dayCard({
      i,
      title: `Day ${i + 1}`,
      date: dayLabel(d.iso),
      total: future ? null : sum(txs.map((t) => t.amount)),
      flag: today ? 'Today' : '',
      tone: `${future ? 'is-future' : ''}${today ? ' is-today' : ''}`,
      rows: future
        ? quietRow(`Still to come${m.budget && perDayLeft > 0 ? ` · about ${currencyShort(perDayLeft)} to spend` : ''}`)
        : txs.map((t) => txRow(m, t)).join('') || quietRow(m.status === 'saving' ? 'Nothing booked' : 'Nothing spent'),
    });
  }).join('');
  itineraryHeading(m, `${plural(trip.txs.length, 'transaction')}${trip.fx ? ` · ${trip.fx.symbol}${trip.fx.rate} to the pound` : ''}`);
}

// ============================================================
// TO SORT
// ============================================================

/**
 * To sort: the trip's Holiday transactions with no sub-category yet,
 * each with a chip for every sub-category — one tap files it (and
 * saves it to Supabase). Hidden when there's nothing to sort.
 */
function renderToSort(m) {
  const unsorted = m.trip.txs.filter((t) => t.part === 'unsorted');
  document.getElementById('trip-sort-wrap').hidden = !unsorted.length;
  if (!unsorted.length) return;
  document.getElementById('trip-sort-meta').textContent = `${plural(unsorted.length, 'transaction')} · ${currencyShort(sum(unsorted.map((t) => t.amount)))}`;
  document.getElementById('trip-sort-list').innerHTML = unsorted.map((t, i) => `
    <li class="trip-sort__item" style="--i:${i}">
      <div class="trip-tx trip-sort__tx">
        <span class="trip-tx__avatar" style="--avatar-color:${PARTS.unsorted.color}" aria-hidden="true">${categoryIcon('holiday')}</span>
        <span class="trip-tx__main">
          <span class="trip-tx__merchant">${escapeAttr(t.merchant)}</span>
          <span class="trip-tx__meta">${dayLabel(t.date)} · ${escapeAttr(t.who)}</span>
        </span>
        <span class="trip-tx__amount">${MINUS}${currency(t.amount)}</span>
      </div>
      <div class="trip-sort__choices" role="group" aria-label="What was ${escapeAttr(t.merchant)} for?">
        ${HOLIDAY_SUB_CATEGORIES.map((id) => `
          <button type="button" class="sub-chip" data-tx-id="${escapeAttr(t.id)}" data-sub="${id}" style="--chip-color:${PARTS[id].color}">
            ${categoryIcon(PARTS[id].icon)}<span>${PARTS[id].label}</span>
          </button>`).join('')}
      </div>
    </li>`).join('');
}

/**
 * Files a Holiday transaction under a sub-category (or, with null, back
 * to be sorted): the page updates straight away, the change is saved to
 * Supabase (transactions_metadata.manual_sub_category), and a toast
 * offers Undo. If the save fails, the change is put back. Works like
 * the transactions table's edits (table.js editWithUndo).
 */
function setSubCategory(txId, next) {
  const tx = Object.values(TRANSACTIONS).flat().find((t) => t.id === txId);
  if (!tx) return;
  const previous = tx.subCategory ?? null;
  if (previous === next) return;
  const apply = (value) => {
    tx.subCategory = value;
    tagTransactions();
    render();
  };

  apply(next);
  const saving = updateTransactionSubCategory(txId, next);
  showToast({
    message: next ? `Filed ${tx.merchant} under ${PARTS[next].label}` : `Moved ${tx.merchant} back to sort`,
    action: {
      label: 'Undo',
      onClick: async () => {
        apply(previous);
        try {
          await saving.catch(() => {}); // nothing to undo server-side if the save itself failed
          await updateTransactionSubCategory(txId, previous);
          saveDataCache();
          showToast({ message: 'Change undone', tone: 'info', duration: 2500 });
        } catch (error) {
          console.error('[Ledger] Could not undo the sub-category:', error);
          apply(next);
          showToast({ message: 'Couldn’t undo — the change was kept', tone: 'error' });
        }
      },
    },
  });
  saving.then(saveDataCache, (error) => {
    console.error('[Ledger] Could not save the sub-category:', error);
    apply(previous);
    showToast({ message: `Couldn’t save that change — it’s been reverted. ${describeError(error)}`, tone: 'error' });
  });
}

/** Sorting from the chips, and changing a sub-category from a transaction's dropdown. */
function initSubCategories() {
  document.getElementById('trip-sort-list').addEventListener('click', (event) => {
    const chip = event.target.closest('.sub-chip');
    if (chip) setSubCategory(chip.dataset.txId, chip.dataset.sub);
  });
  document.querySelector('.itinerary').addEventListener('change', (event) => {
    const select = event.target.closest('.trip-tx__sub');
    if (select) setSubCategory(select.dataset.txId, select.value === 'unsorted' ? null : select.value);
  });
}

// ============================================================
// HOME
// ============================================================

/**
 * The page's opening view: how many trips, how long away and what
 * they cost, what's next; where the money went (by trip, and who paid
 * for each); then a card for every place (each opens its trip).
 */
function renderHome() {
  const models = TRIPS.map(tripModel);
  const taken = models.filter((m) => m.status !== 'saving');
  const budgeted = models.filter((m) => m.status === 'done' && m.budget > 0);
  const within = budgeted.filter((m) => m.spent <= m.budget).length;
  const away = models.find((m) => m.status === 'away');
  const next = models.filter((m) => m.status === 'saving').sort((a, b) => (a.trip.start < b.trip.start ? -1 : 1))[0];
  const daysAway = sum(taken.map((m) => m.day));
  const spent = sum(taken.map((m) => m.spent));
  const places = new Set(TRIPS.map((t) => t.name.toLowerCase())).size;

  document.getElementById('trip-title').textContent = 'Trips';
  document.getElementById('trip-subtitle').textContent = TRIPS.length
    ? `${plural(TRIPS.length, 'trip')} · ${plural(places, 'place')} · since ${parse(TRIPS[0].start).getFullYear()}`
    : 'Plan your first trip to start saving for it';

  const soon = away || next;
  document.getElementById('trips-glance').innerHTML = [
    smallTile({
      label: 'Trips taken',
      value: String(taken.length),
      note: budgeted.length
        ? `${within} of ${budgeted.length} within budget`
        : `${plural(taken.filter((m) => m.spent).length, 'trip')} with Holiday spending`,
    }),
    smallTile({
      label: 'Days away',
      value: String(daysAway),
      note: `across ${plural(new Set(taken.map((m) => m.trip.name.toLowerCase())).size, 'place')}`,
    }),
    smallTile({
      label: 'Spent on trips',
      value: moneyMarkup(currencyShort(spent)),
      note: daysAway ? `${currencyShort(spent / daysAway)} a day away` : 'Nothing tagged yet',
    }),
    smallTile({
      label: away ? 'Right now' : 'Next trip',
      value: soon ? escapeAttr(soon.trip.name) : '—',
      valueClass: ' stat-tile__value--text',
      note: away
        ? `Away · day ${away.day} of ${away.days}`
        : next ? `In ${plural(daysBetween(TODAY, next.trip.start), 'day')} · ${dateRange(next.trip, 'short')}` : 'Nothing planned yet',
    }),
  ].join('');

  document.getElementById('places').innerHTML = [...TRIPS].reverse().map((trip, i) => {
    const m = tripModel(trip);
    const flag = { saving: 'Saving', away: 'Away', done: '' }[m.status];
    const note = {
      saving: `In ${plural(daysBetween(TODAY, trip.start), 'day')}`,
      away: `Day ${m.day} of ${m.days}`,
      done: m.spent ? `${currencyShort(m.spent / m.days)} a day` : plural(m.days, 'day'),
    }[m.status];
    return `
      <li style="--i:${i}">
        <button type="button" class="place" data-trip="${trip.id}">
          <span class="place__top">
            <span class="place__name">${escapeAttr(trip.name)}</span>
            ${flag ? `<span class="place__flags"><span class="ledger-table__flag">${flag}</span></span>` : ''}
          </span>
          <span class="place__meta">${trip.place ? `${escapeAttr(trip.place)} · ` : ''}${dateRange(trip, 'short')}</span>
          <span class="place__strip${m.spent ? '' : ' is-empty'}${m.status === 'saving' ? ' is-booked' : ''}" aria-hidden="true">
            ${Object.keys(m.paid).map((o) => `<i style="flex:${m.paid[o]}; background:${spendOwnerColor(o)}"></i>`).join('')}
          </span>
          <span class="place__foot">
            <span class="place__figure${m.spent ? '' : ' is-empty'}">${m.spent ? currencyShort(m.spent) : 'Nothing tagged yet'}</span>
            <span class="place__note">${note}</span>
          </span>
        </button>
      </li>`;
  }).join('') || '<li class="places__empty">No trips yet. Plan one to get started.</li>';
  document.getElementById('places-meta').textContent = plural(places, 'place');

  renderHomeTrips(models);
  renderHomeCompare(models);
}

let tripsChart = null;
let compareChart = null;

/** A colour as Chart.js needs it: 'var(--cat-dining)' read off the page. */
const resolve = (color) => (color.startsWith('var(') ? cssVar(color.slice(4, -1)) : color);

/** Each trip's colour on the home charts, in turn (the category palette, so they read in both themes). */
const TRIP_COLORS = ['--cat-holiday', '--cat-health', '--cat-dining', '--cat-activities', '--cat-transport', '--cat-shopping', '--cat-subscriptions', '--cat-groceries', '--cat-birthday'];

/**
 * Spending by trip, drawn like the Overview's category doughnut: a slim
 * ring, a slice per trip with spending, the total in the middle, and a
 * legend that highlights its slice.
 */
function renderHomeTrips(models) {
  const entries = models
    .filter((m) => m.spent > 0)
    .sort((x, y) => y.spent - x.spent)
    .map((m, i) => ({ id: m.trip.id, label: m.trip.name, total: m.spent, color: `var(${TRIP_COLORS[i % TRIP_COLORS.length]})` }));
  const total = sum(entries.map((e) => e.total));
  const colors = entries.map((e) => resolve(e.color));
  const canvas = document.getElementById('home-trips-chart');
  const legend = document.getElementById('home-trips-legend');

  let center = canvas.parentElement.querySelector('.donut-center');
  if (!center) {
    center = document.createElement('div');
    center.className = 'donut-center';
    center.setAttribute('aria-hidden', 'true');
    center.innerHTML = '<span class="donut-center__label"></span><span class="donut-center__value"></span><span class="donut-center__meta"></span>';
    canvas.parentElement.appendChild(center);
  }
  const [labelEl, valueEl, metaEl] = center.children;
  const showCenter = (i) => {
    const e = entries[i];
    center.classList.toggle('is-focused', Boolean(e));
    labelEl.textContent = e ? e.label : 'All trips';
    valueEl.textContent = currencyShort(e ? e.total : total);
    metaEl.textContent = e ? `${Math.round((e.total / total) * 100)}% of the total` : plural(entries.length, 'trip');
    if (e) center.style.setProperty('--focus-color', colors[i]);
  };

  let active = null;
  if (tripsChart) tripsChart.destroy();
  tripsChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: entries.map((e) => e.label),
      datasets: [{
        data: entries.length ? entries.map((e) => e.total) : [1],
        backgroundColor: entries.length
          ? (c) => (active === null || c.dataIndex === active ? colors[c.dataIndex] : fade(colors[c.dataIndex], 0.28))
          : [cssVar('--border')],
        borderWidth: 0,
        spacing: entries.length > 1 ? 3 : 0,
        borderRadius: 3,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: '84%',
      layout: { padding: 8 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: drawn ? { duration: 350 } : { duration: 1100, easing: 'easeOutQuart' },
      onHover: (_event, elements) => setActive(entries.length && elements.length ? elements[0].index : null),
      onClick: (_event, elements) => setActive(elements.length && elements[0].index !== active ? elements[0].index : null),
    },
  });

  function setActive(i) {
    if (i === active) return;
    active = i;
    tripsChart.setActiveElements(i === null ? [] : [{ datasetIndex: 0, index: i }]);
    tripsChart.update('none');
    showCenter(i);
    legend.querySelectorAll('[data-index]').forEach((li) => li.classList.toggle('is-active', Number(li.dataset.index) === i));
    legend.classList.toggle('has-active', i !== null);
  }
  canvas.onmouseleave = () => setActive(null);

  legend.classList.remove('has-active');
  legend.innerHTML = entries.map((e, i) => `
    <li data-index="${i}" tabindex="0" style="--i:${i}">
      <span class="legend__swatch" style="background:${e.color}"></span>
      <span class="legend__name">${escapeAttr(e.label)}</span>
      <span class="legend__amount">${currencyShort(e.total)}</span>
    </li>`).join('') || '<li class="legend__name">Nothing tagged to a trip yet</li>';
  const rowIndex = (event) => {
    const li = event.target.closest('[data-index]');
    return li ? Number(li.dataset.index) : null;
  };
  legend.onmouseover = (event) => { const i = rowIndex(event); if (i !== null) setActive(i); };
  legend.onmouseleave = () => setActive(null);
  legend.onfocusin = (event) => { const i = rowIndex(event); if (i !== null) setActive(i); };
  legend.onfocusout = (event) => { if (!legend.contains(event.relatedTarget)) setActive(null); };
  legend.onclick = (event) => { const i = rowIndex(event); if (i !== null) setActive(i === active ? null : i); }; // tap on touch screens

  canvas.setAttribute('aria-label', entries.length
    ? `Spending by trip, ${currency(total)}: ${entries.map((e) => `${e.label} ${currency(e.total)}`).join(', ')}`
    : 'No spending tagged to a trip yet');
  showCenter(null);
  document.getElementById('home-trips-meta').textContent = entries.length ? `${currencyShort(total)} in all` : '';
}

/**
 * Trip by trip: each trip's cost as one bar, newest at the top, split by
 * whose account paid (in the Overview's colours for each owner), with
 * its budget as a gold tick when it has one.
 */
function renderHomeCompare(models) {
  const rows = models.filter((m) => m.spent > 0 || m.budget > 0).sort((a, b) => (a.trip.start < b.trip.start ? 1 : -1));
  const owners = [...new Set(rows.flatMap((m) => Object.keys(m.paid)))].sort();
  const surface = cssVar('--surface');
  const gold = cssVar('--gold');
  const muted = cssVar('--text-faint');
  const text = cssVar('--text');
  const canvas = document.getElementById('home-compare-chart');
  const tile = canvas.closest('.chart-tile');
  tile.querySelector('.trips-compare__empty').hidden = rows.length > 0;
  canvas.parentElement.hidden = !rows.length;
  canvas.parentElement.style.height = `${Math.max(160, rows.length * 46 + 36)}px`;
  document.getElementById('home-compare-legend').innerHTML = [
    ...owners.map((o) => `<li><span class="trend-legend__swatch" style="background:${spendOwnerColor(o)}"></span>${escapeAttr(o)}</li>`),
    ...(rows.some((m) => m.budget) ? ['<li><span class="trips-compare__tick"></span>Budget</li>'] : []),
  ].join('');

  if (compareChart) compareChart.destroy();
  compareChart = null;
  if (!rows.length) return;
  canvas.parentElement.querySelector('.chart-tooltip')?.classList.remove('is-visible');
  compareChart = new Chart(canvas, {
    data: {
      labels: rows.map((m) => m.trip.name),
      datasets: [
        ...owners.map((owner) => ({
          type: 'bar',
          label: owner,
          data: rows.map((m) => m.paid[owner] || 0),
          backgroundColor: fade(resolve(spendOwnerColor(owner)), 0.9),
          borderColor: surface,
          borderWidth: 1.5,
          borderSkipped: false,
          borderRadius: 4,
          barPercentage: 0.72,
          categoryPercentage: 0.86,
          maxBarThickness: 24,
          stack: 'cost',
          order: 2,
        })),
        {
          type: 'line',
          label: 'Budget',
          indexAxis: 'y',
          data: rows.map((m) => m.budget || null),
          showLine: false,
          pointStyle: 'line',
          rotation: 90,
          pointRadius: 12,
          pointHoverRadius: 12,
          pointBorderColor: gold,
          pointBorderWidth: 2.5,
          order: 1,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      layout: { padding: { right: 8 } },
      interaction: { mode: 'index', axis: 'y', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: htmlTooltip((points) => {
            const m = rows[points[0].dataIndex];
            return {
              title: `${m.trip.name} · ${dateRange(m.trip, 'short')}`,
              rows: [
                ...owners.filter((o) => m.paid[o]).map((o) => ({ label: o, value: currencyShort(m.paid[o]), swatch: spendOwnerColor(o) })),
                ...(m.budget ? [{ label: 'Budget', value: currencyShort(m.budget), swatch: 'line' }] : []),
              ],
              footer: ['Total', currencyShort(m.spent)],
            };
          }),
        },
      },
      scales: {
        x: {
          stacked: true,
          border: { display: false },
          grid: { color: fade(cssVar('--border-strong'), 0.45), drawTicks: false },
          ticks: { padding: 6, maxTicksLimit: 5, color: muted, font: { family: 'Geist', size: 11 }, callback: (v) => currencyShort(v) },
        },
        y: {
          stacked: true,
          border: { display: false },
          grid: { display: false },
          ticks: { padding: 10, color: text, font: { family: 'Fraunces', size: 14 } },
        },
      },
      animation: drawn ? { duration: 400 } : { duration: 900, easing: 'easeOutQuart' },
    },
  });
}

/**
 * A trip with nothing tagged yet (just saved): every widget of a trip's
 * page, laid out as it will be — the financial summary (its budget, if
 * set, and nothing spent), each part waiting, and each day of the
 * itinerary waiting for its spending.
 */
function renderEmpty(m) {
  const { status } = m;
  renderStats(m);

  // ---- By part: the budget's parts when it has them, otherwise every part, waiting ----
  if (Object.keys(m.trip.budget).length) renderBudget(m);
  else renderEmptyParts();

  // ---- The itinerary: each day of the trip, waiting for its spending ----
  document.getElementById('itinerary-strips').innerHTML = '';
  document.getElementById('trip-days').innerHTML = tripDays(m).map((d, i) => dayCard({
    i,
    title: `Day ${i + 1}`,
    date: dayLabel(d.iso),
    flag: d.iso === TODAY ? 'Today' : '',
    tone: `is-waiting${d.iso === TODAY ? ' is-today' : ''}`,
    rows: quietRow(status === 'done' || (status === 'away' && i + 1 < m.day) ? 'Nothing tagged' : 'Nothing yet'),
  })).join('');
  itineraryHeading(m, 'Nothing tagged yet');
}

/** By part with no budget and nothing spent: every part, waiting. */
function renderEmptyParts() {
  const list = document.getElementById('trip-budget');
  list.classList.remove('is-entering');
  list.innerHTML = BUDGET_PARTS.map((part) => [part, PARTS[part]]).map(([part, info], i) => `
    <li class="budget-item is-empty" style="--i:${i}">
      <div class="budget-item__header">
        <span class="budget-item__category trip-part" style="--avatar-color:${info.color}">
          <span class="trip-part__icon" aria-hidden="true">${categoryIcon(info.icon)}</span>${info.label}
        </span>
        <span class="budget-item__summary">
          <span class="budget-item__amounts">${currencyShort(0)} of —</span>
          <span class="budget-item__status">—</span>
        </span>
      </div>
      <div class="budget-item__bar" aria-label="${info.label}: no budget set">
        <span class="budget-item__track"></span>
      </div>
      <p class="budget-item__note">${BOOKED_PARTS.has(part) ? 'Not booked yet' : 'Nothing yet'}</p>
    </li>`).join('');
  document.getElementById('trip-budget-meta').textContent = '';
}

// ============================================================
// ALL TRIPS
// ============================================================

function renderLedger() {
  const body = document.getElementById('trips-ledger-body');
  body.innerHTML = [...TRIPS].reverse().map((trip, i) => {
    const m = tripModel(trip);
    const scale = Math.max(m.budget, m.spent) || 1;
    const diff = m.budget - m.spent;
    const flag = { saving: 'Saving', away: 'Away', done: '' }[m.status];
    let gap = '—';
    if (m.budget && m.status === 'done') gap = `${diff < 0 ? MINUS : '+'}${currencyShort(Math.abs(diff))}`;
    else if (m.budget) gap = `${Math.round((m.spent / m.budget) * 100)}%`;
    return `
      <tr data-trip="${trip.id}"${m.status === 'saving' ? ' class="is-forecast"' : ''}>
        <th scope="row" class="ledger-table__month">
          <a href="#" data-trip="${trip.id}">${escapeAttr(trip.name)}</a><span class="ledger-table__year"> ${trip.start.slice(0, 4)}</span>
          ${flag ? `<span class="ledger-table__flag">${flag}</span>` : ''}
        </th>
        <td class="trips-table__when">${dateRange(trip, 'short').replace(/ \d{4}$/, '')}<span> · ${plural(m.days, 'day')}</span></td>
        <td class="ledger-table__num">${m.budget ? currencyShort(m.budget) : '—'}</td>
        <td class="ledger-table__num"><span class="ledger-table__saved${m.status === 'done' && m.budget && diff < 0 ? ' is-negative' : ''}">${m.spent ? currencyShort(m.spent) : '—'}</span></td>
        <td class="ledger-table__num ledger-table__rate">${m.status === 'saving' || !m.spent ? '—' : currencyShort(m.spent / m.days)}</td>
        <td class="ledger-table__target">
          <span class="ledger-bar${m.budget && diff >= 0 ? ' is-hit' : ''}${m.budget ? '' : ' is-unset'}" style="--i:${i}">
            <span class="ledger-bar__track">
              <span class="ledger-bar__fill" style="width:${(m.spent / scale) * 100}%"></span>
              ${m.budget ? `<span class="ledger-bar__tick" style="left:${(m.budget / scale) * 100}%"></span>` : ''}
            </span>
            <span class="ledger-bar__gap">${gap}</span>
          </span>
        </td>
      </tr>`;
  }).join('');
}

// ============================================================
// NEW TRIP
// ============================================================

/** Why a save or load failed, in words (a missing table or RLS policy is the likely cause while setting up). */
function describeError(error) {
  const message = error?.message || '';
  if (/column/i.test(message) && /does not exist|could not find/i.test(message)) {
    return `Supabase is missing a column: ${message}`;
  }
  if (error?.code === 'NO_ROWS') {
    return 'Supabase didn’t save that change: the trips table needs a row-level security policy that allows it (update to edit a budget, delete to delete a trip).';
  }
  if (error?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Supabase turned this away: the trips table needs a row-level security policy that allows it.';
  }
  if (error?.code === '42P01' || error?.code === 'PGRST205' || /does not exist|could not find the table/i.test(message)) {
    return 'There’s no trips table in Supabase yet.';
  }
  return message || 'Something went wrong.';
}

/** Wires a dialog's close buttons, and closing it from the dimmed backdrop. */
function initDialog(dialog) {
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  // A click on the dimmed backdrop (the dialog itself, outside the form) closes it.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
}

/**
 * "Plan a trip": a dialog asking where and when, which saves the trip to
 * the Supabase `trips` table and then opens it. Each date opens the same
 * pop-over calendar as a transaction's date (datepicker.js); choosing a
 * start date fills in the end date if it's empty or earlier, and the end
 * date can't be set before the start. The line under the dates reads
 * back the trip's length as you go.
 */
function initNewTrip() {
  const dialog = document.getElementById('trip-dialog');
  const form = document.getElementById('trip-form');
  const location = document.getElementById('trip-location');
  const start = document.getElementById('trip-start');
  const end = document.getElementById('trip-end');
  const summary = document.getElementById('trip-form-summary');
  const error = document.getElementById('trip-form-error');
  const save = document.getElementById('trip-save');

  const showError = (text) => {
    error.textContent = text;
    error.hidden = !text;
  };
  /** Sets a date button's value ('YYYY-MM-DD' or '') and its label: "Sun 10 Jan 2027", or a prompt. */
  const setDate = (button, iso) => {
    button.dataset.value = iso;
    button.classList.toggle('is-empty', !iso);
    button.innerHTML = `
      <span>${iso ? parse(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Choose a date'}</span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" stroke="currentColor"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" stroke="currentColor"/>
      </svg>`;
  };
  const update = () => {
    const from = start.dataset.value;
    const to = end.dataset.value;
    summary.textContent = from && to
      ? `${plural(daysBetween(from, to) + 1, 'day')} · ${dateRange({ start: from, end: to })}`
      : 'Choose when you’re going';
  };

  document.getElementById('trip-new').addEventListener('click', () => {
    form.reset();
    setDate(start, '');
    setDate(end, '');
    showError('');
    update();
    dialog.showModal();
    location.focus();
  });
  initDialog(dialog);
  location.addEventListener('input', () => showError(''));

  start.addEventListener('click', () => openDatePicker({
    anchor: start,
    value: start.dataset.value,
    container: dialog,
    onSelect: (iso) => {
      setDate(start, iso);
      if (!end.dataset.value || end.dataset.value < iso) setDate(end, iso);
      showError('');
      update();
    },
  }));
  end.addEventListener('click', () => openDatePicker({
    anchor: end,
    value: end.dataset.value || start.dataset.value,
    min: start.dataset.value || undefined,
    container: dialog,
    onSelect: (iso) => {
      setDate(end, iso);
      showError('');
      update();
    },
  }));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = location.value.trim();
    const from = start.dataset.value;
    const to = end.dataset.value;
    if (!name) { showError('Add where you’re going.'); location.focus(); return; }
    if (!from || !to) { showError('Choose both dates.'); (from ? end : start).focus(); return; }
    if (to < from) { showError('The trip can’t end before it starts.'); end.focus(); return; }

    save.disabled = true;
    form.classList.add('is-uploading'); // shows the button's spinner (upload page styles)
    try {
      const trip = fromRow(await createTrip({ location: name, startDate: from, endDate: to }));
      TRIPS.push(trip);
      sortTrips();
      tagTransactions();
      dialog.close();
      showToast({ message: `${trip.name} added to your trips` });
      openTrip(trip.id);
    } catch (err) {
      console.error('[Ledger] Failed to save the trip:', err);
      showError(describeError(err));
    } finally {
      save.disabled = false;
      form.classList.remove('is-uploading');
    }
  });
}

/**
 * "Delete trip" on a saved trip's page: asks first, then deletes its row
 * from the Supabase `trips` table and returns to the home view. Sample
 * trips aren't in Supabase, so they don't get the button.
 */
function initDeleteTrip() {
  const dialog = document.getElementById('trip-delete-dialog');
  const form = document.getElementById('trip-delete-form');
  const error = document.getElementById('trip-delete-error');
  const confirm = document.getElementById('trip-delete-confirm');
  const showError = (text) => {
    error.textContent = text;
    error.hidden = !text;
  };

  document.getElementById('trip-delete').addEventListener('click', () => {
    const trip = TRIPS.find((t) => t.id === view.trip);
    if (!trip?.dbId) return;
    document.getElementById('trip-delete-title').textContent = `Delete ${trip.name}?`;
    document.getElementById('trip-delete-text').textContent = `${trip.name} (${dateRange(trip)}) will be removed from your trips. This can’t be undone.`;
    showError('');
    dialog.showModal();
    confirm.focus();
  });
  initDialog(dialog);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const trip = TRIPS.find((t) => t.id === view.trip);
    if (!trip?.dbId) return;

    confirm.disabled = true;
    form.classList.add('is-uploading');
    try {
      await deleteTrip(trip.dbId);
      TRIPS.splice(TRIPS.indexOf(trip), 1);
      dialog.close();
      showToast({ message: `${trip.name} deleted` });
      view.trip = null; // the trip has gone, so there's nothing to slide away from
      syncStepper();
      render();
      window.scrollTo({ top: 0 });
    } catch (err) {
      console.error('[Ledger] Failed to delete the trip:', err);
      showError(describeError(err));
    } finally {
      confirm.disabled = false;
      form.classList.remove('is-uploading');
    }
  });
}

// ============================================================
// PAGE
// ============================================================

/** Which trip is open (its id), or null for the home view of every trip. */
const view = { trip: null };

function render() {
  const home = !view.trip;
  document.getElementById('trips-home').hidden = !home;
  document.getElementById('trip-detail').hidden = home;
  document.getElementById('trip-delete').hidden = home || !TRIPS.find((t) => t.id === view.trip)?.dbId;
  if (home) {
    renderHome();
    renderLedger();
    drawn = true;
    return;
  }

  const trip = TRIPS.find((t) => t.id === view.trip);
  const m = tripModel(trip);
  document.getElementById('trip-title').textContent = trip.name;
  const state = {
    saving: `${m.pot ? 'Saving up' : 'Coming up'} · ${plural(daysBetween(TODAY, trip.start), 'day')} to go`,
    away: `Away now · day ${m.day} of ${m.days}`,
    done: `Home · ${plural(m.days, 'day')}`,
  }[m.status];
  document.getElementById('trip-subtitle').textContent = `${trip.place ? `${trip.place} · ` : ''}${dateRange(trip)} · ${state}`;

  // A trip with nothing tagged yet shows every widget empty (renderEmpty).
  closeBudgetEditing();
  const empty = !trip.txs.length;
  if (empty) {
    document.getElementById('trip-sort-wrap').hidden = true;
    renderEmpty(m);
  } else {
    renderToSort(m);
    renderStats(m);
    renderBudget(m);
    renderItinerary(m);
  }
  drawn = true;
}

/** The stepper's stops: the home view (null), then every trip in date order. */
const stops = () => [null, ...TRIPS.map((t) => t.id)];

/** Brings the ‹ All trips › stepper in line with the open view (and the list of trips). */
function syncStepper() {
  const select = document.getElementById('trip-select');
  select.innerHTML = `<option value="">All trips</option>${TRIPS.map((t) => `<option value="${t.id}">${escapeAttr(t.name)}</option>`).join('')}`;
  const index = stops().indexOf(view.trip);
  document.getElementById('trip-label').textContent = view.trip ? TRIPS.find((t) => t.id === view.trip).name : 'All trips';
  select.value = view.trip || '';
  document.getElementById('trip-prev').disabled = index <= 0;
  document.getElementById('trip-next').disabled = index >= stops().length - 1;
}

/** Opens a trip (or the home view, for null), sliding the page the way you moved (motion.js). */
function openTrip(id) {
  if (id === view.trip) return;
  const direction = stops().indexOf(id) > stops().indexOf(view.trip) ? 1 : -1;
  motion.monthTransition(direction, () => {
    view.trip = id;
    syncStepper();
    render();
  });
}

/**
 * The ‹ All trips › stepper in the top bar, which works like Overview's
 * month: the arrows step from the home view through the trips in date
 * order, the label opens the list, and ←/→ step when you're not typing.
 * The place cards and the ledger's rows open their trip too.
 */
function initTripStepper() {
  const select = document.getElementById('trip-select');
  const step = (delta) => {
    const index = stops().indexOf(view.trip) + delta;
    if (index >= 0 && index < stops().length) openTrip(stops()[index]);
  };

  select.addEventListener('change', () => openTrip(select.value || null));
  document.getElementById('trip-prev').addEventListener('click', () => step(-1));
  document.getElementById('trip-next').addEventListener('click', () => step(1));
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest('input, select, textarea, [contenteditable="true"], dialog[open]')) return;
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  });
  // Choosing a place card or a ledger row opens its trip at the top of the page.
  ['places', 'trips-ledger-body'].forEach((id) => document.getElementById(id).addEventListener('click', (event) => {
    const target = event.target.closest('[data-trip]');
    if (!target) return;
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: motion.reduced() ? 'auto' : 'smooth' });
    openTrip(target.dataset.trip);
  }));
  syncStepper();
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  // Straight away when this device has a copy of the data; otherwise after the auth check (data.js).
  const session = await pageSession;
  if (!session) return; // auth.js is already redirecting to login.html

  initUserMenu(session);
  initPageHeading(session);
  document.getElementById('signout-button').addEventListener('click', signOut);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  initTripStepper();
  initNewTrip();
  initDeleteTrip();
  initSubCategories();
  initBudgetEditing();

  try {
    // The trips (Supabase `trips`) and the transactions they're tagged from.
    const [rows] = await Promise.all([fetchTrips(), accountsReady]);
    TRIPS.push(...rows.map(fromRow));
    sortTrips();
    tagTransactions();
  } catch (error) {
    console.error('[Ledger] Failed to load trips:', error);
    if (error?.code || /trips/i.test(error?.message || '')) {
      // The transactions loaded but the trips table didn't (missing, or RLS): say why, and show no trips.
      showToast({ message: `Couldn’t load your trips. ${describeError(error)}`, tone: 'error' });
    } else {
      showLoadError(error);
      return;
    }
  }
  syncStepper();
  render();
  finishLoading();

  // The charts hold theme colours, so they redraw when light/dark changes (theme.js).
  document.addEventListener('ledger:theme-changed', render);
  // Drawn from this device's copy of the data: check for newer transactions, and re-tag when they arrive.
  document.addEventListener('ledger:data-changed', () => {
    tagTransactions();
    render();
  });
  if (dataStatus.fromCache) refreshData().catch((error) => console.error('[Ledger] Refresh failed:', error));
});
