/**
 * filters.js
 * ---------------------------------------------------------------------
 * Wires up every control that changes what's shown: the month
 * dropdown, the account filter, the table's category filter and
 * search (each with a quick way to clear it), and table column sorting.
 * ---------------------------------------------------------------------
 */

/** Fills the month dropdown from MONTHS (newest first). Re-run if MONTHS changes. */
function renderMonthOptions() {
  const select = document.getElementById('month-select');
  select.innerHTML = MONTHS.slice().reverse().map((m) =>
    `<option value="${m.key}">${MONTH_LABEL(m.key)}</option>`
  ).join('');
  select.value = state.month;
}

/** Populates the month dropdown and re-renders the dashboard when it changes. */
function initMonthSelect() {
  const select = document.getElementById('month-select');
  renderMonthOptions();
  select.addEventListener('change', () => {
    state.month = select.value;
    try { sessionStorage.setItem('ledger-month', state.month); } catch { /* storage unavailable */ }
    renderAll();
  });
}

/**
 * Builds the account filter panel (user → bank → account, each with a
 * checkbox) and keeps `state.activeAccounts` in sync as boxes are
 * (un)checked, including the tri-state parent checkboxes.
 */
function initAccountFilter() {
  const wrap = document.getElementById('account-filter');
  const button = document.getElementById('account-filter-button');
  const label = document.getElementById('account-filter-label');
  const panel = document.getElementById('account-filter-panel');

  const groupedAccounts = ACCOUNT_GROUPS.map((group) => {
    const banks = new Map();
    group.accounts.forEach((account) => {
      if (!banks.has(account.bank)) banks.set(account.bank, []);
      banks.get(account.bank).push(account);
    });
    return { ...group, banks: [...banks.entries()] };
  });

  panel.innerHTML = groupedAccounts.map((user) => `
    <div class="account-filter__user" data-user="${user.id}">
      <label class="multiselect__option multiselect__option--group">
        <input type="checkbox" class="js-user-checkbox" data-user="${user.id}" checked>
        <span>${user.label}</span>
      </label>
      <div class="account-filter__banks">
        ${user.banks.map(([bank, accounts]) => `
          <div class="account-filter__bank" data-user="${user.id}" data-bank="${bank}">
            <label class="multiselect__option account-filter__bank-option">
              <input type="checkbox" class="js-bank-checkbox" data-user="${user.id}" data-bank="${bank}" checked>
              <span>${bank}</span>
            </label>
            <div class="multiselect__suboptions">
              ${accounts.map((account) => `
                <label class="multiselect__option multiselect__option--sub">
                  <input type="checkbox" class="js-account-checkbox" data-user="${user.id}" data-bank="${bank}" value="${account.id}" checked>
                  <span class="account-option__number">${account.id}</span>
                </label>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('') + '<div class="multiselect__divider"></div><div class="multiselect__actions"><button type="button" class="multiselect__clear" id="account-filter-select-all">Select all</button><button type="button" class="multiselect__clear" id="account-filter-clear-all">Clear all</button></div>';

  const updateLabel = () => {
    const count = state.activeAccounts.size;
    label.textContent = count === ACCOUNTS.length ? 'All accounts' : `${count} accounts selected`;
  };
  const close = () => { panel.hidden = true; wrap.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.hidden = !panel.hidden;
    wrap.classList.toggle('is-open', !panel.hidden);
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('change', (event) => {
    const checkbox = event.target;
    if (checkbox.classList.contains('js-user-checkbox')) {
      const userCheckboxes = panel.querySelectorAll(`.js-user-checkbox[data-user="${checkbox.dataset.user}"], .js-bank-checkbox[data-user="${checkbox.dataset.user}"], .js-account-checkbox[data-user="${checkbox.dataset.user}"]`);
      userCheckboxes.forEach((input) => {
        input.checked = checkbox.checked;
        if (input.classList.contains('js-account-checkbox')) {
          checkbox.checked ? state.activeAccounts.add(input.value) : state.activeAccounts.delete(input.value);
        }
      });
    } else if (checkbox.classList.contains('js-bank-checkbox')) {
      const bankAccounts = panel.querySelectorAll(`.js-account-checkbox[data-user="${checkbox.dataset.user}"][data-bank="${checkbox.dataset.bank}"]`);
      bankAccounts.forEach((input) => {
        input.checked = checkbox.checked;
        checkbox.checked ? state.activeAccounts.add(input.value) : state.activeAccounts.delete(input.value);
      });
      updateUserCheckboxState(checkbox.dataset.user);
    } else if (checkbox.classList.contains('js-account-checkbox')) {
      checkbox.checked ? state.activeAccounts.add(checkbox.value) : state.activeAccounts.delete(checkbox.value);
      updateBankCheckboxState(checkbox.dataset.user, checkbox.dataset.bank);
      updateUserCheckboxState(checkbox.dataset.user);
    }
    updateLabel();
    renderAll();
  });
  panel.querySelector('#account-filter-select-all').addEventListener('click', () => {
    state.activeAccounts = new Set(ACCOUNTS.map((account) => account.id));
    panel.querySelectorAll('input').forEach((input) => { input.checked = true; });
    updateLabel();
    renderAll();
  });
  panel.querySelector('#account-filter-clear-all').addEventListener('click', () => {
    state.activeAccounts.clear();
    panel.querySelectorAll('input').forEach((input) => {
      input.checked = false;
      input.indeterminate = false;
    });
    updateLabel();
    renderAll();
  });

  function updateBankCheckboxState(userId, bank) {
    const bankCheckbox = panel.querySelector(`.js-bank-checkbox[data-user="${userId}"][data-bank="${bank}"]`);
    const accounts = [...panel.querySelectorAll(`.js-account-checkbox[data-user="${userId}"][data-bank="${bank}"]`)];
    const selected = accounts.filter((account) => account.checked).length;
    bankCheckbox.checked = selected === accounts.length;
    bankCheckbox.indeterminate = selected > 0 && selected < accounts.length;
  }

  function updateUserCheckboxState(userId) {
    const userCheckbox = panel.querySelector(`.js-user-checkbox[data-user="${userId}"]`);
    const accounts = [...panel.querySelectorAll(`.js-account-checkbox[data-user="${userId}"]`)];
    const selected = accounts.filter((account) => account.checked).length;
    userCheckbox.checked = selected === accounts.length;
    userCheckbox.indeterminate = selected > 0 && selected < accounts.length;
    panel.querySelectorAll(`.js-bank-checkbox[data-user="${userId}"]`).forEach((bankCheckbox) => {
      updateBankCheckboxState(bankCheckbox.dataset.user, bankCheckbox.dataset.bank);
    });
  }

  document.addEventListener('click', (event) => { if (!wrap.contains(event.target)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  updateLabel();
}

/**
 * Builds the category multiselect above the transactions table. Nothing
 * ticked means every category is shown; the ticked ones also appear as
 * removable chips under the header, next to a "Clear all" link.
 */
function initCategoryFilter() {
  const wrap = document.getElementById('category-filter');
  const button = document.getElementById('category-filter-button');
  const panel = document.getElementById('category-filter-panel');

  panel.innerHTML = `
    <div class="category-filter__options">
      ${CATEGORIES.map((c) => `
        <label class="multiselect__option">
          <input type="checkbox" value="${c.id}">
          <span class="chip__dot" style="background:${c.color}" aria-hidden="true"></span>
          <span>${c.label}</span>
        </label>
      `).join('')}
    </div>
    <div class="multiselect__divider"></div>
    <button type="button" class="multiselect__clear" id="category-filter-clear">Clear selection</button>
  `;

  const close = () => { panel.hidden = true; wrap.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.hidden = !panel.hidden;
    wrap.classList.toggle('is-open', !panel.hidden);
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('change', (event) => {
    const { value, checked } = event.target;
    checked ? state.categories.add(value) : state.categories.delete(value);
    syncTableFilters();
    renderTable();
  });
  document.getElementById('category-filter-clear').addEventListener('click', () => {
    state.categories.clear();
    syncTableFilters();
    renderTable();
  });
  document.addEventListener('click', (event) => { if (!wrap.contains(event.target)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });

  // Active-filter chips: × removes one category, "Clear all" resets categories and search.
  document.getElementById('active-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-remove-cat]');
    if (chip) state.categories.delete(chip.dataset.removeCat);
    else if (event.target.closest('#clear-all-filters')) {
      state.categories.clear();
      clearSearch();
    } else return;
    syncTableFilters();
    renderTable();
  });

  syncTableFilters();
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

/** Updates the category dropdown, its label/count and the active-filter chips to match `state`. */
function syncTableFilters() {
  const selected = CATEGORIES.filter((c) => state.categories.has(c.id));
  document.querySelectorAll('#category-filter-panel input[type="checkbox"]').forEach((box) => {
    box.checked = state.categories.has(box.value);
  });

  document.getElementById('category-filter-label').textContent =
    !selected.length ? 'All categories' : selected.length === 1 ? selected[0].label : `${selected.length} categories`;
  const count = document.getElementById('category-filter-count');
  count.textContent = selected.length;
  count.hidden = !selected.length;
  document.getElementById('category-filter').classList.toggle('is-filtered', selected.length > 0);

  const row = document.getElementById('active-filters');
  row.hidden = !selected.length && !state.search;
  row.innerHTML = selected.map((c) => `
    <button type="button" class="chip chip--removable" data-remove-cat="${c.id}" aria-label="Remove ${c.label} filter">
      <span class="chip__dot" style="background:${c.color}" aria-hidden="true"></span>${c.label}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      </svg>
    </button>
  `).join('') + (state.search ? `<span class="active-filters__search">“${escapeAttr(state.search)}”</span>` : '')
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
