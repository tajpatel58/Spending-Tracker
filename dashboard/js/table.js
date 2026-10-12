/**
 * table.js
 * ---------------------------------------------------------------------
 * Renders the transactions table and handles in-place editing: changing
 * a category, renaming a merchant, correcting an amount, moving the date
 * (via the pop-over calendar in datepicker.js), or hiding transactions. Edits update the UI immediately, then get saved through
 * transactions-api.js; a toast confirms each one with Undo (toast.js),
 * and if the save fails the edit is rolled back.
 *
 * Kept visually quiet: edit controls appear on row hover, each row's
 * merchant initial doubles as its select-to-hide checkbox, and when
 * sorted by date rows sit under day headings with that day's total.
 * The export button downloads the rows currently shown as a CSV.
 * ---------------------------------------------------------------------
 */

/** Sorts transactions according to `state.sort`. */
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

/**
 * The clickable date shown in a row. `extraClass` distinguishes the
 * desktop date column from the date inside the mobile account line.
 */
function dateButton(t, extraClass) {
  const edited = t.date !== t.originalDate;
  const title = edited ? `Moved from ${formatDate(t.originalDate)} — click to change` : 'Change date';
  return `<button type="button" class="date-button ${extraClass}${edited ? ' is-edited' : ''}" data-tx-id="${t.id}"
    aria-haspopup="dialog" aria-expanded="false" title="${title}" aria-label="Date ${formatDate(t.date)}${edited ? `, moved from ${formatDate(t.originalDate)}` : ''}. Change date">${formatDate(t.date)}</button>`;
}

/** Day heading label: "Today", "Yesterday", else e.g. "Thu 8 Oct". */
function dayHeading(iso) {
  const day = new Date(iso + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Width for an amount input so the £ sits right beside the number (mono font, so 1ch per character). */
const amountWidth = (value) => `${Math.max(4, String(value).length) + 0.5}ch`;

/** One transaction row. */
function transactionRow(t) {
  const cat = catById[t.category];
  const acc = accountById[t.account];
  const options = CATEGORIES.map((c) =>
    `<option value="${c.id}" ${c.id === t.category ? 'selected' : ''}>${c.label}</option>`
  ).join('');
  const selected = state.selectedTransactionIds.has(t.id);
  const initial = (t.merchant.trim()[0] || '?').toUpperCase();
  const amount = t.amount.toFixed(2);
  return `
        <tr class="${selected ? 'is-selected' : ''}">
          <td class="tx-table__select">
            <label class="tx-avatar" style="--avatar-color:${cat.color}" title="Select to hide">
              <input type="checkbox" class="hide-checkbox" data-tx-id="${t.id}" ${selected ? 'checked' : ''} aria-label="Select ${escapeAttr(t.merchant)} to hide">
              <span class="tx-avatar__initial" aria-hidden="true">${escapeAttr(initial)}</span>
              <svg class="tx-avatar__check" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path class="draw-tick" pathLength="1" d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </label>
          </td>
          <td class="tx-table__date">${dateButton(t, 'date-button--column')}</td>
          <td class="tx-table__merchant">
            <input type="text" class="merchant-input" data-tx-id="${t.id}" value="${escapeAttr(t.merchant)}" aria-label="Rename merchant">
          </td>
          <td class="tx-table__account"><span class="tx-table__meta-date">${dateButton(t, 'date-button--meta')} · </span>${acc.groupLabel} · ${acc.bank}<span class="tx-table__account-id"> · ${acc.label}</span></td>
          <td class="tx-table__category">
            <span class="category-badge">
              <span class="category-badge__dot" style="background:${cat.color}"></span>
              <span class="category-badge__label">${cat.label}</span>
              <select class="category-select" data-tx-id="${t.id}" aria-label="Change category for ${escapeAttr(t.merchant)}">${options}</select>
            </span>
          </td>
          <td class="tx-table__amount">
            <span class="amount-edit">
              <span class="amount-edit__prefix">£</span>
              <input type="number" step="0.01" class="amount-input" data-tx-id="${t.id}" value="${amount}" style="width:${amountWidth(amount)}" aria-label="Edit amount">
            </span>
          </td>
        </tr>
      `;
}

/** Renders the transactions table body and footer count for the current filters. */
function renderTable() {
  const txs = sortTransactions(getFilteredTransactions());
  const body = document.getElementById('tx-table-body');
  const empty = document.getElementById('empty-state');
  const grouped = state.sort.key === 'date';
  document.querySelector('.tx-table').classList.toggle('is-grouped', grouped);
  document.querySelector('.tx-table').classList.toggle('has-selection', state.selectedTransactionIds.size > 0);

  if (!txs.length) {
    body.innerHTML = '';
    empty.hidden = false;
    // Filters hiding everything get a one-click way out; an empty month just says so.
    const filtered = state.search || state.categories.size || state.users.size;
    document.getElementById('empty-state-title').textContent = filtered ? 'No transactions found' : 'No transactions this month';
    document.getElementById('empty-state-hint').textContent = filtered
      ? 'Try a different search or clear your filters.'
      : 'Upload a statement to see this month\'s spending.';
    document.getElementById('empty-clear-filters').hidden = !filtered;
  } else {
    empty.hidden = true;
    const rows = [];
    txs.forEach((t, i) => {
      // Sorted by date: start a day heading (with that day's spend) whenever the date changes.
      if (grouped && t.date !== txs[i - 1]?.date) {
        const daySpend = txs.filter((x) => x.date === t.date && isExpense(x)).reduce((s, x) => s + Math.abs(x.amount), 0);
        rows.push(`
        <tr class="tx-group">
          <td colspan="6">
            <span class="tx-group__day">${dayHeading(t.date)}</span>
            <span class="tx-group__total">${daySpend ? currency(daySpend) : ''}</span>
          </td>
        </tr>`);
      }
      rows.push(transactionRow(t));
    });
    body.innerHTML = rows.join('');
  }

  const total = txs
    .filter(isExpense)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  document.getElementById('table-count-label').textContent =
    `${txs.length} transaction${txs.length === 1 ? '' : 's'} · ${currency(total)}`;
  updateHideButton();
}

/** Shows/hides the "Hide selected" button and updates its label with the selection count. */
function updateHideButton() {
  const button = document.getElementById('hide-selected-button');
  if (!button) return;
  const count = state.selectedTransactionIds.size;
  button.hidden = count === 0;
  button.textContent = count ? `Hide selected (${count})` : 'Hide selected';
}

/**
 * Wires up editing within the transactions table: selecting a category,
 * renaming a merchant, correcting an amount, and the hide-selected flow.
 */
function initTableEditing() {
  const body = document.getElementById('tx-table-body');

  // Keep amount inputs snug to their £ as they're edited.
  body.addEventListener('input', (e) => {
    if (e.target.classList.contains('amount-input')) e.target.style.width = amountWidth(e.target.value);
  });

  body.addEventListener('change', async (e) => {
    const target = e.target;
    const txId = target.dataset.txId;
    if (!txId) return;

    if (target.classList.contains('hide-checkbox')) {
      if (target.checked) state.selectedTransactionIds.add(txId);
      else state.selectedTransactionIds.delete(txId);
      target.closest('tr').classList.toggle('is-selected', target.checked);
      document.querySelector('.tx-table').classList.toggle('has-selection', state.selectedTransactionIds.size > 0);
      updateHideButton();
      return;
    }

    const monthTxs = TRANSACTIONS[state.month] || [];
    const tx = monthTxs.find((t) => t.id === txId);
    if (!tx) return;

    if (target.classList.contains('category-select')) {
      const previous = tx.category;
      const next = target.value;
      if (previous === next) return;
      const rerender = () => { renderStats(); renderCategoryChart(); renderUserChart(); renderBudgetChart(); renderTable(); };
      editWithUndo({
        apply: () => { tx.category = next; rerender(); },
        revert: () => { tx.category = previous; rerender(); },
        save: () => updateTransactionCategory(txId, next),
        unsave: () => updateTransactionCategory(txId, previous),
        message: `Moved ${tx.merchant} to ${catById[next].label}`,
      });

    } else if (target.classList.contains('merchant-input')) {
      const previous = tx.merchant;
      const next = target.value.trim();
      if (!next || previous === next) { target.value = previous; return; }
      editWithUndo({
        apply: () => { tx.merchant = next; renderTable(); },
        revert: () => { tx.merchant = previous; renderTable(); },
        save: () => updateTransactionMerchant(txId, next),
        unsave: () => updateTransactionMerchant(txId, previous),
        message: `Renamed ${previous} to ${next}`,
      });

    } else if (target.classList.contains('amount-input')) {
      const next = Math.round(parseFloat(target.value) * 100) / 100;
      if (!Number.isFinite(next)) { target.value = tx.amount.toFixed(2); return; }
      const previous = tx.amount;
      if (previous === next) return;
      editWithUndo({
        apply: () => { tx.amount = next; renderAll(); },
        revert: () => { tx.amount = previous; renderAll(); },
        save: () => updateTransactionAmount(txId, next),
        unsave: () => updateTransactionAmount(txId, previous),
        message: `${tx.merchant} changed to ${currency(Math.abs(next))}`,
      });
    }
  });

  body.addEventListener('click', (e) => {
    const button = e.target.closest('.date-button');
    if (!button) return;
    const tx = (TRANSACTIONS[state.month] || []).find((t) => t.id === button.dataset.txId);
    if (!tx) return;
    openDatePicker({
      anchor: button,
      value: tx.date,
      original: tx.originalDate,
      onSelect: (manualDate) => changeTransactionDate(tx, manualDate),
    });
  });

  document.getElementById('hide-selected-button').addEventListener('click', (e) => {
    const selectedIds = [...state.selectedTransactionIds];
    if (!selectedIds.length) return;
    const setHidden = (hidden) => selectedIds.forEach((transactionId) => {
      Object.values(TRANSACTIONS).forEach((transactions) => {
        const transaction = transactions.find((item) => item.id === transactionId);
        if (transaction) transaction.hidden = hidden;
      });
    });

    editWithUndo({
      apply: () => { setHidden(true); state.selectedTransactionIds.clear(); renderAll(); },
      revert: () => { setHidden(false); renderAll(); },
      save: () => hideTransactions(selectedIds),
      unsave: () => unhideTransactions(selectedIds),
      message: `${selectedIds.length} transaction${selectedIds.length === 1 ? '' : 's'} hidden`,
      failMessage: "Couldn't hide those transactions",
    });
  });
}

/**
 * Moves a transaction to a new date (null = back to the bank's date). If
 * that's a different month it's re-filed there and drops out of the
 * current view, so the toast says where it went.
 */
function changeTransactionDate(tx, manualDate) {
  const previousDate = tx.date;
  const previousManual = previousDate === tx.originalDate ? null : previousDate;
  const nextDate = manualDate ?? tx.originalDate;
  if (nextDate === previousDate) return;

  const moveTo = (date) => {
    const from = tx.date;
    const hadMonths = MONTHS.length;
    tx.date = date;
    refileTransaction(tx, from);
    if (MONTHS.length !== hadMonths) renderMonthOptions();
    renderAll();
  };
  const otherMonth = nextDate.slice(0, 7) !== previousDate.slice(0, 7);
  editWithUndo({
    apply: () => moveTo(nextDate),
    revert: () => moveTo(previousDate),
    save: () => updateTransactionDate(tx.id, manualDate),
    unsave: () => updateTransactionDate(tx.id, previousManual),
    message: `${tx.merchant} moved to ${formatDate(nextDate)}${otherMonth ? ` · ${MONTH_LABEL(nextDate.slice(0, 7))}` : ''}`,
  });
}

/**
 * Applies an edit straight away, saves it, and shows a toast with Undo.
 * If the save fails the edit is rolled back and an error toast explains.
 * Undo reverses it on screen and in Supabase (waiting for the save first).
 */
function editWithUndo({ apply, revert, save, unsave, message, failMessage = "Couldn't save that change" }) {
  apply();
  const saving = save();
  showToast({
    message,
    action: {
      label: 'Undo',
      onClick: async () => {
        revert();
        try {
          await saving.catch(() => {}); // nothing to undo server-side if the save itself failed
          await unsave();
          saveDataCache();
          showToast({ message: 'Change undone', tone: 'info', duration: 2500 });
        } catch (error) {
          console.error('Could not undo the change:', error);
          apply();
          showToast({ message: "Couldn't undo — the change was kept", tone: 'error' });
        }
      },
    },
  });
  saving.then(saveDataCache, (error) => {
    console.error('Could not save the change:', error);
    revert();
    showToast({ message: `${failMessage} — it's been reverted`, tone: 'error' });
  });
}

/** Quotes a value for CSV when it contains a comma, quote or newline. */
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Downloads the transactions currently shown in the table (filters, search and sort applied) as a CSV. */
function exportTableCsv() {
  const txs = sortTransactions(getFilteredTransactions());
  const header = ['Date', 'Merchant', 'User', 'Bank', 'Account', 'Category', 'Amount'];
  const rows = txs.map((t) => {
    const acc = accountById[t.account];
    return [t.date, t.merchant, acc.groupLabel, acc.bank, acc.label, catById[t.category].label, t.amount.toFixed(2)];
  });
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

  // The BOM makes Excel read the file as UTF-8 (e.g. for £ or accented merchants).
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions-${state.month}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Wires up the table's export button. */
function initTableExport() {
  document.getElementById('export-table').addEventListener('click', exportTableCsv);
}
