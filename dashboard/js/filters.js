/**
 * filters.js
 * ---------------------------------------------------------------------
 * Wires up every control that changes what's shown: the month
 * dropdown, the account filter, the category chips, search, the
 * "clear category filter" button, and table column sorting.
 * ---------------------------------------------------------------------
 */

/** Populates the month dropdown and re-renders the dashboard when it changes. */
function initMonthSelect() {
  const select = document.getElementById('month-select');
  select.innerHTML = MONTHS.slice().reverse().map((m) =>
    `<option value="${m.key}">${MONTH_LABEL(m.key)}</option>`
  ).join('');
  select.value = state.month;
  select.addEventListener('change', () => {
    state.month = select.value;
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

/** Builds the category filter chips above the table and toggles `state.activeCategories`. */
function initCategoryChips() {
  const row = document.getElementById('category-filters');
  row.innerHTML = CATEGORIES.map((c) => `
    <button class="chip is-active" type="button" data-cat="${c.id}">
      <span class="chip__dot" style="background:${c.color}"></span>${c.label}
    </button>
  `).join('');

  row.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const id = chip.dataset.cat;
    if (state.activeCategories.has(id)) {
      state.activeCategories.delete(id);
      chip.classList.remove('is-active');
    } else {
      state.activeCategories.add(id);
      chip.classList.add('is-active');
    }
    renderTable();
  });
}

/** Wires up the merchant search box (debounced) to filter the table. */
function initSearch() {
  const input = document.getElementById('search-input');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.search = input.value.trim().toLowerCase();
      renderTable();
    }, 150);
  });
}

/** Shows/hides the "clear category filter" button based on whether a chart drill-down filter is active. */
function updateCategoryFilterControl() {
  const button = document.getElementById('clear-category-filter');
  if (!button) return;
  button.hidden = !state.categoryFilter;
}

/** Wires up the "clear category filter" button (set via chart double-click, see charts.js). */
function initCategoryFilterControl() {
  document.getElementById('clear-category-filter').addEventListener('click', () => {
    state.categoryFilter = null;
    updateCategoryFilterControl();
    renderTable();
  });
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
