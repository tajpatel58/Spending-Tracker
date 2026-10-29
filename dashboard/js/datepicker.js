/**
 * datepicker.js
 * ---------------------------------------------------------------------
 * A small pop-over month calendar for picking a date. One shared
 * instance; call openDatePicker() with the element it should sit next
 * to. Used by table.js to change a transaction's date, and by trips.js
 * for a new trip's dates.
 *
 *   openDatePicker({
 *     anchor,          // element to position against
 *     value,           // current date, 'YYYY-MM-DD' ('' for none yet)
 *     original,        // optional: the bank's date — marked, with a reset link when different
 *     min,             // optional: the earliest date that can be picked, 'YYYY-MM-DD'
 *     container,       // optional: the element the picker lives in (a modal <dialog>,
 *                      //   whose outside can't be clicked while it's open); default <body>
 *     onSelect(date),  // called with 'YYYY-MM-DD', or null for "reset to original"
 *   });
 *
 * Imports nothing that loads data, so pages without the dashboard's data
 * (the Trips page) can use it too.
 * ---------------------------------------------------------------------
 */

import { formatDate } from './format.js';

/** "October 2026" for a month key ('2026-10'). */
const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

/** Shifts a month key by n months, e.g. ('2026-01', -1) -> '2025-12'. */
function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Today as 'YYYY-MM-DD' (local time). */
function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const datePicker = {
  el: null,
  options: null,
  viewMonth: null, // 'YYYY-MM' currently shown
};

/** Draws the pop-over month grid. */
function renderDatePicker() {
  const { value, original, min } = datePicker.options;
  const key = datePicker.viewMonth;
  const [y, m] = key.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday = 0
  const today = todayIso();

  const days = Array.from({ length: firstWeekday }, () => '<span aria-hidden="true"></span>');
  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = `${key}-${String(d).padStart(2, '0')}`;
    const classes = [
      'datepicker__day',
      iso === value ? 'is-selected' : '',
      iso === original ? 'is-original' : '',
      iso === today ? 'is-today' : '',
    ].filter(Boolean).join(' ');
    days.push(`<button type="button" class="${classes}" data-date="${iso}" aria-pressed="${iso === value}"${min && iso < min ? ' disabled' : ''}
      aria-label="${new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${iso === original ? ' (original date)' : ''}">${d}</button>`);
  }

  const edited = original && value !== original;
  datePicker.el.innerHTML = `
    <div class="datepicker__header">
      <span class="datepicker__title">${monthLabel(key)}</span>
      <div class="datepicker__controls">
        <button type="button" class="datepicker__nav" data-shift="-1" aria-label="Previous month">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="datepicker__nav" data-shift="1" aria-label="Next month">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6 4.5 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <span class="datepicker__divider" aria-hidden="true"></span>
        <button type="button" class="datepicker__close" aria-label="Close">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>
    <div class="datepicker__weekdays" aria-hidden="true"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
    <div class="datepicker__grid">${days.join('')}</div>
    ${original ? `<div class="datepicker__footer">
      <span class="datepicker__original"><span class="datepicker__original-dot" aria-hidden="true"></span>Bank date ${formatDate(original)}</span>
      ${edited ? '<button type="button" class="datepicker__reset">Reset</button>' : ''}
    </div>` : ''}
  `;
}

/** Places the picker below its anchor (or above, if there's no room), kept on screen. */
function positionDatePicker() {
  const { anchor } = datePicker.options;
  const rect = anchor.getBoundingClientRect();
  const pick = datePicker.el.getBoundingClientRect();
  const gap = 6;
  const spaceBelow = window.innerHeight - rect.bottom;
  const below = spaceBelow >= pick.height + gap * 2 || spaceBelow >= rect.top;
  const top = below
    ? Math.min(rect.bottom + gap, window.innerHeight - pick.height - gap)
    : Math.max(gap, rect.top - gap - pick.height);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - pick.width - 8);
  datePicker.el.style.top = `${top}px`;
  datePicker.el.style.left = `${left}px`;
}

function closeDatePicker() {
  if (!datePicker.el || datePicker.el.hidden) return;
  datePicker.el.hidden = true;
  datePicker.options?.anchor.setAttribute('aria-expanded', 'false');
  datePicker.options = null;
}

export function openDatePicker(options) {
  if (!datePicker.el) initDatePicker();
  if (datePicker.options?.anchor === options.anchor) { closeDatePicker(); return; } // second click toggles shut
  closeDatePicker();
  datePicker.options = options;
  (options.container || document.body).appendChild(datePicker.el);
  datePicker.viewMonth = (options.value || options.min || todayIso()).slice(0, 7);
  options.anchor.setAttribute('aria-expanded', 'true');
  renderDatePicker();
  datePicker.el.hidden = false;
  positionDatePicker();
  datePicker.el.querySelector('.datepicker__day.is-selected')?.focus({ preventScroll: true });
}

/** Creates the shared pop-over element and its event handlers (once). */
function initDatePicker() {
  const el = document.createElement('div');
  el.className = 'datepicker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Choose date');
  el.hidden = true;
  document.body.appendChild(el);
  datePicker.el = el;

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const shift = e.target.closest('[data-shift]');
    if (shift) {
      datePicker.viewMonth = shiftMonth(datePicker.viewMonth, Number(shift.dataset.shift));
      renderDatePicker();
      positionDatePicker();
      return;
    }
    if (e.target.closest('.datepicker__close')) {
      const { anchor } = datePicker.options;
      closeDatePicker();
      anchor.focus({ preventScroll: true });
      return;
    }
    const day = e.target.closest('.datepicker__day:not(:disabled)');
    const reset = e.target.closest('.datepicker__reset');
    if (!day && !reset) return;
    const { onSelect, value, original, anchor } = datePicker.options;
    const picked = reset ? null : day.dataset.date;
    closeDatePicker();
    anchor.focus({ preventScroll: true });
    // Picking the bank's own date is the same as clearing the override.
    const next = picked === original ? null : picked;
    if ((next ?? original) !== value) onSelect(next);
  });

  document.addEventListener('click', (e) => {
    if (datePicker.options && !datePicker.options.anchor.contains(e.target)) closeDatePicker();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !datePicker.options) return;
    e.preventDefault(); // close just the picker, not a <dialog> it sits in
    const { anchor } = datePicker.options;
    closeDatePicker();
    anchor.focus({ preventScroll: true });
  });
  window.addEventListener('resize', closeDatePicker);
  window.addEventListener('scroll', () => { if (datePicker.options) positionDatePicker(); }, { passive: true, capture: true });
}
