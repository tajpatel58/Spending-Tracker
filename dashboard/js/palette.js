/**
 * palette.js
 * ---------------------------------------------------------------------
 * Quick find: ⌘K (Ctrl+K on Windows) opens a glass panel in the middle of
 * the screen. Type a few letters to go to a page, a month, a merchant or
 * a category, or to run an action (dark mode, hide figures, sync, export,
 * sign out). Whatever is typed can also be put to the Assistant.
 *
 * It loads with the account menu (auth.js), which carries a "Quick find"
 * row for phones and the mouse, so every signed-in page has it. The page
 * says what it can do in place with providePalette():
 *
 *   providePalette({
 *     transactions, // TRANSACTIONS (data.js): the months and merchants to find
 *     month,        // () => the month on screen, 'YYYY-MM'
 *     setMonth,     // (key) => switch month in place (Overview, Calendar)
 *     setSearch,    // (text) => search the transactions table (Overview)
 *     categories,   // [{ id, label, color }] and
 *     setCategory,  // (id) => filter the table to one (Overview)
 *     ask,          // (text) => send a question (Assistant)
 *   });
 *
 * Anything a page can't do in place is handed to the page that can,
 * through sessionStorage, read once on arrival: `ledger-month` and
 * `ledger-search` by the Overview (state.js), `ledger-ask` by the
 * Assistant (chat.js).
 * ---------------------------------------------------------------------
 */

import { isDiscreet, toggleDiscreet } from './discreet.js';
import { escapeAttr } from './format.js';

const source = {};

/** Tells the palette what this page can find and do (see the top of this file). */
export function providePalette(next) {
  Object.assign(source, next);
}

// The groups, in the order they're listed, and how many rows each may show.
const GROUPS = [['Pages', 6], ['Months', 5], ['Merchants', 6], ['Categories', 4], ['Actions', 6], ['Assistant', 1]];
const RECENT_MONTHS = 3; // listed before anything is typed

const svg = (paths) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  search: svg('<circle cx="11" cy="11" r="6.5" stroke="currentColor"/><path d="M20 20l-4.2-4.2" stroke="currentColor"/>'),
  month: svg('<rect x="4" y="5.5" width="16" height="14.5" rx="2.5" stroke="currentColor"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" stroke="currentColor"/>'),
  merchant: svg('<path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8v-17Z" stroke="currentColor"/><path d="M9.5 8.5h5M9.5 12.5h5" stroke="currentColor"/>'),
  sun: svg('<circle cx="12" cy="12" r="4.5" stroke="currentColor"/><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8" stroke="currentColor"/>'),
  moon: svg('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" stroke="currentColor"/>'),
  eye: svg('<path d="M2.7 12C3.5 9.6 6.8 5 12 5s8.5 4.6 9.3 7c-.8 2.4-4.1 7-9.3 7s-8.5-4.6-9.3-7Z" stroke="currentColor"/><circle cx="12" cy="12" r="3" stroke="currentColor"/>'),
  eyeOff: svg('<path d="M4 4l16 16M9.9 5.3A9.6 9.6 0 0 1 12 5c5.2 0 8.5 4.6 9.3 7a11 11 0 0 1-2.6 3.9M6.4 6.9A11.6 11.6 0 0 0 2.7 12c.8 2.4 4.1 7 9.3 7a9.3 9.3 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor"/>'),
  sync: svg('<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1" stroke="currentColor"/><path d="M17.5 3.5v3.6h-3.6M6.5 20.5v-3.6h3.6" stroke="currentColor"/>'),
  export: svg('<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor"/>'),
  signOut: svg('<path d="M9 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H9" stroke="currentColor"/><path d="M20 12H10.5M20 12l-3.5-3.5M20 12l-3.5 3.5" stroke="currentColor"/>'),
  ask: svg('<path d="M12 3.5l1.6 4.3a3 3 0 0 0 1.8 1.8l4.1 1.4-4.1 1.4a3 3 0 0 0-1.8 1.8L12 18.5l-1.6-4.3a3 3 0 0 0-1.8-1.8L4.5 11l4.1-1.4a3 3 0 0 0 1.8-1.8L12 3.5Z" stroke="currentColor"/>'),
};

const MONTH_NAME = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const monthLabel = (key) => MONTH_NAME.format(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1));
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

// ---------- Going places ----------

/** Leaves something for the next page to pick up (read once, on arrival). */
function handOver(values) {
  try {
    Object.entries(values).forEach(([key, value]) => sessionStorage.setItem(key, value));
  } catch { /* storage unavailable: the page still opens */ }
}

/** Opens another page through its tab, so the page slides the way the tabs do (motion.js). */
function openPage(href) {
  const link = document.querySelector(`.view-nav__link[href="${href}"]`);
  if (link && !link.hidden) link.click();
  else window.location.href = href;
}

function showTable(delay = 0) {
  setTimeout(() => {
    document.querySelector('.table-tile')?.scrollIntoView({ block: 'start', behavior: smooth() });
  }, delay);
}

function goToMonth(key) {
  if (source.setMonth) { source.setMonth(key); return; }
  handOver({ 'ledger-month': key });
  openPage('index.html');
}

/** A merchant's transactions: the Overview's table, in the latest month it appears, searched for it. */
function goToMerchant(merchant) {
  if (!source.setSearch) {
    handOver({ 'ledger-month': merchant.month, 'ledger-search': merchant.name });
    openPage('index.html');
    return;
  }
  const moving = merchant.month !== source.month?.();
  source.setSearch(merchant.name);
  if (moving) source.setMonth?.(merchant.month);
  showTable(moving ? 420 : 0); // once the months have slid past
}

// ---------- What can be found ----------

/** Every merchant across the loaded months: its latest month and how often it appears, this month's first. */
function merchants(months, current) {
  const found = new Map();
  months.forEach((key) => {
    source.transactions[key].forEach((t) => {
      if (t.hidden || !t.merchant) return;
      const id = t.merchant.trim().toLowerCase();
      const entry = found.get(id);
      if (entry) entry.count += 1;
      else found.set(id, { name: t.merchant.trim(), month: key, count: 1 }); // months run newest first
    });
  });
  return [...found.values()].sort((a, b) => (b.month === current) - (a.month === current) || b.count - a.count);
}

/** Everything this page can do, as { group, label, hint, icon, keywords, run }. Worked out each time the palette opens. */
function commands() {
  const list = [];
  const add = (group, command) => list.push({ group, keywords: [], ...command });

  document.querySelectorAll('.view-nav__link:not([hidden])').forEach((link) => {
    if (link.classList.contains('is-active')) return;
    add('Pages', {
      label: link.textContent.trim(),
      hint: 'Page',
      icon: link.querySelector('svg')?.outerHTML.replace(/ class="[^"]*"/, '') || '',
      run: () => link.click(),
    });
  });

  const months = source.transactions
    ? Object.keys(source.transactions).filter((key) => source.transactions[key]?.length).sort().reverse()
    : [];
  const current = source.month?.();
  const today = new Date();
  const thisMonth = monthKey(today);
  const lastMonth = monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  let recent = 0;
  months.forEach((key) => {
    if (key === current) return;
    const when = key === thisMonth ? 'This month' : key === lastMonth ? 'Last month' : '';
    add('Months', {
      label: monthLabel(key),
      hint: when || 'Month',
      icon: ICONS.month,
      keywords: [when, key, `${monthLabel(key).slice(0, 3)} ${key.slice(0, 4)}`],
      recent: (recent += 1) <= RECENT_MONTHS,
      run: () => goToMonth(key),
    });
  });

  merchants(months, current).forEach((merchant) => add('Merchants', {
    label: merchant.name,
    hint: `${plural(merchant.count, 'transaction')} · ${merchant.month === current ? 'this month' : `last in ${monthLabel(merchant.month)}`}`,
    icon: ICONS.merchant,
    run: () => goToMerchant(merchant),
  }));

  if (source.setCategory) {
    (source.categories || []).forEach((category) => add('Categories', {
      label: category.label,
      hint: 'Filter transactions',
      icon: `<i class="palette__dot" style="background:${category.color}"></i>`,
      run: () => { source.setCategory(category.id); showTable(); },
    }));
  }

  const click = (id) => () => document.getElementById(id)?.click();
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (document.getElementById('theme-toggle')) {
    add('Actions', {
      label: dark ? 'Switch to light mode' : 'Switch to dark mode',
      icon: dark ? ICONS.sun : ICONS.moon,
      keywords: ['theme', 'appearance', 'dark', 'light'],
      run: click('theme-toggle'),
    });
  }
  add('Actions', {
    label: isDiscreet() ? 'Show figures' : 'Hide figures',
    icon: isDiscreet() ? ICONS.eye : ICONS.eyeOff,
    keywords: ['discreet', 'private', 'privacy', 'amounts', 'money'],
    run: toggleDiscreet,
  });
  const sync = document.getElementById('sync-status');
  if (sync && !sync.hidden) add('Actions', { label: 'Sync now', icon: ICONS.sync, keywords: ['refresh', 'update', 'reload'], run: click('sync-status') });
  if (document.getElementById('export-table')) {
    add('Actions', { label: 'Export transactions as CSV', icon: ICONS.export, keywords: ['download', 'csv', 'spreadsheet'], run: click('export-table') });
  }
  if (document.getElementById('signout-button')) {
    add('Actions', { label: 'Sign out', icon: ICONS.signOut, keywords: ['log out', 'logout'], run: click('signout-button') });
  }
  return list;
}

// ---------- Matching ----------

/** How well `text` answers what's typed: the whole of it, its start, the start of a word, or anywhere in it. 0 = not at all. */
function score(query, text) {
  const t = text.toLowerCase();
  if (t === query) return 100;
  if (t.startsWith(query)) return 80;
  const at = t.indexOf(query);
  if (at > 0) return /[\s\-/&.]/.test(t[at - 1]) ? 60 : 30;
  // "oct 26": each typed word starting one of its words.
  const typed = query.split(/\s+/);
  const words = t.split(/[\s\-/&.]+/);
  return typed.length > 1 && typed.every((part) => words.some((word) => word.startsWith(part) || word.endsWith(part))) ? 50 : 0;
}

/** The rows to show for what's typed, as [group, commands] in listed order. */
function results(all, typed) {
  const query = typed.trim().toLowerCase();
  const matched = !query
    ? all.filter((c) => c.group === 'Pages' || c.group === 'Actions' || c.recent)
    : all
      .map((c) => ({ ...c, score: Math.max(score(query, c.label), ...c.keywords.filter(Boolean).map((k) => score(query, k) * 0.9)) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score); // stable: equal scores keep their order
  if (query && (source.ask || document.querySelector('.view-nav__link[href="chat.html"]:not([hidden])'))) {
    const question = typed.trim();
    matched.push({
      group: 'Assistant',
      label: `Ask “${question}”`,
      hint: 'Assistant',
      icon: ICONS.ask,
      run: () => {
        if (source.ask) { source.ask(question); return; }
        handOver({ 'ledger-ask': question });
        openPage('chat.html');
      },
    });
  }
  return GROUPS
    .map(([group, limit]) => [group, matched.filter((c) => c.group === group).slice(0, limit)])
    .filter(([, rows]) => rows.length);
}

// ---------- The panel ----------

let dialog = null;
let all = [];     // every command, from when the palette opened
let rows = [];    // the ones listed now, in order
let active = 0;

function setActive(index, scroll = true) {
  const options = dialog.querySelectorAll('.palette__item');
  if (!options.length) return;
  active = (index + options.length) % options.length;
  options.forEach((option, i) => {
    option.classList.toggle('is-active', i === active);
    option.setAttribute('aria-selected', String(i === active));
  });
  dialog.querySelector('.palette__input').setAttribute('aria-activedescendant', options[active].id);
  if (scroll) options[active].scrollIntoView({ block: 'nearest' });
}

function render() {
  const input = dialog.querySelector('.palette__input');
  const list = dialog.querySelector('.palette__results');
  rows = [];
  list.innerHTML = results(all, input.value).map(([group, commandsIn]) => `
    <p class="palette__group" role="presentation">${group}</p>
    ${commandsIn.map((command) => {
      const index = rows.push(command) - 1;
      return `
        <div class="palette__item" role="option" id="palette-option-${index}" data-index="${index}" aria-selected="false">
          <span class="palette__icon">${command.icon || ''}</span>
          <span class="palette__label">${escapeAttr(command.label)}</span>
          <span class="palette__hint">${escapeAttr(command.hint || '')}</span>
        </div>`;
    }).join('')}`).join('')
    || `<p class="palette__empty">Nothing matches “${escapeAttr(input.value.trim())}”</p>`;
  list.scrollTop = 0;
  setActive(0, false);
}

function run(command) {
  if (!command) return;
  dialog.close();
  command.run();
}

function build() {
  dialog = document.createElement('dialog');
  dialog.className = 'palette';
  dialog.setAttribute('aria-label', 'Quick find');
  dialog.innerHTML = `
    <label class="palette__field">
      ${ICONS.search}
      <input class="palette__input" type="text" placeholder="Find a month, page or merchant…" aria-label="Quick find"
        role="combobox" aria-expanded="true" aria-controls="palette-results" aria-autocomplete="list"
        autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">
      <kbd class="palette__key">esc</kbd>
    </label>
    <div class="palette__results" id="palette-results" role="listbox" aria-label="Results"></div>
    <p class="palette__foot" aria-hidden="true">
      <span><kbd class="palette__key">↑</kbd><kbd class="palette__key">↓</kbd> to move</span>
      <span><kbd class="palette__key">↵</kbd> to open</span>
    </p>`;
  document.body.append(dialog);

  const input = dialog.querySelector('.palette__input');
  const list = dialog.querySelector('.palette__results');
  input.addEventListener('input', render);
  // Kept inside the panel, so the page's own shortcuts (←/→ change month) don't fire too.
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'ArrowDown') setActive(active + 1);
    else if (event.key === 'ArrowUp') setActive(active - 1);
    else if (event.key === 'Enter' && !event.isComposing) run(rows[active]);
    else if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) dialog.close();
    else return; // Escape closes it, as for any dialog
    event.preventDefault();
  });
  list.addEventListener('click', (event) => {
    const option = event.target.closest('[data-index]');
    if (option) run(rows[Number(option.dataset.index)]);
  });
  list.addEventListener('pointermove', (event) => {
    const option = event.target.closest('[data-index]');
    if (option && Number(option.dataset.index) !== active) setActive(Number(option.dataset.index), false);
  });
  // A click on the dimmed page (the dialog's own box is all panel) closes it.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
}

/** Opens quick find (on signed-in pages, and not over another dialog). */
export function openPalette() {
  if (!document.querySelector('.topbar') || document.querySelector('dialog[open]')) return;
  if (!dialog) build();
  all = commands();
  const input = dialog.querySelector('.palette__input');
  input.value = '';
  dialog.showModal();
  render();
  input.focus();
}

document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
  event.preventDefault();
  openPalette();
});
