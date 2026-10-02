/**
 * table.js
 * ---------------------------------------------------------------------
 * Renders the transactions table and handles in-place editing: changing
 * a category, renaming a merchant, correcting an amount, moving the date
 * (via the pop-over calendar in datepicker.js), or hiding transactions. Edits update the UI immediately, then get saved through
 * transactions-api.js — if the save fails, the edit is rolled back.
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

/** Renders the transactions table body and footer count for the current filters. */
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

/**
 * Moves a transaction to a new date (null = back to the bank's date).
 * If that's a different month, the transaction is re-filed there and
 * drops out of the current view, so a short note says where it went.
 */
async function changeTransactionDate(tx, manualDate) {
  const previousDate = tx.date;
  const hadMonths = MONTHS.length;
  tx.date = manualDate ?? tx.originalDate;
  refileTransaction(tx, previousDate);
  if (MONTHS.length !== hadMonths) renderMonthOptions();
  renderAll();

  const movedMonth = tx.date.slice(0, 7) !== previousDate.slice(0, 7);
  if (movedMonth) showTableNote(`Moved to ${formatDate(tx.date)} · ${MONTH_LABEL(tx.date.slice(0, 7))}`);

  try {
    await updateTransactionDate(tx.id, manualDate);
  } catch (error) {
    console.error('Could not update transaction date:', error.message || error);
    const failedDate = tx.date;
    tx.date = previousDate;
    refileTransaction(tx, failedDate);
    renderAll();
    showTableNote('Could not save the new date', true);
  }
}

/** Shows a brief note in the table footer (e.g. after a transaction moves month). */
function showTableNote(text, isError = false) {
  const note = document.getElementById('table-note');
  note.textContent = text;
  note.classList.toggle('is-error', isError);
  note.hidden = false;
  clearTimeout(showTableNote.timer);
  showTableNote.timer = setTimeout(() => { note.hidden = true; }, 4000);
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
