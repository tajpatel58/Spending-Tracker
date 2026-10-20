/**
 * main.js
 * ---------------------------------------------------------------------
 * Entry point — read this file first to see how everything fits
 * together. Waits for accounts + transactions to finish loading, wires
 * up every control on the page, then does the first render.
 * ---------------------------------------------------------------------
 */

import { initPageHeading, initUserMenu, signOut } from './auth.js';
import {
  initCategoryDrill,
  initUserDrill,
  renderBudgetChart,
  renderCategoryChart,
  renderTrendChart,
  renderUserChart,
} from './charts.js';
import { ACCOUNTS, accountsReady, MONTHS, pageSession, TRANSACTIONS } from './data.js';
import {
  initAccountFilter,
  initMonthSelect,
  initSearch,
  initSorting,
  initTableFilters,
  pageHooks,
  renderMonthOptions,
} from './filters.js';
import { indexEvents } from './forecast.js';
import { accountById, finishLoading, showLoadError, state } from './state.js';
import { initBudgetStrip, initPaceFixedToggle, renderStats } from './stats.js';
import { initSync } from './sync.js';
import { initTableEditing, initTableExport, renderTable } from './table.js';
import { initTheme, toggleTheme } from './theme.js';

// Each part of the dashboard, in the order a full render draws them.
const RENDERERS = {
  stats: () => renderStats(),
  category: () => renderCategoryChart(),
  user: () => renderUserChart(),
  trend: () => renderTrendChart(),
  budget: () => renderBudgetChart(),
  table: () => renderTable(),
};
const pendingRender = new Set();
let renderFrame = 0;

/**
 * Re-renders every part of the dashboard from the current state, straight
 * away (month changes need that, to animate between the two months).
 * Anything already waiting in scheduleRender is drawn by this too.
 */
function renderAll() {
  cancelAnimationFrame(renderFrame);
  renderFrame = 0;
  pendingRender.clear();
  Object.values(RENDERERS).forEach((render) => render());
}

/**
 * Re-renders just the named parts (all of them when none are named) on the
 * next frame. Edits, undos and saves can each ask for a redraw several
 * times in quick succession; they share one, and only what changed is drawn.
 *   scheduleRender('table')   — a merchant renamed
 */
export function scheduleRender(...parts) {
  (parts.length ? parts : Object.keys(RENDERERS)).forEach((part) => pendingRender.add(part));
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    const due = new Set(pendingRender);
    pendingRender.clear();
    Object.entries(RENDERERS).forEach(([part, render]) => { if (due.has(part)) render(); });
  });
}

// The shared month/account/table filters redraw through these (filters.js).
pageHooks.renderAll = renderAll;
pageHooks.renderTable = () => renderTable();

document.addEventListener('DOMContentLoaded', async () => {
  // Applied before the auth check resolves so the loading placeholders
  // match the visitor's theme instead of flashing light-then-dark.
  initTheme();

  // Straight away when this device has a copy of the data; otherwise after the auth check (data.js).
  const session = await pageSession;
  if (!session) return; // signed out/unauthorized — auth.js is already redirecting to login.html

  // Wired up before the data-dependent init so signing out remains available
  // even if loading accounts or transactions fails.
  initUserMenu(session);
  initPageHeading(session);
  document.getElementById('signout-button').addEventListener('click', signOut);

  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  try {
    await accountsReady;
    if (!TRANSACTIONS[state.month]) state.month = MONTHS[MONTHS.length - 1].key;
    state.activeAccounts = new Set(ACCOUNTS.map((a) => a.id));
    Object.assign(accountById, Object.fromEntries(ACCOUNTS.map((a) => [a.id, a])));

    indexEvents(); // the trend chart's forecast uses upcoming calendar events
    initAccountFilter();
    initMonthSelect();
    initTableFilters();
    initSearch();
    initSorting();
    initTableEditing();
    initTableExport();
    initCategoryDrill();
    initUserDrill();
    initBudgetStrip();
    initPaceFixedToggle();

    renderAll();
    finishLoading();
    // The charts hold theme colours, so they redraw when light/dark changes (theme.js).
    document.addEventListener('ledger:theme-changed', () => {
      renderCategoryChart();
      renderUserChart();
      renderTrendChart();
      renderBudgetChart();
    });
    initSync({
      onChange: () => {
        indexEvents();
        if (!TRANSACTIONS[state.month]) state.month = MONTHS[MONTHS.length - 1].key;
        renderMonthOptions();
        renderAll();
      },
    });
  } catch (error) {
    showLoadError(error);
  }
});
