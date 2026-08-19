/**
 * mock-data.js
 * ---------------------------------------------------------------------
 * Stand-in for your FastAPI backend. Everything here is shaped the way
 * the real API responses will eventually look, so swapping this out
 * for `fetch()` calls later should be mostly mechanical:
 *
 *   CATEGORIES              -> GET /api/categories
 *   ACCOUNT_GROUPS           -> GET /api/accounts (grouped by owner)
 *   TRANSACTIONS             -> GET /api/transactions?month=YYYY-MM
 *
 * A tiny seeded PRNG is used instead of Math.random() so the demo
 * data looks the same on every reload. Each transaction now also
 * carries `excluded` (bool) for the exclude-from-totals checkbox —
 * merchant/category/amount are all editable in place from the table.
 * ---------------------------------------------------------------------
 */

// ---- Categories (id, label, CSS var for color) -------------------------
const CATEGORIES = [
  { id: 'groceries',     label: 'Groceries',      color: 'var(--cat-groceries)' },
  { id: 'dining',        label: 'Dining Out',      color: 'var(--cat-dining)' },
  { id: 'transport',     label: 'Transport',       color: 'var(--cat-transport)' },
  { id: 'holiday',       label: 'Holiday',       color: 'var(--cat-holiday)' },
  { id: 'housing',       label: 'Housing',         color: 'var(--cat-housing)' },
  { id: 'subscriptions', label: 'Subscriptions',   color: 'var(--cat-subscriptions)' },
  { id: 'shopping',      label: 'Shopping',        color: 'var(--cat-shopping)' },
  { id: 'health',        label: 'Health',          color: 'var(--cat-health)' },
  { id: 'travel',        label: 'Travel',          color: 'var(--cat-travel)' },
  { id: 'other',         label: 'Unassigned',   color: 'var(--cat-other)' },
];

// ---- Accounts, grouped by owner --------------------------------------
let ACCOUNT_GROUPS = [];
let ACCOUNTS = [];

function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      field += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(field.trim());
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field.trim());
  return fields;
}

async function loadAccounts() {
  const response = await fetch('../data/accounts/accounts.csv');
  if (!response.ok) throw new Error(`Could not load accounts.csv (${response.status})`);

  const lines = (await response.text()).trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  const rows = lines.filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
  const groups = new Map();

  rows.forEach((row) => {
    const groupId = row.user.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, label: row.user, accounts: [] });
    groups.get(groupId).accounts.push({
      id: row.account_id,
      label: `${row.account_name} (${row.account_id})`,
    });
  });

  ACCOUNT_GROUPS = [...groups.values()];
  ACCOUNTS = ACCOUNT_GROUPS.flatMap((group) =>
    group.accounts.map((account) => ({ ...account, groupId: group.id, groupLabel: group.label }))
  );
}

// Roughly how likely a transaction in each category is to come out of
// each owner's accounts — housing/utilities skew joint, personal
// categories skew mine/wife.
const GROUP_WEIGHTS = {
  groceries:     { mine: 0.30, wife: 0.30, joint: 0.40 },
  dining:        { mine: 0.35, wife: 0.35, joint: 0.30 },
  transport:     { mine: 0.45, wife: 0.45, joint: 0.10 },
  utilities:     { mine: 0.10, wife: 0.10, joint: 0.80 },
  housing:       { mine: 0.05, wife: 0.05, joint: 0.90 },
  subscriptions: { mine: 0.30, wife: 0.30, joint: 0.40 },
  shopping:      { mine: 0.40, wife: 0.40, joint: 0.20 },
  health:        { mine: 0.45, wife: 0.45, joint: 0.10 },
  travel:        { mine: 0.15, wife: 0.15, joint: 0.70 },
  other:         { mine: 0.10, wife: 0.10, joint: 0.80 },
};

// Within a chosen owner, how likely each of their accounts is to be the
// one used (current account most common, then credit card, then savings).
const LEAF_WEIGHTS = {
  mine:  [0.60, 0.15, 0.25],  // current, savings, credit
  wife:  [0.60, 0.15, 0.25],
  joint: [0.75, 0.25],        // current, savings
};

function weightedPick(weightEntries, rnd) {
  const roll = rnd();
  let acc = 0;
  for (const [id, w] of weightEntries) {
    acc += w;
    if (roll <= acc) return id;
  }
  return weightEntries[weightEntries.length - 1][0];
}

function pickAccount(categoryId, rnd) {
  const availableGroups = ACCOUNT_GROUPS.map((group) => group.id);
  const weightedGroups = Object.entries(GROUP_WEIGHTS[categoryId])
    .filter(([groupId]) => availableGroups.includes(groupId));
  const groupId = weightedPick(
    weightedGroups.length ? weightedGroups : availableGroups.map((id) => [id, 1]),
    rnd
  );
  const group = ACCOUNT_GROUPS.find((g) => g.id === groupId);
  const leafWeights = group.accounts.map((_, index) => index === 0 ? 0.6 : 0.4 / (group.accounts.length - 1));
  const entries = group.accounts.map((a, i) => [a.id, leafWeights[i]]);
  return weightedPick(entries, rnd);
}

const MERCHANTS = {
  groceries:     ['Tesco', "Sainsbury's", 'Waitrose', 'Aldi', 'Local Farm Shop'],
  dining:        ['Deliveroo', 'Costa Coffee', 'Pret A Manger', 'The Green Table', 'Nando\u2019s'],
  transport:     ['TfL Travel', 'Uber', 'Trainline', 'Shell Petrol'],
  utilities:     ['British Gas', 'Thames Water', 'EE Mobile', 'Octopus Energy'],
  housing:       ['Mortgage Payment', 'Home Insurance', 'B&Q'],
  subscriptions: ['Netflix', 'Spotify', 'iCloud Storage', 'Amazon Prime'],
  shopping:      ['Amazon', 'John Lewis', 'Zara', 'IKEA'],
  health:        ['Boots Pharmacy', 'Pure Gym', 'Local Dental Practice'],
  travel:        ['EasyJet', 'Airbnb', 'Booking.com'],
  other:         ['Wedding Photographer', 'Card Transfer \u2014 Joint', 'John Lewis Gift List', 'M&S'],
};

// ---- Seeded PRNG (mulberry32) so demo numbers are stable ----------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260818);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const range = (min, max) => min + rand() * (max - min);

// Typical spend ranges per category (£)
const AMOUNT_RANGE = {
  groceries: [12, 85], dining: [8, 55], transport: [3, 60],
  utilities: [30, 140], housing: [80, 950], subscriptions: [5, 18],
  shopping: [15, 220], health: [10, 90], travel: [60, 480], other: [20, 600],
};

// Roughly how many transactions/month per category
const FREQ = {
  groceries: 9, dining: 7, transport: 8, utilities: 4, housing: 2,
  subscriptions: 4, shopping: 5, health: 2, travel: 1, other: 2,
};

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function pad(n) { return String(n).padStart(2, '0'); }

function generateMonth(year, month) {
  const txs = [];
  const dim = daysInMonth(year, month);
  let idSeed = year * 100 + month;

  CATEGORIES.forEach((cat) => {
    const count = FREQ[cat.id] + Math.floor(rand() * 2);
    for (let i = 0; i < count; i++) {
      const day = Math.max(1, Math.floor(range(1, dim + 1)));
      const [lo, hi] = AMOUNT_RANGE[cat.id];
      const amount = Math.round(range(lo, hi) * 100) / 100;
      txs.push({
        id: `tx_${idSeed}_${cat.id}_${i}`,
        date: `${year}-${pad(month + 1)}-${pad(day)}`,
        merchant: pick(MERCHANTS[cat.id]),
        category: cat.id,
        account: pickAccount(cat.id, rand),
        amount,
        excluded: false,
      });
    }
  });

  return txs.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---- Build the last 6 months (most recent = current month) --------------
const TODAY = new Date('2026-08-18');
const MONTHS = [];
for (let i = 5; i >= 0; i--) {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1);
  MONTHS.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, year: d.getFullYear(), month: d.getMonth() });
}

const TRANSACTIONS = {}; // { '2026-08': [ {id,date,merchant,category,amount}, ... ] }
const accountsReady = loadAccounts().then(async () => {
  const transactions = await loadSupabaseTransactions();
  transactions.forEach((transaction) => {
    const month = transaction.date.slice(0, 7);
    if (!TRANSACTIONS[month]) TRANSACTIONS[month] = [];
    TRANSACTIONS[month].push(transaction);
  });

  const monthKeys = Object.keys(TRANSACTIONS).sort();
  MONTHS.splice(0, MONTHS.length, ...monthKeys.map((key) => ({ key })));
});

const MONTH_LABEL = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
