/**
 * budget-editor.js
 * ---------------------------------------------------------------------
 * The Overview's monthly budgets: loading them from the Supabase
 * `monthly_budgets` table (budgets-api.js) into MONTHLY_BUDGETS, and
 * editing them in place on the Budget vs Actual tile: its pencil turns
 * each budget group's bar into a gauge to drag (budget-sliders.js), for
 * the month on show; each month keeps its own budgets, and a month never edited uses
 * the defaults in state.js BUDGETS. A copy is kept on this device so the
 * first draw already has them.
 * ---------------------------------------------------------------------
 */

import { budgetEditHeader, budgetSliders, endBudgetEditHeader, endBudgetSliders } from './budget-sliders.js';
import { fetchMonthlyBudgets, saveMonthlyBudgets } from './budgets-api.js';
import { MONTH_LABEL } from './data.js';
import { currencyShort } from './format.js';
import { scheduleRender } from './main.js';
import { motion } from './motion.js';
import { BUDGET_GROUP_COLORS, budgetGroupActuals, BUDGETS, budgetsFor, MONTHLY_BUDGETS, state } from './state.js';
import { showToast } from './toast.js';

const BUDGETS_CACHE_KEY = 'ledger-monthly-budgets'; // also cleared on sign-out (auth.js clearLocalData)

const sum = (values) => values.reduce((s, v) => s + v, 0);

/** Replaces MONTHLY_BUDGETS with `budgets` ({ '2026-10': {...} }) and keeps a copy on this device. */
function storeBudgets(budgets) {
  Object.keys(MONTHLY_BUDGETS).forEach((month) => delete MONTHLY_BUDGETS[month]);
  Object.assign(MONTHLY_BUDGETS, budgets);
  try { localStorage.setItem(BUDGETS_CACHE_KEY, JSON.stringify(MONTHLY_BUDGETS)); } catch { /* storage unavailable */ }
}

/**
 * Fills MONTHLY_BUDGETS from this device's copy straight away, then
 * fetches the saved budgets from Supabase and redraws the budget parts
 * of the page if they've changed. A failed fetch (no table yet, say)
 * leaves the defaults in place and says so quietly.
 */
export function loadMonthlyBudgets() {
  try {
    const cached = JSON.parse(localStorage.getItem(BUDGETS_CACHE_KEY));
    if (cached && typeof cached === 'object') Object.assign(MONTHLY_BUDGETS, cached);
  } catch { /* storage unavailable, or nothing kept yet */ }

  fetchMonthlyBudgets()
    .then((budgets) => {
      const changed = JSON.stringify(budgets) !== JSON.stringify(MONTHLY_BUDGETS);
      storeBudgets(budgets);
      if (changed && !editing) scheduleRender('stats', 'budget');
    })
    .catch((error) => {
      console.error('[Ledger] Could not load the monthly budgets:', error);
      showToast({ message: `Using the default budgets. ${describeError(error)}`, tone: 'info' });
    });
}

let editing = false;

/** Ends an edit (renderBudgetChart redraws the bars in its place). */
export function closeBudgetEditor() {
  editing = false;
  endBudgetSliders(document.getElementById('budget-list'));
  endBudgetEditHeader(document.querySelector('.chart-tile--budget'));
}

/**
 * The pencil on Budget vs Actual: every group's bar becomes a gauge with
 * a knob to drag and its amount to type (budget-sliders.js), and the
 * header shows the total adding up with Cancel and Save, over a line
 * offering Reset to defaults (BUDGETS). Save (or Enter) updates the page
 * straight away and the month's row in `monthly_budgets`, with Undo;
 * Cancel or Escape leaves it as it was. Nothing is saved while sliding.
 */
export function initBudgetEditor() {
  const tile = document.querySelector('.chart-tile--budget');
  const list = document.getElementById('budget-list');
  let month = null;
  let sliders = null;

  const cancel = () => {
    closeBudgetEditor();
    scheduleRender('budget');
  };
  const save = () => {
    closeBudgetEditor();
    setMonthBudgets(month, sliders.values());
  };

  const open = () => {
    month = state.month;
    const budgets = budgetsFor(month);
    const actualByGroup = budgetGroupActuals(month);
    const showTotal = budgetEditHeader(tile,
      `${MONTH_LABEL(month)} only · <button type="button" class="tile-link" data-reset-budget>Reset to defaults</button>`);
    sliders = budgetSliders(list, Object.keys(BUDGETS).map((group) => ({
      key: group,
      label: group,
      color: BUDGET_GROUP_COLORS[group],
      value: budgets[group],
      spent: actualByGroup[group] || 0,
      fallback: BUDGETS[group],
    })), { onInput: showTotal, onSubmit: save, onCancel: cancel });
    editing = true;
    showTotal(sum(Object.values(budgets)));
    tile.scrollIntoView({ behavior: motion.reduced() ? 'auto' : 'smooth', block: 'nearest' });
    list.querySelector('input[type="range"]').focus({ preventScroll: true });
  };

  tile.addEventListener('click', (event) => {
    if (event.target.closest('[data-edit-budget]')) open();
    else if (event.target.closest('[data-cancel-budget]')) cancel();
    else if (event.target.closest('[data-save-budget]')) save();
    else if (event.target.closest('[data-reset-budget]')) sliders.set(BUDGETS);
  });
}

/** Sets a month's budgets on the page and in Supabase, with Undo; puts them back if the save fails. */
function setMonthBudgets(month, next) {
  const had = month in MONTHLY_BUDGETS;
  const previous = budgetsFor(month);
  const apply = (budgets) => {
    MONTHLY_BUDGETS[month] = budgets;
    scheduleRender('stats', 'budget');
  };
  const restore = () => {
    if (had) MONTHLY_BUDGETS[month] = previous;
    else delete MONTHLY_BUDGETS[month];
    scheduleRender('stats', 'budget');
  };
  const keepCopy = () => storeBudgets({ ...MONTHLY_BUDGETS });

  apply(next);
  if (had && Object.keys(BUDGETS).every((g) => next[g] === previous[g])) return;

  const saving = saveMonthlyBudgets(month, next).then(keepCopy);
  showToast({
    message: `Budgets for ${MONTH_LABEL(month)} saved · ${currencyShort(sum(Object.values(next)))} in all`,
    action: {
      label: 'Undo',
      onClick: async () => {
        restore();
        try {
          await saving.catch(() => {}); // nothing to undo server-side if the save itself failed
          await saveMonthlyBudgets(month, previous); // a month that had no row keeps one, holding the defaults
          keepCopy();
          showToast({ message: 'Change undone', tone: 'info', duration: 2500 });
        } catch (error) {
          console.error('[Ledger] Could not undo the budgets:', error);
          apply(next);
          showToast({ message: 'Couldn’t undo — the change was kept', tone: 'error' });
        }
      },
    },
  });
  saving.catch((error) => {
    console.error('[Ledger] Could not save the budgets:', error);
    restore();
    showToast({ message: `Couldn’t save the budgets — they’ve been put back. ${describeError(error)}`, tone: 'error' });
  });
}

/** Why a load or save failed, in words (a missing table or RLS policy is the likely cause while setting up). */
function describeError(error) {
  const message = error?.message || '';
  if (error?.code === 'NO_ROWS' || error?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Supabase turned this away: the monthly_budgets table needs row-level security policies that allow select, insert and update.';
  }
  if (error?.code === '42P01' || error?.code === 'PGRST205' || /does not exist|could not find the table/i.test(message)) {
    return 'There’s no monthly_budgets table in Supabase yet.';
  }
  return message || 'Something went wrong.';
}
