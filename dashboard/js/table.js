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
 * category icon doubles as its select-to-hide checkbox, and when
 * sorted by date rows sit under day headings with that day's total.
 * The export button downloads the rows currently shown as a CSV.
 * ---------------------------------------------------------------------
 */

import { categoryIcon } from './category-icons.js';
import {
  CATEGORIES,
  MONTH_LABEL,
  MONTHS,
  refileTransaction,
  saveDataCache,
  TRANSACTIONS,
} from './data.js';
import { openDatePicker } from './datepicker.js';
import { renderMonthOptions } from './filters.js';
import { currency, escapeAttr, formatDate } from './format.js';
import { scheduleRender } from './main.js';
import { accountById, catById, getFilteredTransactions, isExpense, state } from './state.js';
import { showToast } from './toast.js';
import {
  hideTransactions,
  unhideTransactions,
  updateTransactionAmount,
  updateTransactionCategory,
  updateTransactionDate,
  updateTransactionMerchant,
} from './transactions-api.js';

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

/** Day heading label: "Today", "Yesterday", else e.g. "Thursday 8 October". */
function dayHeading(iso) {
  const day = new Date(iso + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Every category as <option>s, built once. A row's select holds only its own
// category until it's pressed or focused (fillCategorySelect), so a month's
// table isn't rebuilt with fifteen options per row on every search keystroke.
const CATEGORY_OPTIONS = CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');

/** Gives a row's category select the full list, still showing its category, just before it opens. */
function fillCategorySelect(select) {
  if (select.options.length > 1) return;
  const current = select.value;
  select.innerHTML = CATEGORY_OPTIONS;
  select.value = current;
}

/**
 * A select is as wide as its longest option, so with only its own category
 * a row's would size to that one. The full list's width is measured once
 * (again when the fonts arrive) and set on the table, keeping every
 * select, and its chevron, where the full list puts them.
 */
function sizeCategorySelects(table) {
  const measure = () => {
    const probe = document.createElement('select');
    probe.className = 'category-select';
    probe.innerHTML = CATEGORY_OPTIONS;
    probe.style.cssText = 'position:absolute;visibility:hidden;width:auto';
    table.parentElement.appendChild(probe);
    table.style.setProperty('--category-select-width', `${probe.getBoundingClientRect().width}px`);
    probe.remove();
  };
  measure();
  document.fonts?.ready.then(measure);
}

/** One transaction row. */
function transactionRow(t) {
  const cat = catById[t.category];
  const acc = accountById[t.account];
  const options = `<option value="${t.category}" selected>${cat.label}</option>`;
  const selected = state.selectedTransactionIds.has(t.id);
  const amount = t.amount.toFixed(2);
  return `
        <tr class="${selected ? 'is-selected' : ''}">
          <td class="tx-table__select">
            <label class="tx-avatar" style="--avatar-color:${cat.color}" title="Select to hide">
              <input type="checkbox" class="hide-checkbox" data-tx-id="${t.id}" ${selected ? 'checked' : ''} aria-label="Select ${escapeAttr(t.merchant)} to hide">
              <span class="tx-avatar__icon" aria-hidden="true">${categoryIcon(t.category)}</span>
              <svg class="tx-avatar__check" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path class="draw-tick" pathLength="1" d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </label>
          </td>
          <td class="tx-table__merchant">
            <input type="text" class="merchant-input" data-tx-id="${t.id}" value="${escapeAttr(t.merchant)}" aria-label="Rename merchant">
          </td>
          <td class="tx-table__date">${dateButton(t, 'date-button--column')}</td>
          <td class="tx-table__account"><span class="tx-table__meta-date">${dateButton(t, 'date-button--meta')} · </span>${acc.groupLabel} · ${acc.bank}<span class="tx-table__account-id"> · ${acc.label}</span></td>
          <td class="tx-table__category">
            <span class="category-badge">
              <span class="category-badge__dot" style="background:${cat.color}"></span>
              <span class="category-badge__label">${cat.label}</span>
              <select class="category-select" data-tx-id="${t.id}" aria-label="Change category for ${escapeAttr(t.merchant)}">${options}</select>
            </span>
          </td>
          <td class="tx-table__amount">
            <!-- The typeset amount ("−£60.72"); the number field sits over it
                 and only shows while it's being edited. -->
            <span class="amount-edit${t.amount > 0 ? ' is-credit' : ''}">
              <span class="amount-display" aria-hidden="true">${t.amount > 0 ? '+' : ''}${currency(t.amount)}</span>
              <input type="number" step="0.01" class="amount-input" data-tx-id="${t.id}" value="${amount}" aria-label="Edit amount">
            </span>
          </td>
        </tr>
      `;
}

// The table's focusable controls, each tagged with its transaction's data-tx-id.
const ROW_CONTROLS = ['merchant-input', 'amount-input', 'category-select', 'hide-checkbox', 'date-button--column', 'date-button--meta'];

/**
 * Notes which row control has focus (and the caret in a text field), so
 * the table can be rebuilt without dropping it: after an edit, Tab lands
 * on the next field and a click on another field stays there, as if
 * nothing was redrawn (see the deferred edit in initTableEditing).
 */
function captureTableFocus(body) {
  const el = document.activeElement;
  if (!el || !body.contains(el) || !el.dataset.txId) return null;
  const control = ROW_CONTROLS.find((name) => el.classList.contains(name));
  if (!control) return null;
  let caret = null;
  try { caret = el.selectionStart === null ? null : [el.selectionStart, el.selectionEnd]; } catch { /* not a text field */ }
  return { id: el.dataset.txId, control, caret };
}

/** Puts focus (and the caret) back on a control noted by captureTableFocus, if its row is still shown. */
function restoreTableFocus(body, saved) {
  if (!saved) return;
  const el = body.querySelector(`.${saved.control}[data-tx-id="${CSS.escape(saved.id)}"]`);
  if (!el) return; // the row was filtered out or hidden
  el.focus({ preventScroll: true });
  if (saved.caret) try { el.setSelectionRange(...saved.caret); } catch { /* e.g. number inputs */ }
}

/** Renders the transactions table body and footer count for the current filters. */
export function renderTable() {
  const txs = sortTransactions(getFilteredTransactions());
  const body = document.getElementById('tx-table-body');
  const empty = document.getElementById('empty-state');
  const grouped = state.sort.key === 'date';
  const focus = captureTableFocus(body);
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
      : 'Nothing has come through for this month yet.';
    document.getElementById('empty-clear-filters').hidden = !filtered;
  } else {
    empty.hidden = true;
    // Each day's spend, worked out in one pass for the day headings.
    const spendByDay = new Map();
    if (grouped) txs.filter(isExpense).forEach((x) => spendByDay.set(x.date, (spendByDay.get(x.date) || 0) + Math.abs(x.amount)));
    const rows = [];
    txs.forEach((t, i) => {
      // Sorted by date: start a day heading (with that day's spend) whenever the date changes.
      if (grouped && t.date !== txs[i - 1]?.date) {
        const daySpend = spendByDay.get(t.date) || 0;
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
    restoreTableFocus(body, focus);
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
export function initTableEditing() {
  const body = document.getElementById('tx-table-body');
  sizeCategorySelects(body.closest('table'));

  // The full category list goes in just before a select opens: pressed (mouse or touch) or reached by keyboard.
  const fill = (e) => { if (e.target.classList?.contains('category-select')) fillCategorySelect(e.target); };
  body.addEventListener('pointerdown', fill);
  body.addEventListener('focusin', fill);

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

    // Applied a tick later: `change` fires as focus leaves the field, once the browser has
    // picked where Tab or a click is sending it. Rebuilding the table now would destroy that
    // element and drop focus to the page; a tick later focus has landed, and renderTable
    // puts it back on the rebuilt copy (captureTableFocus).
    await new Promise((resolve) => setTimeout(resolve, 0));

    const monthTxs = TRANSACTIONS[state.month] || [];
    const tx = monthTxs.find((t) => t.id === txId);
    if (!tx) return;

    if (target.classList.contains('category-select')) {
      const previous = tx.category;
      const next = target.value;
      if (previous === next) return;
      const rerender = () => scheduleRender('stats', 'category', 'user', 'budget', 'table');
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
        apply: () => { tx.merchant = next; scheduleRender('table'); },
        revert: () => { tx.merchant = previous; scheduleRender('table'); },
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
        apply: () => { tx.amount = next; scheduleRender(); },
        revert: () => { tx.amount = previous; scheduleRender(); },
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
    // Looked up on each call (one pass over the data), so an undo after a sync still finds them.
    const selected = new Set(selectedIds);
    const setHidden = (hidden) => Object.values(TRANSACTIONS).forEach((transactions) => {
      transactions.forEach((transaction) => { if (selected.has(transaction.id)) transaction.hidden = hidden; });
    });

    editWithUndo({
      apply: () => { setHidden(true); state.selectedTransactionIds.clear(); scheduleRender(); },
      revert: () => { setHidden(false); scheduleRender(); },
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
    scheduleRender();
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
export function initTableExport() {
  document.getElementById('export-table').addEventListener('click', exportTableCsv);
}
