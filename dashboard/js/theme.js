/**
 * theme.js
 * ---------------------------------------------------------------------
 * Light/dark theme toggle. The chosen theme is remembered in
 * localStorage so it persists across visits.
 * ---------------------------------------------------------------------
 */

/** Applies the saved theme (or the OS preference, if nothing is saved) on page load. */
function initTheme() {
  const saved = localStorage.getItem('ledger-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
}

/** Switches between light and dark theme and redraws the charts to match. */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ledger-theme', next);
  // Charts read CSS custom properties into fixed colors at creation time,
  // so redraw them on theme change to pick up the new palette. Not every
  // page that uses this toggle (e.g. login.html) has charts to redraw.
  if (typeof renderCategoryChart === 'function') renderCategoryChart();
  if (typeof renderUserChart === 'function') renderUserChart();
  if (typeof renderTrendChart === 'function') renderTrendChart();
  if (typeof renderBudgetChart === 'function') renderBudgetChart();
}
