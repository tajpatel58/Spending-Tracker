/**
 * row-swipe.js
 * ---------------------------------------------------------------------
 * On phones, a transaction row slides left to reveal its actions, like
 * iPhone Mail. The buttons sit just past the row's right edge (see
 * .tx-table__swipe in styles.css), so moving the row brings them in.
 * What they do is up to the table (table.js).
 * ---------------------------------------------------------------------
 */

import { motion } from './motion.js';
import { isPhone } from './sheet.js';

const ACTIONS_WIDTH = 144;  // px: the two buttons together (see .tx-table__swipe)
const LOCK_AT = 10;         // px of movement before deciding: sideways swipe, or a scroll
const FLICK_SPEED = 0.4;    // px/ms: fast enough to open or close whatever the distance
const STRETCH = 0.25;       // how far the row follows the finger past fully open
const HINT_KEY = 'ledger-swipe-hint';

let openRow = null;

/** Slides the open row shut. */
export function closeOpenRow() {
  if (openRow) openRow.style.transform = '';
  openRow = null;
}

/** Once per device, the first row the owner scrolls to shows there's something behind it. */
function hintOnce(body) {
  try { if (localStorage.getItem(HINT_KEY)) return; } catch { return; }
  if (motion.reduced()) return;
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    const row = body.querySelector('tr:not(.tx-group)');
    if (!row) return;
    observer.disconnect();
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* storage unavailable */ }
    row.animate(
      [{ transform: 'none' }, { transform: 'translateX(-56px)', offset: 0.45 }, { transform: 'none' }],
      { duration: 1100, delay: 400, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
    );
  }, { rootMargin: '-35% 0px' });
  observer.observe(body);
}

/** Wires up swiping on the table's rows. */
export function initRowSwipe(body) {
  let swipe = null;

  body.addEventListener('touchstart', (event) => {
    swipe = null;
    if (!isPhone() || event.touches.length !== 1) return;
    const row = event.target.closest('tr:not(.tx-group)');
    if (!row || row.classList.contains('is-editing')) return;
    const touch = event.touches[0];
    swipe = { row, x: touch.clientX, y: touch.clientY, time: event.timeStamp, dx: 0, sideways: null, from: row === openRow ? -ACTIONS_WIDTH : 0 };
  }, { passive: true });

  body.addEventListener('touchmove', (event) => {
    if (!swipe) return;
    const touch = event.touches[0];
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (swipe.sideways === null) {
      if (Math.hypot(dx, dy) < LOCK_AT) return;
      swipe.sideways = Math.abs(dx) > Math.abs(dy) * 1.4;
    }
    if (!swipe.sideways) { swipe = null; return; }
    if (event.cancelable) event.preventDefault();
    if (openRow && openRow !== swipe.row) closeOpenRow();
    swipe.dx = dx;
    const x = Math.min(0, swipe.from + dx);
    swipe.row.style.transition = 'none';
    swipe.row.style.transform = `translateX(${x < -ACTIONS_WIDTH ? -ACTIONS_WIDTH + (x + ACTIONS_WIDTH) * STRETCH : x}px)`;
  }, { passive: false });

  const end = (event) => {
    if (!swipe?.sideways) { swipe = null; return; }
    const { row, dx, from, time } = swipe;
    swipe = null;
    const flicked = Math.abs(dx) / Math.max(1, event.timeStamp - time) > FLICK_SPEED;
    const shouldOpen = flicked ? dx < 0 : from + dx < -ACTIONS_WIDTH / 2;
    row.style.transition = '';
    if (shouldOpen) {
      row.style.transform = `translateX(${-ACTIONS_WIDTH}px)`;
      openRow = row;
    } else {
      row.style.transform = '';
      if (openRow === row) openRow = null;
    }
  };
  body.addEventListener('touchend', end);
  body.addEventListener('touchcancel', end);

  // Touching anywhere but the open row's buttons, or scrolling, shuts it.
  document.addEventListener('touchstart', (event) => {
    if (openRow && !event.target.closest('.tx-table__swipe') && !openRow.contains(event.target)) closeOpenRow();
  }, { capture: true, passive: true });
  window.addEventListener('scroll', closeOpenRow, { passive: true });

  if (isPhone()) hintOnce(body);
}
