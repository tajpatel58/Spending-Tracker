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
import { isDiscreet } from './discreet.js';
import { renderMonthOptions, setSearch } from './filters.js';
import { currency, escapeAttr, formatDate, remembered } from './format.js';
import { scheduleRender } from './main.js';
import { openMenu } from './menu.js';
import { closeOpenRow, initRowSwipe } from './row-swipe.js';
import { isPhone } from './sheet.js';
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
function dateButton(t, extraClass, attrs = '') {
  const edited = t.date !== t.originalDate;
  const title = edited ? `Moved from ${formatDate(t.originalDate)} — click to change` : 'Change date';
  return `<button type="button" class="date-button ${extraClass}${edited ? ' is-edited' : ''}" data-tx-id="${t.id}"${attrs}
    aria-haspopup="dialog" aria-expanded="false" title="${title}" aria-label="Date ${formatDate(t.date)}${edited ? `, moved from ${formatDate(t.originalDate)}` : ''}. Change date">${formatDate(t.date)}</button>`;
}

/** A date in full, e.g. "Thursday 8 October". */
const longDate = remembered((iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));

/** Day heading label: "Today", "Yesterday", else e.g. "Thursday 8 October". */
function dayHeading(iso) {
  const day = new Date(iso + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return longDate(iso);
}

// Every category as a menu item, built once.
const CATEGORY_ITEMS = CATEGORIES.map((c) => ({ value: c.id, label: c.label, color: c.color, icon: categoryIcon(c.id) }));

// Phones: rows read as plain text, and the one being edited (from its Edit action) has its fields switched on.
let editingRowId = null;

/**
 * True with a mouse or trackpad on a wider screen: there a row's name, date and
 * amount are plain text until "Edit" in its right-click menu switches them on
 * (the same rule as "Editing from the right-click menu" in styles.css). Phones
 * use the swipe actions; other touch screens edit in place.
 */
const editsFromMenu = () => !isPhone() && window.matchMedia('(hover: hover)').matches;

/** One transaction row. */
function transactionRow(t) {
  // Where editing starts from the right-click menu, a row's fields stay out of the Tab order until then.
  const locked = editsFromMenu() && t.id !== editingRowId ? ' tabindex="-1"' : '';
  const cat = catById[t.category];
  const acc = accountById[t.account];
  const selected = state.selectedTransactionIds.has(t.id);
  const amount = t.amount.toFixed(2);
  return `
        <tr class="${selected ? 'is-selected' : ''}${t.id === editingRowId ? ' is-editing' : ''}">
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
            <input type="text" class="merchant-input" data-tx-id="${t.id}"${locked} value="${escapeAttr(t.merchant)}" aria-label="Rename merchant">
          </td>
          <td class="tx-table__date">${dateButton(t, 'date-button--column', locked)}</td>
          <td class="tx-table__account"><span class="tx-table__meta-date">${dateButton(t, 'date-button--meta')} · </span>${acc.groupLabel} · ${acc.bank}<span class="tx-table__account-id"> · ${acc.label}</span></td>
          <td class="tx-table__category">
            <span class="category-badge">
              <span class="category-badge__dot" style="background:${cat.color}"></span>
              <span class="category-badge__label">${cat.label}</span>
              <button type="button" class="category-select" data-tx-id="${t.id}" aria-haspopup="listbox" aria-expanded="false" aria-label="Change category for ${escapeAttr(t.merchant)}, currently ${cat.label}">${cat.label}</button>
            </span>
          </td>
          <!-- Before the amount: the table pads its last cell, so this (hidden on larger screens) mustn't be it. -->
          <td class="tx-table__swipe">
            <button type="button" class="tx-swipe tx-swipe--edit" data-swipe="edit" data-row="${t.id}" aria-label="Edit ${escapeAttr(t.merchant)}">Edit</button>
            <button type="button" class="tx-swipe tx-swipe--hide" data-swipe="hide" data-row="${t.id}" aria-label="Hide ${escapeAttr(t.merchant)}">Hide</button>
          </td>
          <td class="tx-table__amount">
            <!-- The typeset amount ("−£60.72"); the number field sits over it
                 and only shows while it's being edited (not at all in discreet mode). -->
            <span class="amount-edit${t.amount > 0 ? ' is-credit' : ''}">
              <span class="amount-display" aria-hidden="true">${t.amount > 0 ? '+' : ''}${currency(t.amount)}</span>
              <input type="number" step="0.01" class="amount-input" data-tx-id="${t.id}" value="${amount}" aria-label="Edit amount"${locked}${isDiscreet() ? ' disabled' : ''}>
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
    // Roughly the table's height, assumed while it's off screen and not laid out, so the scrollbar stays honest.
    body.closest('.table-scroll').style.containIntrinsicHeight = `auto ${rows.length * 60}px`;
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
  initRowSwipe(body);

  /** Hides transactions (with Undo). Looked up on each call (one pass over the data), so an undo after a sync still finds them. */
  const hideWithUndo = (ids) => {
    const chosen = new Set(ids);
    const setHidden = (hidden) => Object.values(TRANSACTIONS).forEach((transactions) => {
      transactions.forEach((transaction) => { if (chosen.has(transaction.id)) transaction.hidden = hidden; });
    });
    editWithUndo({
      apply: () => { setHidden(true); ids.forEach((id) => state.selectedTransactionIds.delete(id)); scheduleRender(); },
      revert: () => { setHidden(false); scheduleRender(); },
      save: () => hideTransactions(ids),
      unsave: () => unhideTransactions(ids),
      message: `${ids.length} transaction${ids.length === 1 ? '' : 's'} hidden`,
      failMessage: "Couldn't hide those transactions",
    });
  };

  /** Switches a row's fields on (its name, amount and date) and puts the caret at the end of its name. */
  const startEditing = (row, txId) => {
    body.querySelector('tr.is-editing')?.classList.remove('is-editing');
    editingRowId = txId;
    row.classList.add('is-editing');
    row.querySelectorAll('[tabindex="-1"]').forEach((control) => control.removeAttribute('tabindex'));
    const merchant = row.querySelector('.merchant-input');
    merchant.focus({ preventScroll: true });
    merchant.setSelectionRange(merchant.value.length, merchant.value.length);
  };

  // A row's swipe actions (row-swipe.js): Edit switches its fields on, Hide hides it.
  body.addEventListener('click', (e) => {
    const action = e.target.closest('[data-swipe]');
    if (!action) return;
    const row = action.closest('tr');
    closeOpenRow();
    if (action.dataset.swipe === 'hide') { hideWithUndo([action.dataset.row]); return; }
    startEditing(row, action.dataset.row);
  });
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('tr.is-editing')) e.target.blur();
  });
  // Leaving the row switches its fields back off. A tick later, as saving rebuilds the table and puts focus back.
  // Not while its date is being changed: the row is still in use while it's being pressed (Safari doesn't
  // give a clicked button focus, so the name field's blur would otherwise lock the date before the click
  // lands) and while its date picker is open.
  let pressingRow = false;
  const leaveEditing = () => setTimeout(() => {
    if (!editingRowId || pressingRow) return;
    const row = body.querySelector('tr.is-editing');
    const focused = document.activeElement;
    if (focused?.closest('tr.is-editing, .datepicker') || row?.querySelector('.date-button[aria-expanded="true"]')) return;
    editingRowId = null;
    row?.classList.remove('is-editing');
    if (editsFromMenu()) row?.querySelectorAll('.merchant-input, .amount-input, .date-button--column').forEach((control) => { control.tabIndex = -1; });
  });
  body.addEventListener('focusout', leaveEditing);
  body.addEventListener('pointerdown', (e) => { pressingRow = Boolean(e.target.closest('tr.is-editing')); });
  // A click anywhere ends a press; one outside the row (which also closes its date picker) ends the edit.
  document.addEventListener('click', () => { pressingRow = false; leaveEditing(); });
  document.addEventListener('pointercancel', () => { pressingRow = false; });

  /** Moves a transaction to another category (with Undo). */
  const changeCategory = (txId, next) => {
    const tx = (TRANSACTIONS[state.month] || []).find((t) => t.id === txId);
    if (!tx || tx.category === next) return;
    const previous = tx.category;
    const rerender = () => scheduleRender('stats', 'category', 'user', 'budget', 'table');
    editWithUndo({
      apply: () => { tx.category = next; rerender(); },
      revert: () => { tx.category = previous; rerender(); },
      save: () => updateTransactionCategory(txId, next),
      unsave: () => updateTransactionCategory(txId, previous),
      message: `Moved ${tx.merchant} to ${catById[next].label}`,
    });
  };

  body.addEventListener('click', (e) => {
    const button = e.target.closest('.category-select');
    if (!button) return;
    const { txId } = button.dataset;
    const tx = (TRANSACTIONS[state.month] || []).find((t) => t.id === txId);
    if (!tx) return;
    openMenu({
      anchor: button,
      label: `Category for ${tx.merchant}`,
      value: tx.category,
      items: CATEGORY_ITEMS,
      onSelect: (next) => changeCategory(txId, next),
    });
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

    // Applied a tick later: `change` fires as focus leaves the field, once the browser has
    // picked where Tab or a click is sending it. Rebuilding the table now would destroy that
    // element and drop focus to the page; a tick later focus has landed, and renderTable
    // puts it back on the rebuilt copy (captureTableFocus).
    await new Promise((resolve) => setTimeout(resolve, 0));

    const monthTxs = TRANSACTIONS[state.month] || [];
    const tx = monthTxs.find((t) => t.id === txId);
    if (!tx) return;

    if (target.classList.contains('merchant-input')) {
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

  // Right-click a row (mouse and trackpad): its actions in one menu, at the pointer.
  // There, "Edit" is the only way into a row's name, date and amount (its category
  // keeps its dropdown). Shift+right-click, or a field being typed in, keeps the
  // browser's own menu.
  const icon = (paths) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths}</svg>`;
  const ROW_ACTIONS = [
    { value: 'only', icon: icon('<circle cx="11" cy="11" r="6.5" stroke="currentColor"/><path d="M20 20l-4.2-4.2" stroke="currentColor"/>') },
    { value: 'edit', label: 'Edit', icon: icon('<path d="M4.5 19.5l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3l-10 10-4 1.5ZM13.5 7l3 3" stroke="currentColor"/>') },
    { value: 'hide', label: 'Hide', tone: 'danger', icon: icon('<path d="M4 4l16 16M9.9 5.3A9.6 9.6 0 0 1 12 5c5.2 0 8.5 4.6 9.3 7a11 11 0 0 1-2.6 3.9M6.4 6.9A11.6 11.6 0 0 0 2.7 12c.8 2.4 4.1 7 9.3 7a9.3 9.3 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor"/>') },
  ];
  body.addEventListener('contextmenu', (e) => {
    if (e.shiftKey || !editsFromMenu()) return;
    if (e.target.matches('.merchant-input, .amount-input') && e.target === document.activeElement) return;
    const row = e.target.closest('tr');
    const txId = row?.querySelector('.hide-checkbox')?.dataset.txId; // a day heading has none
    const tx = txId && (TRANSACTIONS[state.month] || []).find((t) => t.id === txId);
    if (!tx) return;
    e.preventDefault();
    openMenu({
      anchor: row,
      point: { x: e.clientX, y: e.clientY },
      label: `Actions for ${tx.merchant}`,
      items: ROW_ACTIONS.map((action) => ({
        ...action,
        label: action.value === 'only' ? `Show only ${tx.merchant}` : action.label,
        color: action.tone === 'danger' ? 'var(--rose)' : 'var(--text-muted)',
      })),
      onSelect: (action) => {
        if (action === 'only') setSearch(tx.merchant);
        else if (action === 'hide') hideWithUndo([txId]);
        else if (action === 'edit') {
          // The table may have been redrawn since the menu opened: find the row again.
          const current = body.querySelector(`.hide-checkbox[data-tx-id="${CSS.escape(txId)}"]`)?.closest('tr');
          if (current) startEditing(current, txId);
        }
      },
    });
  });
  // Esc in a row being edited puts the field back as it was and leaves it.
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !e.target.matches('.merchant-input, .amount-input') || !e.target.closest('tr.is-editing')) return;
    e.target.value = e.target.defaultValue;
    e.target.blur();
  });

  document.getElementById('hide-selected-button').addEventListener('click', () => {
    const selectedIds = [...state.selectedTransactionIds];
    if (selectedIds.length) hideWithUndo(selectedIds);
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
