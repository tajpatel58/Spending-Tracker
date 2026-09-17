/**
 * format.js
 * ---------------------------------------------------------------------
 * Small formatting helpers shared by the rendering code.
 * ---------------------------------------------------------------------
 */

/** Formats a number as GBP with 2 decimal places, e.g. "£1,234.56". */
const currency = (n) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Formats a number as GBP rounded to the nearest pound, e.g. "£1,235". */
const currencyShort = (n) => `£${Math.round(n).toLocaleString('en-GB')}`;

/** Formats an ISO date ('2026-08-14') as "14 Aug". */
function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Escapes a string for safe use inside an HTML attribute. */
function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Reads a CSS custom property (e.g. '--accent') off the page. */
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
