/**
 * format.js
 * ---------------------------------------------------------------------
 * Small formatting helpers shared by the rendering code.
 * ---------------------------------------------------------------------
 */

/** A true minus sign (U+2212), set in place of a hyphen before negative figures. */
export const MINUS = '\u2212';

// One formatter per style: toLocaleString builds a new one on every call,
// and the table alone formats hundreds of values each time it's drawn.
const POUNDS_AND_PENCE = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WHOLE_POUNDS = new Intl.NumberFormat('en-GB');

/** Wraps a one-argument formatter so each distinct value is only worked out once. */
export function remembered(format) {
  const results = new Map();
  return (value) => {
    if (!results.has(value)) results.set(value, format(value));
    return results.get(value);
  };
}

/** Formats a number as GBP with 2 decimal places, e.g. "£1,234.56" or "−£1,234.56". */
export const currency = (n) => `${n < 0 ? MINUS : ''}£${POUNDS_AND_PENCE.format(Math.abs(n))}`;

/** Formats a number as GBP rounded to the nearest pound, e.g. "£1,235" or "−£1,235". */
export const currencyShort = (n) => `${Math.round(n) < 0 ? MINUS : ''}£${WHOLE_POUNDS.format(Math.abs(Math.round(n)))}`;

/** A number with fixed decimals and a true minus sign, e.g. signedFixed(-1.25, 1) -> "−1.3". */
export const signedFixed = (n, digits) => n.toFixed(digits).replace('-', MINUS);

/**
 * HTML for a headline money figure: the pence drop to a smaller, raised,
 * quieter size, and the £ sign is set small and raised beside the figure, e.g.
 * "£1,234.56" -> <span class="money__sym">£</span>1,234<span class="money__pence">.56</span>.
 * Takes the already formatted string (from currency()), so the text reads
 * the same to screen readers and copy/paste.
 */
export const moneyMarkup = (text) => text
  .replace('£', '<span class="money__sym">£</span>')
  .replace(/(\.\d+)(?!.*\d)/, '<span class="money__pence">$1</span>');

/** Formats an ISO date ('2026-08-14') as "14 Aug". */
export const formatDate = remembered((iso) => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
});

/** Escapes a string for safe use inside an HTML attribute. */
export function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Reads a CSS custom property (e.g. '--accent') off the page. */
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
