/**
 * app.js
 * ---------------------------------------------------------------------
 * Renders the dashboard from mock-data.js. Every place that reads from
 * TRANSACTIONS / CATEGORIES is a natural spot to swap in a fetch() call
 * to your FastAPI backend later — see the "// API:" comments.
 * ---------------------------------------------------------------------
 */

(function () {
  'use strict';

  // ---- State --------------------------------------------------------
  const state = {
    month: null, // set to the most recent month once transactions load
    activeCategories: new Set(CATEGORIES.map((c) => c.id)), // all active
    categoryFilter: null,
    activeAccounts: new Set(), // populated after accounts.csv loads
    selectedTransactionIds: new Set(),
    search: '',
    sort: { key: 'date', dir: 'desc' },
  };

  const accountById = {};

  const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const currency = (n) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const currencyShort = (n) => `£${Math.round(n).toLocaleString('en-GB')}`;

  // ---- Theme ----------------------------------------------------------
  function initTheme() {
    const saved = localStorage.getItem('ledger-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ledger-theme', next);
    // Charts read CSS custom properties into fixed colors at creation time,
    // so redraw them on theme change to pick up the new palette.
    renderCategoryChart();
    renderUserChart();
    renderTrendChart();
    renderBudgetChart();
  }

  // ---- Month selector ---------------------------------------------------
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

  // ---- Category filter chips ---------------------------------------------
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

  // ---- Search -----------------------------------------------------------
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

  function updateCategoryFilterControl() {
    const button = document.getElementById('clear-category-filter');
    if (!button) return;
    button.hidden = !state.categoryFilter;
  }

  function initCategoryFilterControl() {
    document.getElementById('clear-category-filter').addEventListener('click', () => {
      state.categoryFilter = null;
      updateCategoryFilterControl();
      renderTable();
    });
  }

  // ---- Sorting ------------------------------------------------------------
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

  // ---- Data helpers ---------------------------------------------------
  // API: replace with `fetch(`/api/transactions?month=${month}&accounts=${[...state.activeAccounts]}`)`
  function getMonthTransactions(month) {
    const all = TRANSACTIONS[month] || [];
    return all.filter((t) => {
      if (t.hidden === true) return false;
      return state.activeAccounts.has(t.account);
    });
  }

  function getFilteredTransactions() {
    return getMonthTransactions(state.month)
      .filter((t) => state.activeCategories.has(t.category))
      .filter((t) => !state.categoryFilter || t.category === state.categoryFilter)
      .filter((t) => !state.search || t.merchant.toLowerCase().includes(state.search));
  }

  function isExpense(t) {
    return !['salary', 'interest', 'refund'].includes(t.category);
  }

  // Edit these monthly budget values as the household budget evolves.
  const BUDGETS = {
    'Dining Out': 250,
    Groceries: 300,
    Housing: 500,
    Shopping: 250,
    Transport: 250,
    Health: 200,
    Extras: 400,
  };

  // Map raw category IDs into the budget groups shown on the dashboard.
  const BUDGET_GROUPS = {
    dining: 'Dining Out',
    groceries: 'Groceries',
    housing: 'Housing',
    shopping: 'Shopping',
    transport: 'Transport',
    health: 'Health',
    holiday: 'Extras',
    subscriptions: 'Extras',
    'birthday/gifts': 'Extras',
    other: 'Extras',
  };

  function categoryTotals(txs) {
    const totals = {};
    txs.forEach((t) => { totals[t.category] = (totals[t.category] || 0) + Math.abs(t.amount); });
    return totals;
  }

  function monthTotal(month) {
    return getMonthTransactions(month)
      .filter(isExpense)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }

  // ---- Stat tiles ---------------------------------------------------------
  // API: replace with `fetch(`/api/analytics/summary?month=${month}`)`
  function renderStats() {
    const txs = getMonthTransactions(state.month);
    const total = txs.filter(isExpense).reduce((s, t) => s + Math.abs(t.amount), 0);

    const idx = MONTHS.findIndex((m) => m.key === state.month);
    const prevKey = idx > 0 ? MONTHS[idx - 1].key : null;
    const prevTotal = prevKey ? monthTotal(prevKey) : null;

    document.getElementById('stat-total').textContent = currency(total);
    const deltaEl = document.getElementById('stat-total-delta');
    if (prevTotal !== null && prevTotal > 0) {
      const pct = ((total - prevTotal) / prevTotal) * 100;
      const sign = pct >= 0 ? '+' : '';
      deltaEl.textContent = `${sign}${pct.toFixed(1)}% vs last month`;
      deltaEl.className = 'stat-tile__delta ' + (pct >= 0 ? 'is-up' : 'is-down');
    } else {
      deltaEl.textContent = 'No prior month data';
      deltaEl.className = 'stat-tile__delta';
    }

    const income = txs
      .filter((t) => t.category === 'salary' || t.category === 'interest')
      .reduce((sum, t) => sum + t.amount, 0);
    document.getElementById('stat-income').textContent = currency(income);

    const expenseCount = txs.filter(isExpense).length;
    document.getElementById('stat-count').textContent = txs.length;
    const avg = expenseCount ? total / expenseCount : 0;
    document.getElementById('stat-avg').textContent = expenseCount ? `${currency(avg)} avg / expense` : '—';

    const [y, m] = state.month.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    document.getElementById('stat-daily-avg').textContent = currency(total / dim);
    document.getElementById('stat-daily-note').textContent = `Across ${dim} days`;

    document.getElementById('page-subtitle').textContent = `Spending summary — ${MONTH_LABEL(state.month)}`;
  }

  // ---- Charts ---------------------------------------------------------
  let categoryChart, trendChart, userChart;
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // API: replace totals with `fetch(`/api/analytics/summary?month=${month}`)`
  function renderCategoryChart() {
    const txs = getMonthTransactions(state.month);
    const totals = categoryTotals(txs.filter(isExpense));
    const entries = CATEGORIES
      .filter((c) => isExpense({ category: c.id }))
      .map((c) => ({ ...c, total: totals[c.id] || 0 }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);

    const ctx = document.getElementById('category-chart');
    const colors = entries.map((e) => cssVar(e.color.replace('var(', '').replace(')', '')));

    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: entries.map((e) => e.label),
        datasets: [{
          data: entries.map((e) => e.total),
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: cssVar('--surface'),
        }],
      },
      options: {
        cutout: '72%',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${currency(c.raw)}` } } },
        animation: { duration: 250 },
      },
    });

    ctx.ondblclick = (event) => {
      const elements = categoryChart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
      if (!elements.length) return;
      setCategoryFilter(entries[elements[0].index].id);
    };

    document.getElementById('category-chart-meta').textContent = `${entries.length} categories`;

    const legend = document.getElementById('category-legend');
    const grandTotal = entries.reduce((s, e) => s + e.total, 0) || 1;
    legend.innerHTML = entries.slice(0, 6).map((e) => `
      <li data-category-id="${e.id}">
        <span class="legend__swatch" style="background:${e.color}"></span>
        <span class="legend__name">${e.label}</span>
        <span class="legend__amount">${currencyShort(e.total)}</span>
      </li>
    `).join('') || '<li class="legend__name">No spending this month</li>';
    legend.ondblclick = (event) => {
      const item = event.target.closest('[data-category-id]');
      if (item) setCategoryFilter(item.dataset.categoryId);
    };
  }

  function setCategoryFilter(categoryId) {
    state.categoryFilter = categoryId;
    state.activeCategories.add(categoryId);
    document.querySelector(`.chip[data-cat="${categoryId}"]`)?.classList.add('is-active');
    updateCategoryFilterControl();
    renderTable();
  }

  function renderUserChart() {
    const allTransactions = TRANSACTIONS[state.month] || [];
    const totals = {};
    allTransactions
      .filter((transaction) => !transaction.hidden && isExpense(transaction))
      .forEach((transaction) => {
        const user = transaction.user || 'Unknown';
        totals[user] = (totals[user] || 0) + Math.abs(transaction.amount);
      });

    const entries = Object.entries(totals)
      .map(([user, total]) => ({ user, total }))
      .filter((entry) => entry.total > 0)
      .sort((a, b) => b.total - a.total);
    const colors = entries.map((_, index) => [cssVar('--accent'), cssVar('--gold'), cssVar('--rose')][index % 3]);
    const ctx = document.getElementById('user-chart');

    if (userChart) userChart.destroy();
    userChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: entries.map((entry) => entry.user),
        datasets: [{
          data: entries.map((entry) => entry.total),
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: cssVar('--surface'),
        }],
      },
      options: {
        cutout: '72%',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${currency(c.raw)}` } } },
        animation: { duration: 250 },
      },
    });

    document.getElementById('user-chart-meta').textContent = `${entries.length} users`;
    document.getElementById('user-legend').innerHTML = entries.map((entry, index) => `
      <li>
        <span class="legend__swatch" style="background:${colors[index]}"></span>
        <span class="legend__name">${entry.user}</span>
        <span class="legend__amount">${currencyShort(entry.total)}</span>
      </li>
    `).join('') || '<li class="legend__name">No spending this month</li>';
  }

  function renderBudgetChart() {
    const totals = categoryTotals(getMonthTransactions(state.month).filter(isExpense));
    const groupNames = ['Dining Out', 'Groceries', 'Housing', 'Shopping', 'Transport', 'Health', 'Extras'];
    const groupColors = {
      'Dining Out': 'var(--cat-dining)',
      Groceries: 'var(--cat-groceries)',
      Housing: 'var(--cat-housing)',
      Shopping: 'var(--cat-shopping)',
      Transport: 'var(--cat-transport)',
      Health: 'var(--cat-health)',
      Extras: 'var(--cat-other)',
    };
    const actualByGroup = {};

    CATEGORIES.filter(isExpense).forEach((category) => {
      const groupName = BUDGET_GROUPS[category.id] || 'Extras';
      actualByGroup[groupName] = (actualByGroup[groupName] || 0) + (totals[category.id] || 0);
    });

    const entries = groupNames.map((name) => ({
      label: name,
      actual: actualByGroup[name] || 0,
      budget: BUDGETS[name] || 0,
      color: groupColors[name],
    }));
    document.getElementById('budget-list').innerHTML = entries.map((entry) => {
      const percentage = entry.budget ? Math.round((entry.actual / entry.budget) * 100) : 0;
      const progress = Math.min(percentage, 100);
      const fillColor = percentage > 100 ? 'var(--rose)' : entry.color;
      return `
        <li class="budget-item">
          <div class="budget-item__header">
            <span class="budget-item__category">${entry.label}</span>
            <span class="budget-item__summary">${currencyShort(entry.actual)} / ${currencyShort(entry.budget)} - ${percentage}%</span>
          </div>
          <div class="budget-item__track" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100" aria-label="${entry.label} budget usage">
            <span class="budget-item__fill" style="width:${progress}%; background:${fillColor}"></span>
          </div>
        </li>
      `;
    }).join('') || '<li class="legend__name">No spending this month</li>';
    document.getElementById('budget-chart-meta').textContent = `${entries.length} groups`;
  }

  // API: replace with `fetch('/api/analytics/trend?months=6')`
  function renderTrendChart() {
    const labels = MONTHS.map((m) => MONTH_LABEL(m.key).split(' ')[0]);
    const data = MONTHS.map((m) => monthTotal(m.key));
    const accent = cssVar('--accent');
    const gridColor = cssVar('--border');
    const textColor = cssVar('--text-faint');

    const ctx = document.getElementById('trend-chart');
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: accent,
          backgroundColor: (c) => {
            const g = c.chart.ctx.createLinearGradient(0, 0, 0, 180);
            g.addColorStop(0, accent + '33');
            g.addColorStop(1, accent + '00');
            return g;
          },
          fill: true,
          tension: 0.35,
          pointRadius: (c) => (labels[c.dataIndex] === MONTH_LABEL(state.month).split(' ')[0] ? 4 : 0),
          pointBackgroundColor: accent,
          pointBorderColor: cssVar('--surface'),
          pointBorderWidth: 2,
          borderWidth: 2,
        }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${currency(c.raw)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, font: { family: 'IBM Plex Mono', size: 11 } } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'IBM Plex Mono', size: 11 }, callback: (v) => currencyShort(v) }, beginAtZero: true },
        },
        animation: { duration: 250 },
      },
    });
  }

  // ---- Transactions table ---------------------------------------------
  function sortTransactions(txs) {
    const { key, dir } = state.sort;
    const mult = dir === 'asc' ? 1 : -1;
    return txs.slice().sort((a, b) => {
      if (key === 'date') return mult * a.date.localeCompare(b.date);
      if (key === 'amount') return mult * (a.amount - b.amount);
      if (key === 'merchant') return mult * a.merchant.localeCompare(b.merchant);
      if (key === 'account') {
        const aLabel = `${accountById[a.account].groupLabel} ${accountById[a.account].bank} ${accountById[a.account].label}`;
        const bLabel = `${accountById[b.account].groupLabel} ${accountById[b.account].bank} ${accountById[b.account].label}`;
        return mult * aLabel.localeCompare(bLabel);
      }
      if (key === 'category') return mult * catById[a.category].label.localeCompare(catById[b.category].label);
      return 0;
    });
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  function renderTable() {
    const txs = sortTransactions(getFilteredTransactions());
    const body = document.getElementById('tx-table-body');
    const empty = document.getElementById('empty-state');

    if (!txs.length) {
      body.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      body.innerHTML = txs.map((t) => {
        const cat = catById[t.category];
        const acc = accountById[t.account];
        const options = CATEGORIES.map((c) =>
          `<option value="${c.id}" ${c.id === t.category ? 'selected' : ''}>${c.label}</option>`
        ).join('');
        return `
          <tr>
            <td class="tx-table__date">${formatDate(t.date)}</td>
            <td class="tx-table__merchant">
              <input type="text" class="merchant-input" data-tx-id="${t.id}" value="${escapeAttr(t.merchant)}" aria-label="Rename merchant">
            </td>
            <td class="tx-table__account">${acc.groupLabel} · ${acc.bank} · ${acc.label}</td>
            <td>
              <span class="category-badge">
                <span class="category-badge__dot" style="background:${cat.color}"></span>
                <select class="category-select" data-tx-id="${t.id}" aria-label="Change category for ${escapeAttr(t.merchant)}">${options}</select>
              </span>
            </td>
            <td class="tx-table__amount">
              <span class="amount-edit">
                <span class="amount-edit__prefix">£</span>
                <input type="number" step="0.01" class="amount-input" data-tx-id="${t.id}" value="${t.amount.toFixed(2)}" aria-label="Edit amount">
              </span>
            </td>
            <td class="exclude-cell">
              <input type="checkbox" class="hide-checkbox" data-tx-id="${t.id}" ${state.selectedTransactionIds.has(t.id) ? 'checked' : ''} aria-label="Select transaction to hide">
            </td>
          </tr>
        `;
      }).join('');
    }

    const total = txs
      .filter(isExpense)
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    document.getElementById('table-count-label').textContent =
      `${txs.length} transaction${txs.length === 1 ? '' : 's'} · ${currency(total)}`;
    updateHideButton();
  }

  function updateHideButton() {
    const button = document.getElementById('hide-selected-button');
    if (!button) return;
    const count = state.selectedTransactionIds.size;
    button.hidden = count === 0;
    button.textContent = count ? `Hide selected (${count})` : 'Hide selected';
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ---- Manual editing: category, merchant name, amount, hide -------------
  function initTableEditing() {
    const body = document.getElementById('tx-table-body');

    body.addEventListener('change', async (e) => {
      const target = e.target;
      const txId = target.dataset.txId;
      if (!txId) return;

      if (target.classList.contains('hide-checkbox')) {
        if (target.checked) state.selectedTransactionIds.add(txId);
        else state.selectedTransactionIds.delete(txId);
        updateHideButton();
        return;
      }

      const monthTxs = TRANSACTIONS[state.month] || [];
      const tx = monthTxs.find((t) => t.id === txId);
      if (!tx) return;

      if (target.classList.contains('category-select')) {
        if (tx.category === target.value) return;

        const previousCategory = tx.category;
        tx.category = target.value;
        renderStats();
        renderCategoryChart();
        renderUserChart();
        renderBudgetChart();
        renderTable();

        try {
          await updateTransactionCategory(txId, target.value);
        } catch (error) {
          console.error('Could not update transaction category:', error);
          tx.category = previousCategory;
          renderStats();
          renderCategoryChart();
          renderUserChart();
          renderBudgetChart();
          renderTable();
        }

      } else if (target.classList.contains('merchant-input')) {
        const newName = target.value.trim();
        if (!newName || tx.merchant === newName) { target.value = tx.merchant; return; }
        const previousMerchant = tx.merchant;
        tx.merchant = newName;
        renderTable();

        try {
          await updateTransactionMerchant(txId, newName);
        } catch (error) {
          console.error('Could not update transaction merchant:', error);
          tx.merchant = previousMerchant;
          renderTable();
        }

      } else if (target.classList.contains('amount-input')) {
        const parsed = Math.round(parseFloat(target.value) * 100) / 100;
        if (!Number.isFinite(parsed)) { target.value = tx.amount.toFixed(2); return; }
        if (tx.amount === parsed) return;
        const previousAmount = tx.amount;
        tx.amount = parsed;
        renderAll();

        try {
          await updateTransactionAmount(txId, parsed);
        } catch (error) {
          console.error('Could not update transaction amount:', error.message || error);
          tx.amount = previousAmount;
          renderAll();
        }

      }
    });

    document.getElementById('hide-selected-button').addEventListener('click', async (e) => {
      const selectedIds = [...state.selectedTransactionIds];
      if (!selectedIds.length) return;

      const button = e.currentTarget;
      button.disabled = true;
      button.textContent = 'Hiding...';
      try {
        await hideTransactions(selectedIds);
        selectedIds.forEach((transactionId) => {
          Object.values(TRANSACTIONS).forEach((transactions) => {
            const transaction = transactions.find((item) => item.id === transactionId);
            if (transaction) transaction.hidden = true;
          });
        });
        state.selectedTransactionIds.clear();
        button.disabled = false;
        renderAll();
      } catch (error) {
        console.error('Could not hide selected transactions:', error);
        button.disabled = false;
        updateHideButton();
      }
    });
  }

  // ---- Chat popup (UI only — wire to POST /api/chat later) ---------------
  function initChat() {
    const fab = document.getElementById('chat-fab');
    const panel = document.getElementById('chat-panel');
    const closeBtn = document.getElementById('chat-close');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    const messages = document.getElementById('chat-messages');

    function open() {
      panel.hidden = false;
      fab.setAttribute('aria-expanded', 'true');
      input.focus();
    }
    function close() {
      panel.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
    }

    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden ? open() : close();
    });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) close();
    });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && !fab.contains(e.target)) close();
    });
    panel.addEventListener('click', (e) => e.stopPropagation());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      appendMessage('user', text);
      input.value = '';

      // API: replace this stub with a call to POST /api/chat
      // const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message: text, history }) });
      const typing = appendTyping();
      setTimeout(() => {
        typing.remove();
        appendMessage('assistant', 'I\u2019m not wired up to the backend yet, so I can\u2019t answer that just yet — but the chat UI is ready to go once /api/chat exists.');
      }, 700);
    });

    function appendMessage(role, text) {
      const div = document.createElement('div');
      div.className = `chat-msg chat-msg--${role}`;
      const p = document.createElement('p');
      p.textContent = text;
      div.appendChild(p);
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
      return div;
    }

    function appendTyping() {
      const div = document.createElement('div');
      div.className = 'chat-msg chat-msg--assistant';
      div.innerHTML = '<span class="chat-typing"><span></span><span></span><span></span></span>';
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
      return div;
    }
  }

  // ---- Init ---------------------------------------------------------------
  function renderAll() {
    renderStats();
    renderCategoryChart();
    renderUserChart();
    renderTrendChart();
    renderBudgetChart();
    renderTable();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await accountsReady;
    if (!TRANSACTIONS[state.month]) state.month = MONTHS[MONTHS.length - 1].key;
    state.activeAccounts = new Set(ACCOUNTS.map((a) => a.id));
    Object.assign(accountById, Object.fromEntries(ACCOUNTS.map((a) => [a.id, a])));
    initTheme();
    initAccountFilter();
    initMonthSelect();
    initCategoryChips();
    initSearch();
    initCategoryFilterControl();
    initSorting();
    initTableEditing();
    initChat();
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    renderAll();
  });
})();
