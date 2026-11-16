/**
 * discreet.js
 * ---------------------------------------------------------------------
 * Discreet mode: every money figure reads "£•••", for when someone else
 * can see the screen. A row in the account menu switches it (auth.js
 * initUserMenu), as does quick find, and the choice is remembered on this
 * device.
 *
 * The figures are masked where they're formatted (currency and
 * currencyShort in format.js), so tiles, tables, chart tooltips and
 * chart axes are all covered, on every page. Switching it sends
 * `ledger:discreet-changed`, and each page redraws itself on that.
 * Percentages, bars and chart shapes are left as they are.
 * ---------------------------------------------------------------------
 */

const STORAGE_KEY = 'ledger-discreet';

let discreet = false;
try { discreet = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage unavailable */ }

/** What a money figure reads as while discreet mode is on. */
export const MASKED = '£•••';

/** True while figures are hidden. */
export const isDiscreet = () => discreet;

/** Marks the page, so the account menu's eye icon follows it (styles.css). */
function syncDiscreet() {
  document.documentElement.toggleAttribute('data-discreet', discreet);
}

/** Hides or shows every money figure, and has the page redraw. */
export function toggleDiscreet() {
  discreet = !discreet;
  try { localStorage.setItem(STORAGE_KEY, discreet ? '1' : '0'); } catch { /* storage unavailable */ }
  syncDiscreet();
  document.dispatchEvent(new CustomEvent('ledger:discreet-changed', { detail: { discreet } }));
}

syncDiscreet(); // before the first figures are drawn
