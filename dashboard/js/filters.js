/**
 * filters.js
 * ---------------------------------------------------------------------
 * Wires up every control that changes what's shown: the ‹ Month ›
 * stepper, the account filter, the table's category and user filters
 * and search (each with a quick way to clear it), and table column sorting.
 * ---------------------------------------------------------------------
 */

/**
 * Fills the month list from MONTHS (newest first) and updates the
 * ‹ Month › stepper's label and arrows. Re-run if MONTHS changes.
 */
function renderMonthOptions() {
  const select = document.getElementById('month-select');
  select.innerHTML = MONTHS.slice().reverse().map((m) =>
    `<option value="${m.key}">${MONTH_LABEL(m.key)}</option>`
  ).join('');
  select.value = state.month;

  const index = MONTHS.findIndex((m) => m.key === state.month);
  document.getElementById('month-label').textContent = MONTH_LABEL(state.month);
  document.getElementById('month-prev').disabled = index <= 0;
  document.getElementById('month-next').disabled = index === -1 || index >= MONTHS.length - 1;
}

/**
 * Switches the dashboard to a month ('YYYY-MM'), remembering it for the
 * other page. The page slides the way you moved (motion.js).
 */
function setMonth(key) {
  if (!key || key === state.month) return;
  const direction = key > state.month ? 1 : -1;
  const update = () => {
    state.month = key;
    try { sessionStorage.setItem('ledger-month', state.month); } catch { /* storage unavailable */ }
    renderMonthOptions();
    renderAll();
  };
  if (typeof motion !== 'undefined') motion.monthTransition(direction, update);
  else update();
}

/**
 * Wires up the ‹ Month › stepper: arrows step one month, clicking the
 * month name opens the full list, and ←/→ step months when you're not typing.
 */
function initMonthSelect() {
  const select = document.getElementById('month-select');
  const step = (delta) => {
    const index = MONTHS.findIndex((m) => m.key === state.month);
    setMonth(MONTHS[index + delta]?.key);
  };
  renderMonthOptions();
  select.addEventListener('change', () => setMonth(select.value));
  document.getElementById('month-prev').addEventListener('click', () => step(-1));
  document.getElementById('month-next').addEventListener('click', () => step(1));
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  });
  initMonthSwipe(step);
}

/**
 * Touch screens: swiping sideways across the page changes month — left
 * for the next, right for the previous. The page follows the finger a
 * little, then slides on to the new month, or springs back if the swipe
 * was short or there's no month that way. Swipes starting on the line
 * and bar charts, fields or sideways-scrolling rows, or at the screen's
 * edges (the browser's own back/forward gesture), are left alone.
 */
function initMonthSwipe(step) {
  const main = document.querySelector('main');
  if (!main) return;
  let start = null;
  let horizontal = null;
  let dx = 0;
  const neighbour = (delta) => MONTHS[MONTHS.findIndex((m) => m.key === state.month) + delta];
  // Charts you drag along to read (the running total, the trend) keep the gesture for themselves.
  const ignore = (el) => el.closest('.hero-tile__chart, .chart-tile__canvas-wrap--line, input, select, textarea, .chip-row, .table-scroll, .multiselect__panel');
  // While the page is pulled sideways, clip what pokes out of the screen so the
  // browser doesn't treat it as a wider page (and zoom out to fit it).
  const swiping = (on) => document.documentElement.classList.toggle('is-swiping', on);
  const springBack = () => {
    main.style.transition = 'transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1)';
    main.style.transform = '';
    setTimeout(() => { main.style.transition = ''; swiping(false); }, 340);
  };

  main.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    start = null;
    if (event.touches.length !== 1 || ignore(event.target)) return;
    if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return;
    start = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
    horizontal = null;
    dx = 0;
  }, { passive: true });

  main.addEventListener('touchmove', (event) => {
    if (!start) return;
    const touch = event.touches[0];
    dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Decide once, after a little movement, whether this is a sideways swipe or a scroll.
    if (horizontal === null && Math.hypot(dx, dy) > 10) horizontal = Math.abs(dx) > Math.abs(dy) * 1.4;
    if (!horizontal) return;
    event.preventDefault();
    swiping(true);
    const resist = neighbour(dx < 0 ? 1 : -1) ? 0.35 : 0.12; // stiffer at the first/last month
    main.style.transition = 'none';
    main.style.transform = `translateX(${dx * resist}px)`;
  }, { passive: false });

  const end = (event) => {
    if (!start || !horizontal) { start = null; return; }
    const fast = Math.abs(dx) / Math.max(1, event.timeStamp - start.time) > 0.5;
    start = null;
    const delta = dx < 0 ? 1 : -1;
    if ((Math.abs(dx) > 70 || (fast && Math.abs(dx) > 30)) && neighbour(delta)) {
      step(delta); // the slide takes it from here
      setTimeout(() => swiping(false), 600);
    } else springBack();
  };
  main.addEventListener('touchend', end);
  main.addEventListener('touchcancel', () => { if (start && horizontal) springBack(); start = null; });
}

/**
 * The account picker in the header: a small "wallet". Each person is a
 * section (their name as a gold label — tap it to include or leave out
 * all their accounts), and each account is a row with a little
 * card, the bank and its number, and a gold check when it's included.
 * Keeps `state.activeAccounts` in sync and redraws the page on each change.
 */
function initAccountFilter() {
  const wrap = document.getElementById('account-filter');
  const button = document.getElementById('account-filter-button');
  const label = document.getElementById('account-filter-label');
  const panel = document.getElementById('account-filter-panel');
  panel.classList.add('account-picker');
  panel.setAttribute('role', 'dialog');

  // A small stacked-cards glyph before the button's label.
  if (!button.querySelector('.account-picker__glyph')) {
    button.insertAdjacentHTML('afterbegin', '<span class="account-picker__glyph" aria-hidden="true"><i></i><i></i></span>');
  }

  const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8.3l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const DASH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 8h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const isOn = (id) => state.activeAccounts.has(id);

  const updateLabel = () => {
    const count = state.activeAccounts.size;
    if (count === ACCOUNTS.length) label.textContent = 'All accounts';
    else if (count === 1) label.textContent = ACCOUNTS.find((a) => isOn(a.id))?.bank || '1 account';
    else label.textContent = `${count} of ${ACCOUNTS.length} accounts`;
  };

  const render = () => {
    const shown = state.activeAccounts.size;
    panel.innerHTML = `
      <div class="account-picker__head">
        <span class="account-picker__title">Accounts</span>
        <span class="account-picker__links">
          <button type="button" data-all>Select all</button>
          <button type="button" data-none>Clear</button>
        </span>
      </div>
      ${ACCOUNT_GROUPS.map((group) => {
        const on = group.accounts.filter((a) => isOn(a.id)).length;
        const mark = on === group.accounts.length ? 'is-on' : on ? 'is-some' : '';
        return `
        <section class="account-picker__group">
          <button type="button" class="account-picker__person ${mark}" data-group="${escapeAttr(group.id)}"
            aria-pressed="${on === group.accounts.length ? 'true' : on ? 'mixed' : 'false'}">
            <span class="account-picker__name">${escapeAttr(group.label)}</span>
            <span class="account-picker__check">${on && on < group.accounts.length ? DASH : CHECK}</span>
          </button>
          ${group.accounts.map((account) => `
            <button type="button" class="account-picker__account${isOn(account.id) ? ' is-on' : ''}" data-account="${escapeAttr(account.id)}" aria-pressed="${isOn(account.id)}">
              <span class="account-picker__card" aria-hidden="true"></span>
              <span class="account-picker__meta">
                <span class="account-picker__bank">${escapeAttr(account.bank)}</span>
                <span class="account-picker__number">${escapeAttr(account.label)}</span>
              </span>
              <span class="account-picker__check">${CHECK}</span>
            </button>`).join('')}
        </section>`;
      }).join('')}
      <div class="account-picker__foot">${shown} of ${ACCOUNTS.length} account${ACCOUNTS.length === 1 ? '' : 's'} shown</div>`;
  };

  const apply = () => { render(); updateLabel(); renderAll(); };
  const close = () => { panel.hidden = true; wrap.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (panel.hidden) render();
    panel.hidden = !panel.hidden;
    wrap.classList.toggle('is-open', !panel.hidden);
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  panel.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = event.target.closest('button');
    if (!target) return;
    if (target.hasAttribute('data-all')) {
      state.activeAccounts = new Set(ACCOUNTS.map((a) => a.id));
    } else if (target.hasAttribute('data-none')) {
      state.activeAccounts.clear();
    } else if (target.dataset.account) {
      const id = target.dataset.account;
      isOn(id) ? state.activeAccounts.delete(id) : state.activeAccounts.add(id);
    } else if (target.dataset.group) {
      const group = ACCOUNT_GROUPS.find((g) => g.id === target.dataset.group);
      const all = group.accounts.every((a) => isOn(a.id));
      group.accounts.forEach((a) => (all ? state.activeAccounts.delete(a.id) : state.activeAccounts.add(a.id)));
    } else return;
    apply();
    // Keep keyboard focus on the same control after the redraw.
    const key = target.dataset.account ? `[data-account="${CSS.escape(target.dataset.account)}"]`
      : target.dataset.group ? `[data-group="${CSS.escape(target.dataset.group)}"]`
      : target.hasAttribute('data-all') ? '[data-all]' : '[data-none]';
    panel.querySelector(key)?.focus();
  });

  document.addEventListener('click', (event) => { if (!wrap.contains(event.target)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  updateLabel();
}

/**
 * The transactions table's dropdown filters. In each, nothing ticked means
 * "show all"; ticked items also appear as removable chips under the header,
 * next to a "Clear all" link that resets every filter and the search.
 */
const TABLE_FILTERS = [
  {
    key: 'categories', id: 'category-filter', all: 'All categories', noun: 'categories',
    items: () => CATEGORIES.map((c) => ({ id: c.id, label: c.label, color: c.color })),
  },
  {
    // Same grouping and colours as the Spending by user chart.
    key: 'users', id: 'user-filter', all: 'All users', noun: 'users',
    items: () => spendOwners().map((owner) => ({ id: owner, label: owner, color: spendOwnerColor(owner) })),
  },
];

function initTableFilters() {
  TABLE_FILTERS.forEach(initTableFilter);

  document.addEventListener('click', () => closeTableFilters());
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeTableFilters(); });

  // The table's empty state offers the same reset as "Clear all".
  document.getElementById('empty-clear-filters').addEventListener('click', () => {
    TABLE_FILTERS.forEach((filter) => state[filter.key].clear());
    clearSearch();
    syncTableFilters();
    renderTable();
  });

  // Active-filter chips: × removes one item, "Clear all" resets every filter and the search.
  document.getElementById('active-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-remove-key]');
    if (chip) state[chip.dataset.removeKey].delete(chip.dataset.removeId);
    else if (event.target.closest('#clear-all-filters')) {
      TABLE_FILTERS.forEach((filter) => state[filter.key].clear());
      clearSearch();
    } else return;
    syncTableFilters();
    renderTable();
  });

  syncTableFilters();
}

/** Builds one dropdown: "Clear selection" first (no scrolling to reach it), then the options. */
function initTableFilter(filter) {
  const wrap = document.getElementById(filter.id);
  const button = wrap.querySelector('.multiselect__button');
  const panel = wrap.querySelector('.multiselect__panel');

  panel.innerHTML = `
    <button type="button" class="multiselect__clear" data-clear>Clear selection</button>
    <div class="multiselect__divider"></div>
    <div class="table-filter__options">
      ${filter.items().map((item) => `
        <label class="multiselect__option">
          <input type="checkbox" value="${escapeAttr(item.id)}">
          <span class="chip__dot" style="background:${item.color}" aria-hidden="true"></span>
          <span>${escapeAttr(item.label)}</span>
        </label>
      `).join('')}
    </div>
  `;

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const opening = panel.hidden;
    closeTableFilters();
    if (opening) {
      panel.hidden = false;
      wrap.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
    }
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('change', (event) => {
    const { value, checked } = event.target;
    checked ? state[filter.key].add(value) : state[filter.key].delete(value);
    syncTableFilters();
    renderTable();
  });
  panel.querySelector('[data-clear]').addEventListener('click', () => {
    state[filter.key].clear();
    syncTableFilters();
    renderTable();
  });
}

/** Closes every open table filter dropdown. */
function closeTableFilters() {
  TABLE_FILTERS.forEach((filter) => {
    const wrap = document.getElementById(filter.id);
    wrap.querySelector('.multiselect__panel').hidden = true;
    wrap.classList.remove('is-open');
    wrap.querySelector('.multiselect__button').setAttribute('aria-expanded', 'false');
  });
}

/** Wires up the merchant search box (debounced), its × button and Escape to clear. */
function initSearch() {
  const input = document.getElementById('search-input');
  let t;
  input.addEventListener('input', () => {
    document.getElementById('search-clear').hidden = !input.value;
    clearTimeout(t);
    t = setTimeout(() => {
      state.search = input.value.trim().toLowerCase();
      syncTableFilters();
      renderTable();
    }, 150);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !input.value) return;
    event.stopPropagation();
    clearSearch();
    syncTableFilters();
    renderTable();
  });
  document.getElementById('search-clear').addEventListener('click', (event) => {
    event.preventDefault(); // it sits inside the search <label>
    clearSearch();
    syncTableFilters();
    renderTable();
    input.focus();
  });
}

/** Empties the search box and its filter (callers re-render). */
function clearSearch() {
  const input = document.getElementById('search-input');
  input.value = '';
  state.search = '';
  document.getElementById('search-clear').hidden = true;
}

/** Updates each filter dropdown (ticks, label, count) and the active-filter chips to match `state`. */
function syncTableFilters() {
  const chips = [];
  TABLE_FILTERS.forEach((filter) => {
    const wrap = document.getElementById(filter.id);
    const selected = filter.items().filter((item) => state[filter.key].has(item.id));
    wrap.querySelectorAll('input[type="checkbox"]').forEach((box) => { box.checked = state[filter.key].has(box.value); });
    wrap.querySelector('.table-filter__label').textContent =
      !selected.length ? filter.all : selected.length === 1 ? selected[0].label : `${selected.length} ${filter.noun}`;
    const count = wrap.querySelector('.table-filter__count');
    count.textContent = selected.length;
    count.hidden = !selected.length;
    wrap.classList.toggle('is-filtered', selected.length > 0);

    selected.forEach((item) => chips.push(`
      <button type="button" class="chip chip--removable" data-remove-key="${filter.key}" data-remove-id="${escapeAttr(item.id)}" aria-label="Remove ${escapeAttr(item.label)} filter">
        <span class="chip__dot" style="background:${item.color}" aria-hidden="true"></span>${escapeAttr(item.label)}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
        </svg>
      </button>
    `));
  });

  const row = document.getElementById('active-filters');
  row.hidden = !chips.length && !state.search;
  row.innerHTML = chips.join('')
    + (state.search ? `<span class="active-filters__search">“${escapeAttr(state.search)}”</span>` : '')
    + '<button type="button" class="active-filters__clear" id="clear-all-filters">Clear all</button>';
}

/** Wires up clicking a table column header to sort by that column. */
function initSorting() {
  document.querySelectorAll('.tx-table thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = { key, dir: key === 'date' ? 'desc' : 'asc' };
      }
      document.querySelectorAll('.tx-table thead th').forEach((h) => h.classList.remove('is-sorted', 'is-sorted--asc'));
      th.classList.add('is-sorted');
      if (state.sort.dir === 'asc') th.classList.add('is-sorted--asc');
      renderTable();
    });
  });
}
