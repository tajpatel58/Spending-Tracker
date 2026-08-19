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
    month: MONTHS[MONTHS.length - 1].key, // most recent month by default
    activeCategories: new Set(CATEGORIES.map((c) => c.id)), // all active
    activeAccounts: new Set(), // populated after accounts.csv loads
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
    renderTrendChart();
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

  // ---- Account multiselect (which accounts we're looking at) -------------
  // Grouped by owner (You / Wife / Joint); checking a group selects all of
  // that owner's accounts, and the group checkbox reflects a tri-state
  // (all / none / some) based on its sub-accounts.
  function initAccountFilter() {
    const wrap = document.getElementById('account-filter');
    const button = document.getElementById('account-filter-button');
    const label = document.getElementById('account-filter-label');
    const panel = document.getElementById('account-filter-panel');

    panel.innerHTML = ACCOUNT_GROUPS.map((g) => `
      <div class="multiselect__group" data-group="${g.id}">
        <label class="multiselect__option multiselect__option--group">
          <input type="checkbox" class="js-group-checkbox" data-group="${g.id}" checked>
          ${g.label}
        </label>
        <div class="multiselect__suboptions">
          ${g.accounts.map((a) => `
            <label class="multiselect__option multiselect__option--sub">
              <input type="checkbox" class="js-account-checkbox" data-group="${g.id}" value="${a.id}" checked>
              ${a.label}
            </label>
          `).join('')}
        </div>
      </div>
    `).join('') + `
      <div class="multiselect__divider"></div>
      <button type="button" class="multiselect__clear" id="account-filter-select-all">Select all</button>
    `;

    function updateLabel() {
      const n = state.activeAccounts.size;
      if (n === ACCOUNTS.length) label.textContent = 'All accounts';
      else if (n === 0) label.textContent = 'No accounts';
      else if (n === 1) label.textContent = accountById[[...state.activeAccounts][0]].label;
      else label.textContent = `${n} accounts selected`;
    }

    function updateGroupCheckboxState(groupId) {
      const groupCb = panel.querySelector(`.js-group-checkbox[data-group="${groupId}"]`);
      const subCbs = [...panel.querySelectorAll(`.js-account-checkbox[data-group="${groupId}"]`)];
      const checkedCount = subCbs.filter((cb) => cb.checked).length;
      groupCb.checked = checkedCount === subCbs.length;
      groupCb.indeterminate = checkedCount > 0 && checkedCount < subCbs.length;
    }

    function open() {
      panel.hidden = false;
      wrap.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
    }
    function close() {
      panel.hidden = true;
      wrap.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
    }

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden ? open() : close();
    });

    panel.addEventListener('click', (e) => {
      if (e.target.id === 'account-filter-select-all') {
        state.activeAccounts = new Set(ACCOUNTS.map((a) => a.id));
        panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = true; cb.indeterminate = false; });
        updateLabel();
        renderAll();
        return;
      }
      e.stopPropagation();
    });

    panel.addEventListener('change', (e) => {
      const cb = e.target;
      if (cb.type !== 'checkbox') return;

      if (cb.classList.contains('js-group-checkbox')) {
        // Checking/unchecking a user selects or clears all of their accounts.
        const groupId = cb.dataset.group;
        const subCbs = [...panel.querySelectorAll(`.js-account-checkbox[data-group="${groupId}"]`)];
        subCbs.forEach((sub) => {
          sub.checked = cb.checked;
          if (cb.checked) state.activeAccounts.add(sub.value);
          else state.activeAccounts.delete(sub.value);
        });
        cb.indeterminate = false;
      } else if (cb.classList.contains('js-account-checkbox')) {
        if (cb.checked) state.activeAccounts.add(cb.value);
        else state.activeAccounts.delete(cb.value);
        updateGroupCheckboxState(cb.dataset.group);
      }

      updateLabel();
      renderAll();
    });

    document.addEventListener('click', (e) => {
      if (!panel.hidden && !wrap.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) close();
    });

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
    return all.filter((t) => state.activeAccounts.has(t.account));
  }

  // Transactions that actually feed the stats/charts — same as above, minus
  // anything the user has manually excluded (e.g. a third-party's share of
  // a split bill).
  function getCalcTransactions(month) {
    return getMonthTransactions(month).filter((t) => !t.excluded);
  }

  function getFilteredTransactions() {
    return getMonthTransactions(state.month)
      .filter((t) => state.activeCategories.has(t.category))
      .filter((t) => !state.search || t.merchant.toLowerCase().includes(state.search));
  }

  function categoryTotals(txs) {
    const totals = {};
    txs.forEach((t) => { totals[t.category] = (totals[t.category] || 0) + t.amount; });
    return totals;
  }

  function monthTotal(month) {
    return getCalcTransactions(month).reduce((sum, t) => sum + t.amount, 0);
  }

  // ---- Stat tiles ---------------------------------------------------------
  // API: replace with `fetch(`/api/analytics/summary?month=${month}`)`
  function renderStats() {
    const txs = getCalcTransactions(state.month);
    const total = txs.reduce((s, t) => s + t.amount, 0);

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

    const totals = categoryTotals(txs);
    const topId = Object.keys(totals).sort((a, b) => totals[b] - totals[a])[0];
    document.getElementById('stat-top-category').textContent = topId ? catById[topId].label : '—';
    document.getElementById('stat-top-category-amount').textContent = topId ? currency(totals[topId]) : '—';

    document.getElementById('stat-count').textContent = txs.length;
    const avg = txs.length ? total / txs.length : 0;
    document.getElementById('stat-avg').textContent = txs.length ? `${currency(avg)} avg / transaction` : '—';

    const [y, m] = state.month.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    document.getElementById('stat-daily-avg').textContent = currency(total / dim);
    document.getElementById('stat-daily-note').textContent = `Across ${dim} days`;

    document.getElementById('page-subtitle').textContent = `Spending summary — ${MONTH_LABEL(state.month)}`;
  }

  // ---- Charts ---------------------------------------------------------
  let categoryChart, trendChart;
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // API: replace totals with `fetch(`/api/analytics/summary?month=${month}`)`
  function renderCategoryChart() {
    const txs = getCalcTransactions(state.month);
    const totals = categoryTotals(txs);
    const entries = CATEGORIES
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

    document.getElementById('category-chart-meta').textContent = `${entries.length} categories`;

    const legend = document.getElementById('category-legend');
    const grandTotal = entries.reduce((s, e) => s + e.total, 0) || 1;
    legend.innerHTML = entries.slice(0, 6).map((e) => `
      <li>
        <span class="legend__swatch" style="background:${e.color}"></span>
        <span class="legend__name">${e.label}</span>
        <span class="legend__amount">${currencyShort(e.total)}</span>
      </li>
    `).join('') || '<li class="legend__name">No spending this month</li>';
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
        const aLabel = `${accountById[a.account].groupLabel} ${accountById[a.account].label}`;
        const bLabel = `${accountById[b.account].groupLabel} ${accountById[b.account].label}`;
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
          <tr class="${t.excluded ? 'is-excluded' : ''}">
            <td class="tx-table__date">${formatDate(t.date)}</td>
            <td class="tx-table__merchant">
              <input type="text" class="merchant-input" data-tx-id="${t.id}" value="${escapeAttr(t.merchant)}" aria-label="Rename merchant">
            </td>
            <td class="tx-table__account">${acc.groupLabel} · ${acc.label}</td>
            <td>
              <span class="category-badge">
                <span class="category-badge__dot" style="background:${cat.color}"></span>
                <select class="category-select" data-tx-id="${t.id}" aria-label="Change category for ${escapeAttr(t.merchant)}">${options}</select>
              </span>
            </td>
            <td class="tx-table__amount">
              <span class="amount-edit">
                <span class="amount-edit__prefix">£</span>
                <input type="number" step="0.01" min="0" class="amount-input" data-tx-id="${t.id}" value="${t.amount.toFixed(2)}" aria-label="Edit amount">
              </span>
            </td>
            <td class="exclude-cell">
              <input type="checkbox" class="exclude-checkbox" data-tx-id="${t.id}" ${t.excluded ? 'checked' : ''} aria-label="Exclude from calculations">
            </td>
          </tr>
        `;
      }).join('');
    }

    const includedTxs = txs.filter((t) => !t.excluded);
    const excludedCount = txs.length - includedTxs.length;
    const total = includedTxs.reduce((s, t) => s + t.amount, 0);
    const excludedNote = excludedCount ? ` · ${excludedCount} excluded` : '';
    document.getElementById('table-count-label').textContent =
      `${txs.length} transaction${txs.length === 1 ? '' : 's'} · ${currency(total)}${excludedNote}`;
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ---- Manual editing: category, merchant name, amount, exclude ----------
  function initTableEditing() {
    const body = document.getElementById('tx-table-body');

    body.addEventListener('change', async (e) => {
      const target = e.target;
      const txId = target.dataset.txId;
      if (!txId) return;

      const monthTxs = TRANSACTIONS[state.month] || [];
      const tx = monthTxs.find((t) => t.id === txId);
      if (!tx) return;

      if (target.classList.contains('category-select')) {
        if (tx.category === target.value) return;

        const previousCategory = tx.category;
        tx.category = target.value;
        renderStats();
        renderCategoryChart();
        renderTable();

        try {
          await updateTransactionCategory(txId, target.value);
        } catch (error) {
          console.error('Could not update transaction category:', error);
          tx.category = previousCategory;
          renderStats();
          renderCategoryChart();
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
        if (isNaN(parsed) || parsed < 0) { target.value = tx.amount.toFixed(2); return; }
        if (tx.amount === parsed) return;
        const previousAmount = tx.amount;
        tx.amount = parsed;
        renderAll();

        try {
          await updateTransactionAmount(txId, parsed);
        } catch (error) {
          console.error('Could not update transaction amount:', error);
          tx.amount = previousAmount;
          renderAll();
        }

      } else if (target.classList.contains('exclude-checkbox')) {
        // API: `fetch(`/api/transactions/${txId}`, { method: 'PATCH', body: JSON.stringify({ excluded: target.checked }) })`
        tx.excluded = target.checked;
        renderAll();
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
    renderTrendChart();
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
    initSorting();
    initTableEditing();
    initChat();
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    renderAll();
  });
})();
