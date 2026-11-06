/**
 * trips.js
 * ---------------------------------------------------------------------
 * Entry point for trips.html — the household's trips, from the Supabase
 * `trips` table (where and when), each with the spending that belongs
 * to it: every Holiday-category transaction dated within its dates
 * (tagTrips), counted under its Holiday sub-category (flights,
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
 * A trip also has its plan: every Holiday-tagged calendar event dated
 * within it, with its time, budget and sub-category. A trip's page opens
 * on its financial summary (Budget, Spent, Free to spend) and how the
 * budget is allocated, then the itinerary: Essentials (flights, stay,
 * parking) in a band of their own, then each day's events in time order
 * beside what's been spent. The budget is set part by part with sliders
 * on the "By part" tile (the `trips` table's part_budgets column), and
 * the trip's Budget is their sum, with what's booked standing in for a
 * booked flight or stay's estimate. A savings pot and local currency
 * (trip.pot, trip.fx) are drawn when a trip has them; trips from Supabase
 * don't yet.
 * ---------------------------------------------------------------------
 */

import { initPageHeading, initUserMenu, localDataCleared, signOut } from './auth.js';
import { budgetEditHeader, budgetSliders, endBudgetEditHeader, endBudgetSliders } from './budget-sliders.js';
import { fade, htmlTooltip } from './chart-kit.js';
import { categoryIcon } from './category-icons.js';
import { accountsReady, CALENDAR_EVENTS, pageSession, saveDataCache, TRANSACTIONS } from './data.js';
import { openDatePicker } from './datepicker.js';
import { cssVar, currency, currencyShort, escapeAttr, MINUS, moneyMarkup } from './format.js';
import { motion } from './motion.js';
import { finishLoading, people, showLoadError, spendOwnerColor } from './state.js';
import { refreshIfStale } from './sync.js';
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

/**
 * Parts booked ahead (no daily pace); the rest are spent day by day while
 * away. Their budget is only an estimate until they're booked: from the
 * first transaction on, what's booked is the budget (bookedBudget).
 */
const BOOKED_PARTS = new Set(['flights', 'stay']);

/**
 * Parts listed under "Essentials" above the days, rather than on the day
 * they're dated, so each day lists what was done and eaten that day. Their
 * budgets are set aside in full until the trip's over: money for a flight
 * not booked yet isn't free to spend.
 */
const ESSENTIAL_PARTS = new Set(['flights', 'stay', 'parking']);

/** The parts a trip's budget is set by: the sub-categories. */
const BUDGET_PARTS = HOLIDAY_SUB_CATEGORIES;

/** The category whose transactions and calendar events, dated within a trip, belong to it. */
const TRIP_CATEGORY = 'holiday';

/** A trip's part budgets from a row's part_budgets, as numbers in BUDGET_PARTS order (jsonb doesn't keep the order). */
const partBudgets = (stored) => Object.fromEntries(BUDGET_PARTS
  .filter((part) => Number(stored?.[part]) > 0)
  .map((part) => [part, Number(stored[part])]));

/** A row of the Supabase `trips` table as a trip: where and when, with its spending and events tagged in by tagTrips. */
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
    events: [],
  };
};

/** Every trip, earliest first. */
const TRIPS = [];
const sortTrips = () => TRIPS.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

// ---- This device's copy of the trips ------------------------------------
// The page draws from it straight away, then checks Supabase in the background.
const TRIPS_CACHE_KEY = 'ledger-trips'; // also cleared on sign-out (auth.js clearLocalData)

/** A trip as a row of the `trips` table: what fromRow reads. */
const toRow = (trip) => ({
  id: trip.dbId,
  location: trip.name,
  start_date: trip.start,
  end_date: trip.end,
  budget: trip.total,
  part_budgets: trip.budget,
});

/** The rows saved on this device, or null when there are none. */
function savedTripRows() {
  try {
    const rows = JSON.parse(localStorage.getItem(TRIPS_CACHE_KEY));
    return Array.isArray(rows) ? rows : null;
  } catch { return null; }
}

/** Saves the trips as they are now, unless signing out has just wiped this device's data. */
function saveTrips() {
  if (localDataCleared) return;
  try { localStorage.setItem(TRIPS_CACHE_KEY, JSON.stringify(TRIPS.map(toRow))); } catch { /* storage unavailable */ }
}

/** Replaces the trips with `rows` and tags their spending. */
function applyTripRows(rows) {
  TRIPS.splice(0, TRIPS.length, ...rows.map(fromRow));
  sortTrips();
  tagTrips();
}

/** Counts edits to the trips, so a background check can't overwrite one made while it was under way. */
let tripEdits = 0;

/** Checks Supabase for changes to the saved trips, and redraws only if there are any. */
async function refreshTrips() {
  const editsAtStart = tripEdits;
  let rows;
  try {
    rows = await fetchTrips();
  } catch (error) {
    console.error('[Ledger] Could not check for newer trips:', error); // the saved copy stays on show
    return;
  }
  if (tripEdits !== editsAtStart) return;
  const sameAs = (list) => JSON.stringify(list.map(fromRow));
  if (sameAs(rows) === sameAs(TRIPS.map(toRow))) return;
  applyTripRows(rows);
  saveTrips();
  if (!TRIPS.some((trip) => trip.id === view.trip)) view.trip = null; // the open trip was deleted elsewhere
  syncStepper();
  render();
}

/**
 * Gives every trip its spending: each Holiday transaction, not hidden,
 * dated from the trip's first day to its last, earliest first, counted
 * under its sub-category (or 'unsorted' until it has one). A
 * transaction's date is its manual_date when one is set, otherwise the
 * bank's date (supabase-client.js fetchTransactions). And its plan: each
 * Holiday calendar event in the same dates, in time order, an all-day
 * event first on its day. Run again whenever the trips, transactions or
 * events change.
 */
function tagTrips() {
  const tagged = Object.values(TRANSACTIONS).flat().filter((t) => !t.hidden && t.category === TRIP_CATEGORY);
  const events = CALENDAR_EVENTS.filter((e) => e.category === TRIP_CATEGORY);
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
    trip.events = events
      .filter((e) => e.date >= trip.start && e.date <= trip.end)
      .sort((x, y) => `${x.date} ${x.startTime || ''}`.localeCompare(`${y.date} ${y.startTime || ''}`))
      .map((e) => ({
        id: e.id,
        date: e.date,
        time: e.startTime,
        title: e.title,
        budget: e.budget,
        part: HOLIDAY_SUB_CATEGORIES.includes(e.subCategory) ? e.subCategory : 'unsorted',
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

/**
 * A trip's events with what's been spent against each: `paid`, from the
 * spending in its part (on its day, unless it's an essential, often paid
 * for on another day), the last event of those taking whatever's over; and
 * `left`, what's still held for it, so spending and plan aren't counted
 * twice. A finished event with spending against it holds nothing; one with
 * none holds its budget (the payment may not have come through) until the
 * trip's over. A flight or stay with spending against it is settled however
 * far off it is: it's booked, so nothing more is coming. A transaction or
 * event yet to be sorted is never paired up.
 */
function settleEvents(trip, status) {
  const pairing = (item) => (ESSENTIAL_PARTS.has(item.part) ? item.part : `${item.part} ${item.date}`);
  const unspent = {};
  const lastEvent = {};
  trip.txs.filter((t) => t.part !== 'unsorted').forEach((t) => { unspent[pairing(t)] = (unspent[pairing(t)] || 0) + t.amount; });
  trip.events.forEach((e) => { lastEvent[pairing(e)] = e; });
  return trip.events.map((e) => {
    const key = pairing(e);
    const available = e.part === 'unsorted' ? 0 : unspent[key] || 0;
    const paid = lastEvent[key] === e ? available : Math.min(e.budget, available);
    if (e.part !== 'unsorted') unspent[key] = available - paid;
    const finished = status === 'done' || ((e.date < TODAY || BOOKED_PARTS.has(e.part)) && paid > 0);
    return { ...e, paid, left: finished ? 0 : Math.max(0, e.budget - paid) };
  });
}

/**
 * The budget of a flight or stay that's been booked: what's booked, plus any
 * event in the part still to be paid for (a second hotel, say). Null while
 * it isn't booked, when its saved budget stands. `spending` is anything with
 * byPart and heldBy, like a trip's model.
 */
const bookedBudget = ({ byPart, heldBy }, part) => (BOOKED_PARTS.has(part) && byPart[part] > 0
  ? byPart[part] + (heldBy[part] || 0)
  : null);

/** The pot: paid into monthly from its start until the month of the trip (or this month). Null without one. */
function potModel(trip, budget) {
  if (!trip.pot) return null;
  const startMonth = monthIndex(trip.start.slice(0, 7));
  const nextMonth = monthIndex(TODAY.slice(0, 7)) + 1;
  const from = monthIndex(trip.pot.start);
  const months = Math.max(0, Math.min(nextMonth, startMonth) - from);
  const paydaysLeft = Math.max(0, startMonth - nextMonth);
  const saved = months * trip.pot.monthly;
  const toSave = Math.max(0, budget - saved);
  return {
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

/** Everything the page shows about one trip, worked out from its dates, tagged spending and events. */
function tripModel(trip) {
  const status = TODAY < trip.start ? 'saving' : TODAY > trip.end ? 'done' : 'away';
  const days = daysBetween(trip.start, trip.end) + 1;
  const day = status === 'away' ? daysBetween(trip.start, TODAY) + 1 : status === 'done' ? days : 0;
  const daysLeft = status === 'away' ? days - day + 1 : 0; // today included
  // The days whose spending to show: so far while away, otherwise all of them
  // (before a trip, anything dated within it is booked ahead for those days).
  const through = status === 'away' ? day : days;

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

  // The plan: what events are budgeted at by part, and what they still hold.
  const events = settleEvents(trip, status);
  const plannedBy = {};
  const heldBy = {};
  events.forEach((e) => {
    plannedBy[e.part] = (plannedBy[e.part] || 0) + e.budget;
    heldBy[e.part] = (heldBy[e.part] || 0) + e.left;
  });
  const held = sum(events.map((e) => e.left));

  // The budget in force: the saved parts, with what's booked standing in for a booked
  // part's estimate (which stays saved, so it comes back if the booking is re-filed).
  // A trip with no parts has only its total, or no budget at all, and keeps it.
  const hasParts = Object.keys(trip.budget).length > 0;
  const parts = hasParts ? Object.fromEntries(BUDGET_PARTS
    .map((part) => [part, bookedBudget({ byPart, heldBy }, part) ?? (trip.budget[part] || 0)])
    .filter(([, amount]) => amount > 0)) : {};
  const budget = hasParts ? sum(Object.values(parts)) : trip.total ?? 0;
  const pot = potModel(trip, budget);

  // Allocated: what's gone, what events hold, and each essential's budget, set aside until the trip's over.
  const essentialParts = [...ESSENTIAL_PARTS];
  const essentialsPaid = sum(essentialParts.map((p) => byPart[p] || 0));
  const essentialsHeld = sum(essentialParts.map((p) => heldBy[p] || 0));
  const essentialsAside = status === 'done' ? 0 : sum(essentialParts.map((p) => Math.max((parts[p] || 0) - (byPart[p] || 0), heldBy[p] || 0)));
  const allocated = spent + held - essentialsHeld + essentialsAside;
  const free = budget - allocated;
  const daysToSpend = status === 'away' ? daysLeft : days; // over the whole trip before it, what's left of it while away
  const freePerDay = status !== 'done' && free > 0 ? free / daysToSpend : 0;

  return {
    trip, status, days, day, daysLeft, through, budget, parts, spent, byPart, booked, dailyParts, dailyBudget, dailySpent, paid, pot,
    events, plannedBy, heldBy, held, essentialsPaid, essentialsAside, allocated, free, daysToSpend, freePerDay,
  };
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
 * Free to spend once everything's allocated (renderAllocation), and Each
 * (who paid, and who owes whom). With no budget set, Budget and Free to
 * spend show "Not set" and "—" in a quieter ink; with nothing tagged yet,
 * Spent and Each do.
 */
function renderStats(m) {
  const { trip, status } = m;
  const grid = document.getElementById('trip-stats');
  document.getElementById('trip-hero-eyebrow').textContent = 'Financial summary';
  const everyone = people();
  const unsorted = trip.txs.filter((t) => t.part === 'unsorted').length;
  const perDay = m.through ? m.spent / m.through : 0;
  const over = m.budget > 0 && m.free < 0;

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

  let freeTile;
  if (!m.budget) {
    freeTile = smallTile({ label: 'Free to spend', value: '—', valueClass: ' stat-tile__value--text', note: 'Set a budget to track it', foot: tileFoot('Per day', '—') });
  } else if (over) {
    const overSpent = m.allocated === m.spent; // nothing's still to come: it's already gone
    freeTile = smallTile({
      label: overSpent ? 'Over budget' : 'Over-allocated',
      value: moneyMarkup(currencyShort(-m.free)),
      valueClass: ' is-negative',
      note: overSpent ? `${Math.round((m.spent / m.budget) * 100)}% of the budget spent` : `${currencyShort(m.allocated)} allocated of ${currencyShort(m.budget)}`,
      tone: 'is-negative',
      foot: tileFoot('Per day over', currencyShort(-m.free / m.days), 'is-negative'),
    });
  } else {
    const footByStatus = {
      saving: tileFoot('Per day', currencyShort(m.freePerDay)),
      away: tileFoot(`Per day, last ${plural(m.daysLeft, 'day')}`, currencyShort(m.freePerDay)),
      done: tileFoot('Came in under by', currencyShort(m.free), 'is-positive'),
    };
    freeTile = smallTile({
      label: status === 'done' ? 'Remaining' : 'Free to spend',
      value: moneyMarkup(currencyShort(m.free)),
      note: { saving: `after ${currencyShort(m.allocated)} allocated`, away: `after ${currencyShort(m.allocated)} allocated`, done: 'under budget' }[status],
      tone: status === 'done' ? 'is-positive' : '',
      foot: footByStatus[status],
    });
  }

  grid.className = 'stats-grid stats-grid--quad';
  grid.innerHTML = [budgetTile, spentTile, freeTile, peopleTile(m)].join('');
  const tiles = grid.children;
  tiles[0].classList.add('budget-tile');
  tiles[0].classList.toggle('is-empty', !m.budget);
  tiles[1].classList.toggle('is-empty', !trip.txs.length);
  tiles[2].classList.toggle('is-empty', !m.budget);
  tiles[3].classList.toggle('is-empty', !trip.txs.length);
}

/** What each part needs to cover its events and spending, keeping any budget that's already more. */
const budgetsToCover = (m) => Object.fromEntries(BUDGET_PARTS
  .map((part) => [part, bookedBudget(m, part) ?? Math.max(m.trip.budget[part] || 0, m.plannedBy[part] || 0, m.byPart[part] || 0)])
  .filter(([, amount]) => amount > 0));

/** One slice of the allocation bar: `planned` slices are hatched, money not gone yet. */
const allocationSlice = (amount, scale, color, planned = false) => (amount > 0
  ? `<i class="allocation__slice${planned ? ' is-planned' : ''}" style="--slice:var(${color}); width:${(amount / scale) * 100}%"></i>`
  : '');

/**
 * How the budget is allocated, as one bar with its key beneath: Essentials
 * (paid, and set aside), what's been spent on the days, what the days'
 * events still hold, and the rest, free to spend. Past the budget the bar
 * runs on past a mark at the budget line and the last column turns rose.
 * With no budget yet, it offers to set one from the events.
 */
function renderAllocation(m) {
  const daysSpent = m.spent - m.essentialsPaid;
  const daysHeld = m.allocated - m.essentialsPaid - m.essentialsAside - daysSpent;
  const essentials = m.essentialsPaid + m.essentialsAside;
  const scale = Math.max(m.budget, m.allocated) || 1;
  const eventsUnpaid = m.events.filter((e) => !ESSENTIAL_PARTS.has(e.part) && e.left > 0).length;
  const noBudget = m.events.filter((e) => !e.budget).length;
  const done = m.status === 'done';

  const bar = document.getElementById('allocation-bar');
  bar.innerHTML = `
    <span class="allocation__track">
      ${allocationSlice(m.essentialsPaid, scale, '--forecast-fixed')}
      ${allocationSlice(m.essentialsAside, scale, '--forecast-fixed', true)}
      ${allocationSlice(daysSpent, scale, '--forecast-spent')}
      ${allocationSlice(daysHeld, scale, '--cat-holiday', true)}
      ${m.budget ? allocationSlice(m.free, scale, '--forecast-projected') : ''}
    </span>
    ${m.budget && m.free < 0 ? `<span class="allocation__limit" style="left:${(m.budget / scale) * 100}%"></span>` : ''}`;
  bar.setAttribute('aria-label', `${currency(m.allocated)} allocated${m.budget ? ` of ${currency(m.budget)}` : ''}: essentials ${currency(essentials)}, spent ${currency(daysSpent)}, planned ${currency(daysHeld)}`);

  const keyItem = ({ label, swatch, figure, note, tone = '' }) => `
    <li class="allocation__item ${tone}">
      <span class="allocation__label"><i class="allocation__swatch ${swatch}"></i>${label}</span>
      <span class="allocation__figure">${figure}</span>
      <span class="allocation__note">${note}</span>
    </li>`;
  const freeItem = () => {
    if (!m.budget) return { label: 'Free to spend', figure: '—', note: 'Needs a budget', tone: 'is-quiet' };
    if (m.free < 0) return { label: done ? 'Over budget' : 'Over-allocated', figure: currencyShort(-m.free), note: done ? 'Spent past the budget' : 'Trim a plan or raise the budget', tone: 'is-over' };
    if (done) return { label: 'Left over', figure: currencyShort(m.free), note: 'Came in under budget' };
    return { label: 'Free to spend', figure: currencyShort(m.free), note: m.free ? `About ${currencyShort(m.freePerDay)} a day · ${plural(m.daysToSpend, 'day')}${m.status === 'away' ? ' left' : ''}` : 'Everything’s allocated' };
  };
  document.getElementById('allocation-key').innerHTML = [
    keyItem({
      label: 'Essentials',
      swatch: 'is-essentials',
      figure: currencyShort(essentials),
      note: done || !m.essentialsAside
        ? `${currencyShort(m.essentialsPaid)} paid`
        : `${currencyShort(m.essentialsPaid)} paid · ${currencyShort(m.essentialsAside)} set aside`,
    }),
    keyItem({
      label: 'Spent on the days',
      swatch: 'is-spent',
      figure: currencyShort(daysSpent),
      note: plural(m.trip.txs.filter((t) => !ESSENTIAL_PARTS.has(t.part)).length, 'transaction'),
    }),
    keyItem({
      label: 'Planned on the days',
      swatch: 'is-planned',
      figure: currencyShort(daysHeld),
      note: eventsUnpaid ? `${plural(eventsUnpaid, 'event')} not paid yet` : 'Nothing still to pay',
    }),
    keyItem({ swatch: 'is-free', ...freeItem() }),
  ].join('');

  document.getElementById('allocation-meta').textContent = m.budget
    ? `${currencyShort(m.allocated)} of ${currencyShort(m.budget)} allocated`
    : m.allocated ? `${currencyShort(m.allocated)} allocated` : '';

  const toCover = sum(Object.values(budgetsToCover(m)));
  const lines = [
    !m.budget && toCover ? `Your plan comes to ${currencyShort(toCover)}. <button type="button" class="tile-link" data-budget-from-events>Use it as the budget</button>` : '',
    !m.budget && !toCover ? '<button type="button" class="tile-link" data-edit-budget>Set a budget</button> to see what’s free to spend.' : '',
    noBudget ? `${plural(noBudget, 'event')} ${noBudget === 1 ? 'has' : 'have'} no budget yet, so ${noBudget === 1 ? 'it isn’t' : 'they aren’t'} counted.` : '',
    m.events.length && m.spent && !done ? 'Spending in the same part on the same day counts against an event’s plan, so nothing’s counted twice.' : '',
  ].filter(Boolean);
  const foot = document.getElementById('allocation-foot');
  foot.hidden = !lines.length;
  foot.innerHTML = lines.join(' ');
}

/**
 * Editing the budget, part by part, in place on the "By part" tile: its
 * pencil (or the Budget tile's, or "Set a budget") turns every part's bar
 * into a gauge with a knob to drag and its amount to type
 * (budget-sliders.js), and the tile's header shows the total adding up
 * with Cancel and Save. Save (or Enter) updates the page straight away
 * and the `trips` table behind it, with Undo; Cancel or Escape leaves it
 * as it was. Nothing is saved while sliding. A booked flight or stay can't
 * be dragged, its budget being what's booked; saving leaves its estimate as
 * it was, for if the booking is re-filed.
 */
function initBudgetEditing() {
  const detail = document.getElementById('trip-detail');
  const section = document.querySelector('.trip-parts');
  const list = document.getElementById('trip-budget');
  let trip = null;
  let sliders = null;

  const save = () => {
    const m = tripModel(trip);
    const amounts = sliders.values();
    setBudgets(trip, Object.fromEntries(BUDGET_PARTS
      .map((part) => [part, bookedBudget(m, part) === null ? amounts[part] : trip.budget[part] || 0])
      .filter(([, amount]) => amount > 0)));
  };

  const open = () => {
    trip = TRIPS.find((t) => t.id === view.trip);
    if (!trip) return;
    tripEdits += 1; // a redraw from a background check would close the editor
    const m = tripModel(trip);
    const totalOnly = trip.total && !Object.keys(trip.budget).length;
    const short = BUDGET_PARTS.some((part) => bookedBudget(m, part) === null && (m.plannedBy[part] || 0) > (trip.budget[part] || 0));
    const showTotal = budgetEditHeader(section, `${totalOnly
      ? `Was ${currencyShort(trip.total)} overall — split it across the parts`
      : 'Drag each part, or type an amount. The trip’s budget is their total.'}${short ? ' <button type="button" class="tile-link" data-cover-events>Raise parts to cover your events</button>' : ''}`);
    sliders = budgetSliders(list, BUDGET_PARTS.map((part) => ({
      key: part,
      label: PARTS[part].label,
      icon: PARTS[part].icon,
      color: PARTS[part].color,
      value: bookedBudget(m, part) ?? (trip.budget[part] || 0),
      spent: m.byPart[part] || 0,
      planned: m.heldBy[part] || 0,
      locked: bookedBudget(m, part) !== null,
    })), { minReach: 2000, onInput: showTotal, onSubmit: save, onCancel: render });
    showTotal(sum(Object.values(sliders.values())));
    section.scrollIntoView({ behavior: motion.reduced() ? 'auto' : 'smooth', block: 'nearest' });
    list.querySelector('input[type="range"]:not(:disabled)').focus({ preventScroll: true });
  };

  detail.addEventListener('click', (event) => {
    if (event.target.closest('[data-edit-budget]')) open();
    else if (event.target.closest('[data-cancel-budget]')) render();
    else if (event.target.closest('[data-save-budget]')) save();
    else if (event.target.closest('[data-cover-events]')) sliders.set(budgetsToCover(tripModel(trip)));
    else if (event.target.closest('[data-budget-from-events]')) {
      const current = TRIPS.find((t) => t.id === view.trip);
      setBudgets(current, budgetsToCover(tripModel(current)));
    }
  });
}

/** Ends an edit of the parts (render() redraws the bars in its place). */
function closeBudgetEditing() {
  endBudgetSliders(document.getElementById('trip-budget'));
  endBudgetEditHeader(document.querySelector('.trip-parts'));
}

/** Sets a trip's part budgets on the page and in Supabase, with Undo; puts them back if the save fails. */
function setBudgets(trip, next) {
  tripEdits += 1;
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
    message: nextTotal === null ? `Removed the budget for ${trip.name}` : `Budget for ${trip.name} set to ${currencyShort(tripModel(trip).budget)}`,
    action: {
      label: 'Undo',
      onClick: async () => {
        apply(previous);
        try {
          await saving.catch(() => {}); // nothing to undo server-side if the save itself failed
          await updateTripBudgets(trip.dbId, previous.parts, previous.total);
          saveTrips();
          showToast({ message: 'Change undone', tone: 'info', duration: 2500 });
        } catch (error) {
          console.error('[Ledger] Could not undo the budget:', error);
          apply({ parts: next, total: nextTotal });
          showToast({ message: 'Couldn’t undo — the change was kept', tone: 'error' });
        }
      },
    },
  });
  saving.then(saveTrips, (error) => {
    console.error('[Ledger] Could not save the budget:', error);
    apply(previous);
    showToast({ message: `Couldn’t save the budget — it’s been put back. ${describeError(error)}`, tone: 'error' });
  });
}

// ============================================================
// THE PLAN
// ============================================================

/**
 * The budget's parts as bars, like Overview's Budget vs Actual (with the
 * part's icon): what's spent in the part's colour, what its events still
 * hold hatched after it, and past the budget, rose stripes.
 */
function renderBudget(m) {
  const { trip, status } = m;
  const list = document.getElementById('trip-budget');
  list.classList.add('is-entering');
  if (!Object.keys(m.parts).length) { renderUnbudgeted(m, list); return; }
  const pace = status === 'away' ? m.day / m.days : 0;

  list.innerHTML = Object.entries(m.parts).map(([part, budget], i) => {
    const info = PARTS[part];
    const actual = m.byPart[part] || 0;
    const held = m.heldBy[part] || 0;
    const allocated = actual + held;
    const essential = ESSENTIAL_PARTS.has(part);
    const isBooked = bookedBudget(m, part) !== null;
    const percentage = Math.round((allocated / budget) * 100);
    const over = allocated > budget;
    const showPace = status === 'away' && !essential && !over;
    const paceAmount = budget * pace;
    const ahead = showPace && actual > paceAmount;

    const scale = Math.max(budget, allocated);
    const fillWidth = (Math.min(actual, budget) / scale) * 100;
    const planWidth = (Math.min(held, Math.max(0, budget - actual)) / scale) * 100;
    const limitAt = (budget / scale) * 100;
    const unspent = budget - allocated;

    const so = [actual ? `${currencyShort(actual)} ${isBooked ? 'booked' : essential ? 'paid' : 'spent'}` : '', held ? `${currencyShort(held)} planned` : ''];
    let rest = `${currencyShort(unspent)} ${essential ? 'to book' : 'free'}`;
    let tone = '';
    if (isBooked) rest = ''; // its budget is what's booked: nothing's over, under or left to say
    else if (over) { rest = `${currencyShort(-unspent)} more than the budget`; tone = 'is-negative'; }
    else if (status === 'done') { rest = unspent >= 1 ? `${currencyShort(unspent)} unspent` : 'On budget'; tone = 'is-positive'; }
    else if (unspent < 1) rest = essential && !held ? 'Paid' : 'All allocated';
    else if (status === 'away' && !essential) rest += ` · ${currencyShort(unspent / m.daysLeft)}/day left`;
    if (ahead) { rest = `${currencyShort(actual - paceAmount)} ahead of pace · ${rest}`; tone = 'is-ahead'; }
    const note = [...so, rest].filter(Boolean).join(' · ');

    return `
      <li class="budget-item${over ? ' is-over' : ''}${ahead ? ' is-ahead' : ''}" style="--i:${i}">
        <div class="budget-item__header">
          <span class="budget-item__category trip-part" style="--avatar-color:${info.color}">
            <span class="trip-part__icon" aria-hidden="true">${categoryIcon(info.icon)}</span>${info.label}
          </span>
          <span class="budget-item__summary">
            <span class="budget-item__amounts">${currencyShort(allocated)} of ${currencyShort(budget)}</span>
            <span class="budget-item__status">${over ? `${currencyShort(-unspent)} over` : `${percentage}%`}</span>
          </span>
        </div>
        <div class="budget-item__bar" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="${Math.max(100, percentage)}" aria-label="${info.label}: ${currencyShort(actual)} spent and ${currencyShort(held)} planned of ${currencyShort(budget)}">
          <span class="budget-item__track">
            <span class="budget-item__fill" style="width:${fillWidth}%; background:${info.color}"></span>
            ${planWidth ? `<span class="budget-item__plan" style="left:${fillWidth}%; width:${planWidth}%; --plan:${info.color}"></span>` : ''}
            ${over ? `<span class="budget-item__overflow" style="left:${limitAt}%; width:${100 - limitAt}%"></span>` : ''}
          </span>
          ${over ? `<span class="budget-item__limit" style="left:${limitAt}%"></span>` : ''}
          ${showPace ? `<span class="budget-item__pace" style="left:${(paceAmount / scale) * 100}%" title="Pace for day ${m.day}: ${currencyShort(paceAmount)}"></span>` : ''}
        </div>
        <p class="budget-item__note ${tone}">${note}</p>
      </li>`;
  }).join('') + Object.keys(PARTS) // then the parts with spending or events but no budget (and what's still to sort)
    .filter((part) => !m.parts[part] && (m.byPart[part] || m.heldBy[part]))
    .map((part, i) => unbudgetedRow(m, part, Object.keys(m.parts).length + i))
    .join('');

  document.getElementById('trip-budget-meta').textContent = {
    saving: `${currencyShort(m.spent + m.held)} spent and planned`,
    away: `Day ${m.day} of ${m.days}`,
    done: `${currencyShort(m.spent)} of ${currencyShort(m.budget)}`,
  }[status];
}

/** A part without a budget: what it's spent and has planned, its bar as its share of the trip. */
function unbudgetedRow(m, part, i) {
  const info = PARTS[part];
  const actual = m.byPart[part] || 0;
  const held = m.heldBy[part] || 0;
  const whole = m.spent + m.held;
  const share = (amount) => (whole ? (amount / whole) * 100 : 0);
  const percent = Math.round(share(actual + held));
  const details = [actual ? `${currencyShort(actual)} spent` : '', held ? `${currencyShort(held)} planned` : ''].filter(Boolean).join(' · ');
  const sortHint = m.trip.txs.some((t) => t.part === 'unsorted') ? 'choose what each was for, above' : 'give each a sub-category in its calendar description';
  return `
    <li class="budget-item${actual || held ? '' : ' is-empty'}" style="--i:${i}">
      <div class="budget-item__header">
        <span class="budget-item__category trip-part" style="--avatar-color:${info.color}">
          <span class="trip-part__icon" aria-hidden="true">${categoryIcon(info.icon)}</span>${info.label}
        </span>
        <span class="budget-item__summary">
          <span class="budget-item__amounts">${actual || held ? currencyShort(actual + held) : `${currencyShort(0)} of —`}</span>
          <span class="budget-item__status">${actual || held ? `${percent}%` : '—'}</span>
        </span>
      </div>
      <div class="budget-item__bar" aria-label="${info.label}: ${currencyShort(actual)} spent and ${currencyShort(held)} planned, no budget set">
        <span class="budget-item__track">
          ${actual ? `<span class="budget-item__fill" style="width:${share(actual)}%; background:${info.color}"></span>` : ''}
          ${held ? `<span class="budget-item__plan" style="left:${share(actual)}%; width:${share(held)}%; --plan:${info.color}"></span>` : ''}
        </span>
      </div>
      <p class="budget-item__note${part === 'unsorted' ? ' is-ahead' : ''}">${part === 'unsorted' ? `${details} · ${sortHint}` : details ? `${details} · no budget` : BOOKED_PARTS.has(part) ? 'Not booked yet' : 'Nothing yet'}</p>
    </li>`;
}

/**
 * Budget by part with no budget set yet: each part with spending or
 * events, its bar as its share of the trip, then the parts still waiting
 * for a budget.
 */
function renderUnbudgeted(m, list) {
  const activeParts = Object.keys(PARTS).filter((p) => m.byPart[p] || m.heldBy[p]);
  list.innerHTML = [
    ...activeParts.map((p, i) => unbudgetedRow(m, p, i)),
    ...BUDGET_PARTS.filter((p) => !activeParts.includes(p)).map((p, i) => unbudgetedRow(m, p, activeParts.length + i)),
  ].join('');
  document.getElementById('trip-budget-meta').textContent = m.spent + m.held ? `${currencyShort(m.spent + m.held)} in all` : '';
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

/**
 * A calendar event: its time (and its date, in Essentials), a hollow ring
 * in its part's colour — it's a plan, where spending is a filled disc — its
 * title, and the budget it's been given, with what's been spent against it
 * (on a day; Essentials total theirs at the head of the column).
 */
function eventRow(m, e, { withDate = false } = {}) {
  const info = PARTS[e.part];
  const past = e.date < TODAY || m.status === 'done';
  let state = '';
  if (e.paid) state = `<span class="trip-event__paid">${currencyShort(e.paid)} spent</span>`;
  else if (past && e.budget) state = m.status === 'done' ? 'No spending matched' : 'No spending matched yet';
  const part = e.part === 'unsorted' ? 'No sub-category' : info.label;
  // In Essentials the column names the part and totals what's paid, so a row only says it's a plan.
  const meta = withDate ? 'Planned' : `${part}${state ? ` · ${state}` : ''}`;
  return `
    <li class="trip-event">
      <span class="trip-event__time">
        ${withDate ? `<span class="trip-event__day">${shortDate(e.date)}</span>` : ''}
        ${e.time || 'All day'}
      </span>
      <span class="trip-event__ring" style="--avatar-color:${info.color}" aria-hidden="true">${categoryIcon(info.icon)}</span>
      <span class="trip-tx__main">
        <span class="trip-tx__merchant">${escapeAttr(e.title)}</span>
        <span class="trip-tx__meta">${meta}</span>
      </span>
      <span class="trip-event__budget${e.budget ? '' : ' is-unset'}">${e.budget ? currencyShort(e.budget) : 'No budget'}</span>
    </li>`;
}

/** One side of a day: "Planned" or "Spent", its total, and its rows. */
const dayColumn = ({ label, total, rows, kind, quiet = false }) => `
  <div class="itinerary-day__col is-${kind}${quiet ? ' is-quiet' : ''}">
    <p class="itinerary-day__label"><span>${label}</span>${total ? `<b>${currencyShort(total)}</b>` : ''}</p>
    <ul class="itinerary-day__list">${rows}</ul>
  </div>`;

/** A line in a day with nothing on it ("Nothing planned", "Nothing spent"). */
const quietRow = (text) => `<li class="itinerary-day__quiet">${text}</li>`;

/**
 * One day of the itinerary: its number in the serif, its date and what's
 * free for it, then what's planned, in time order, beside what's been spent.
 */
function dayRow(m, d, i) {
  const essential = (item) => ESSENTIAL_PARTS.has(item.part);
  const events = m.events.filter((e) => e.date === d.iso && !essential(e));
  const txs = d.txs.filter((t) => !essential(t));
  const today = d.iso === TODAY;
  const toCome = m.status === 'saving' || d.iso > TODAY;
  return `
    <li class="itinerary-day${today ? ' is-today' : ''}" style="--i:${i}">
      <div class="itinerary-day__rail">
        <span class="itinerary-day__title">Day ${i + 1}</span>
        <p class="itinerary-day__date">${dayLabel(d.iso)}${today ? '<span class="ledger-table__flag">Today</span>' : ''}</p>
        ${m.freePerDay && (toCome || today) ? `<p class="itinerary-day__free">About ${currencyShort(m.freePerDay)} free</p>` : ''}
      </div>
      ${dayColumn({
        kind: 'planned',
        label: 'Planned',
        total: sum(events.map((e) => e.budget)),
        rows: events.map((e) => eventRow(m, e)).join('') || quietRow('Nothing planned'),
      })}
      ${dayColumn({
        kind: 'spent',
        label: 'Spent',
        total: sum(txs.map((t) => t.amount)),
        rows: txs.map((t) => txRow(m, t)).join('') || quietRow(toCome ? 'Nothing yet' : 'Nothing spent'),
        quiet: toCome && !txs.length,
      })}
    </li>`;
}

/** A band across the itinerary above the days, for what was booked before the trip. */
function itineraryStrip({ title, total, rows }) {
  return `
    <div class="itinerary-strip">
      <div class="itinerary-strip__head">
        <span class="itinerary-strip__title">${title}</span>
        <span class="itinerary-strip__total">${currencyShort(total)}</span>
      </div>
      <ul class="itinerary-strip__list">${rows}</ul>
    </div>`;
}

/**
 * Essentials, as a band above the days: a column for each of flights, stay
 * and parking with a budget, an event or spending, listing its events
 * (dated, in time order) and then what's been paid.
 */
function essentialsBand(m) {
  const { trip } = m;
  const parts = [...ESSENTIAL_PARTS].filter((p) => m.parts[p] || m.byPart[p] || m.events.some((e) => e.part === p));
  if (!parts.length) return '';
  const columns = parts.map((part) => {
    const info = PARTS[part];
    const paid = m.byPart[part] || 0;
    const budget = m.parts[part] || 0;
    const events = m.events.filter((e) => e.part === part);
    const txs = trip.txs.filter((t) => t.part === part && t.date >= trip.start);
    const planned = m.plannedBy[part] || 0;
    const ofBudget = budget ? ` of ${currencyShort(budget)}` : '';
    let figure = budget ? `${currencyShort(budget)} set aside` : '';
    if (bookedBudget(m, part) !== null) figure = `${currencyShort(paid)} booked`;
    else if (paid) figure = `${currencyShort(paid)} paid${ofBudget}`;
    else if (planned) figure = `${currencyShort(planned)} planned${ofBudget}`;
    return `
      <div class="essential">
        <p class="essential__head">
          <span class="trip-part" style="--avatar-color:${info.color}"><span class="trip-part__icon" aria-hidden="true">${categoryIcon(info.icon)}</span>${info.label}</span>
          <span class="essential__figure">${figure}</span>
        </p>
        <ul class="essential__list">
          ${events.map((e) => eventRow(m, e, { withDate: true })).join('')}
          ${txs.map((t) => txRow(m, t, { withDate: true })).join('')}
          ${events.length || txs.length ? '' : quietRow(m.status === 'done' ? 'Nothing paid' : 'Nothing booked yet')}
        </ul>
      </div>`;
  }).join('');
  return `
    <div class="itinerary-strip itinerary-strip--essentials">
      <div class="itinerary-strip__head">
        <span class="itinerary-strip__title">Essentials</span>
        <span class="itinerary-strip__sub">Flights, stay and parking, kept out of the days</span>
        <span class="itinerary-strip__total">${currencyShort(m.essentialsPaid + m.essentialsAside)}</span>
      </div>
      <div class="itinerary-strip__parts">${columns}</div>
    </div>`;
}

/**
 * The itinerary: Essentials (flights, stay, parking) first as a band of
 * their own, then every day of the trip: its events in time order beside
 * what's been spent, today picked out in gold.
 */
function renderItinerary(m) {
  const { trip } = m;
  const before = trip.txs.filter((t) => t.date < trip.start);
  document.getElementById('itinerary-strips').innerHTML = [
    before.length ? itineraryStrip({
      title: m.status === 'saving' ? 'Booked so far' : 'Booked before you went',
      total: sum(before.map((t) => t.amount)),
      rows: before.map((t) => txRow(m, t, { withDate: true })).join(''),
    }) : '',
    essentialsBand(m),
  ].join('');
  document.getElementById('trip-days').innerHTML = tripDays(m).map((d, i) => dayRow(m, d, i)).join('');
  document.getElementById('itinerary-sub').textContent = `${dateRange(trip)} · ${plural(m.days, 'day')}`;
  document.getElementById('itinerary-meta').textContent = `${plural(trip.events.length, 'event')} · ${plural(trip.txs.length, 'transaction')}${trip.fx ? ` · ${trip.fx.symbol}${trip.fx.rate} to the pound` : ''}`;
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
    tagTrips();
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
    tripEdits += 1;
    try {
      const trip = fromRow(await createTrip({ location: name, startDate: from, endDate: to }));
      TRIPS.push(trip);
      sortTrips();
      tagTrips();
      saveTrips();
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
    tripEdits += 1;
    try {
      await deleteTrip(trip.dbId);
      TRIPS.splice(TRIPS.indexOf(trip), 1);
      saveTrips();
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

  // A trip with nothing tagged yet draws the same widgets, empty.
  closeBudgetEditing();
  renderToSort(m);
  renderStats(m);
  renderAllocation(m);
  renderBudget(m);
  renderItinerary(m);
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

  // The trips (Supabase `trips`) and the transactions they're tagged from: this
  // device's copy of the trips straight away, otherwise they're waited for.
  const saved = savedTripRows();
  try {
    if (saved) {
      await accountsReady;
      applyTripRows(saved);
    } else {
      const [rows] = await Promise.all([fetchTrips(), accountsReady]);
      applyTripRows(rows);
      saveTrips();
    }
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
    tagTrips();
    render();
  });
  refreshIfStale();
  if (saved) refreshTrips();
});
