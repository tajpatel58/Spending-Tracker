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
  syncThemeColor();
}

/** Matches the browser / iPhone status-bar colour to the page background. */
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
}

/** Switches between light and dark theme and redraws the charts to match. */
function toggleTheme() {
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduced) { applyTheme(); return; }

  // The new theme spreads out in a circle from the toggle button.
  const button = document.getElementById('theme-toggle')?.getBoundingClientRect();
  const x = button ? button.left + button.width / 2 : window.innerWidth - 40;
  const y = button ? button.top + button.height / 2 : 40;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.classList.add('theme-transition');
  const transition = document.startViewTransition(applyTheme);
  transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 560, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
  transition.finished.finally(() => root.classList.remove('theme-transition'));
}

/** Flips light/dark, remembers it, and redraws anything drawn with theme colours. */
function applyTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ledger-theme', next);
  syncThemeColor();
  // Charts read CSS custom properties into fixed colors at creation time,
  // so redraw them on theme change to pick up the new palette. Not every
  // page that uses this toggle (e.g. login.html) has charts to redraw.
  if (typeof renderCategoryChart === 'function') renderCategoryChart();
  if (typeof renderUserChart === 'function') renderUserChart();
  if (typeof renderTrendChart === 'function') renderTrendChart();
  if (typeof renderBudgetChart === 'function') renderBudgetChart();
}
