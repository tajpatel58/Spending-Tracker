/**
 * format.js
 * ---------------------------------------------------------------------
 * Small formatting helpers shared by the rendering code.
 * ---------------------------------------------------------------------
 */

/** A true minus sign (U+2212), set in place of a hyphen before negative figures. */
const MINUS = '\u2212';

/** Formats a number as GBP with 2 decimal places, e.g. "£1,234.56" or "−£1,234.56". */
const currency = (n) => `${n < 0 ? MINUS : ''}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Formats a number as GBP rounded to the nearest pound, e.g. "£1,235" or "−£1,235". */
const currencyShort = (n) => `${Math.round(n) < 0 ? MINUS : ''}£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;

/** A number with fixed decimals and a true minus sign, e.g. signedFixed(-1.25, 1) -> "−1.3". */
const signedFixed = (n, digits) => n.toFixed(digits).replace('-', MINUS);

/**
 * HTML for a headline money figure: the pence drop to a smaller, raised,
 * quieter size, and the £ sign is set small and raised beside the figure, e.g.
 * "£1,234.56" -> <span class="money__sym">£</span>1,234<span class="money__pence">.56</span>.
 * Takes the already formatted string (from currency()), so the text reads
 * the same to screen readers and copy/paste.
 */
const moneyMarkup = (text) => text
  .replace('£', '<span class="money__sym">£</span>')
  .replace(/(\.\d+)(?!.*\d)/, '<span class="money__pence">$1</span>');

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
