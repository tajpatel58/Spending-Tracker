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
  // Applied before the auth check resolves so the loading screen below
  // matches the visitor's theme instead of flashing light-then-dark.
  initTheme();

  const session = await authReady;
  if (!session) return; // signed out/unauthorized — auth.js is already redirecting to login.html

  // The auth/access check passed — safe to reveal the dashboard now.
  document.getElementById('auth-loading').remove();

  // Wired up before the data-dependent init so signing out remains available
  // even if loading accounts or transactions fails.
  initUserMenu(session);
  document.getElementById('signout-button').addEventListener('click', signOut);

  await accountsReady;
  if (!TRANSACTIONS[state.month]) state.month = MONTHS[MONTHS.length - 1].key;
  state.activeAccounts = new Set(ACCOUNTS.map((a) => a.id));
  Object.assign(accountById, Object.fromEntries(ACCOUNTS.map((a) => [a.id, a])));

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
