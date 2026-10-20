/**
 * main.js
 * ---------------------------------------------------------------------
 * Entry point — read this file first to see how everything fits
 * together. Waits for accounts + transactions to finish loading, wires
 * up every control on the page, then does the first render.
 * ---------------------------------------------------------------------
 */

/** Re-renders every part of the dashboard from the current state. */
function renderAll() {
  renderStats();
  renderCategoryChart();
  renderUserChart();
  renderTrendChart();
  renderBudgetChart();
  renderTable();
}

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
