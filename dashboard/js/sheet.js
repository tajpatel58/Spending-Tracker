/**
 * sheet.js
 * ---------------------------------------------------------------------
 * On phones, a floating panel opens as a bottom sheet: it slides up from
 * the bottom of the screen, within thumb reach, over a dimmed page. Tap
 * the page or drag the sheet down to close it.
 *
 * asSheet(panel, close) watches the panel's `hidden` attribute, so the
 * code that owns the panel opens and closes it as it always has. While
 * open, the panel lives directly in <body> (a sticky header or frosted
 * card would otherwise trap it), and goes back to its place when closed.
 * Above the phone width, asSheet does nothing.
 * ---------------------------------------------------------------------
 */

const phone = window.matchMedia('(max-width: 560px)');

/** True when floating panels open as sheets. */
export const isPhone = () => phone.matches;

const CLOSE_MS = 280;   // the slide away (see .is-sheet in styles.css)
const DRAG_START = 6;   // px of movement before a touch counts as a drag
const DISMISS_PX = 90;  // px dragged down that closes the sheet
const DISMISS_SPEED = 0.6; // or a flick this fast (px/ms)

let scrim = null;
let current = null; // the open sheet: { panel, close }
const presented = new Map(); // panel -> { marker, timer }, while it's a sheet (closing included)

function showScrim() {
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.className = 'sheet-scrim';
    scrim.addEventListener('click', () => current?.close());
    // The page behind stays put while a sheet is open.
    scrim.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
    document.body.append(scrim);
  }
  void scrim.offsetWidth; // so the fade runs from its starting point
  scrim.classList.add('is-visible');
}

function present(panel, close) {
  const already = presented.get(panel);
  if (already) {
    clearTimeout(already.timer); // reopened as it was closing
  } else {
    const marker = document.createComment('sheet');
    panel.before(marker);
    const focused = document.activeElement;
    document.body.append(panel); // moving an element drops its focus, so it's put back
    if (panel.contains(focused)) focused.focus({ preventScroll: true });
    panel.classList.add('is-sheet');
    presented.set(panel, { marker, timer: 0 });
  }
  current = { panel, close };
  // The page recedes from the middle of what's on screen, not the middle of the whole page.
  const main = document.querySelector('main');
  if (main) document.documentElement.style.setProperty('--sheet-origin', `${window.innerHeight / 2 - main.getBoundingClientRect().top}px`);
  document.documentElement.classList.add('has-sheet');
  showScrim();
}

function dismiss(panel) {
  const state = presented.get(panel);
  if (!state) return;
  if (current?.panel === panel) current = null;
  document.documentElement.classList.remove('has-sheet');
  scrim?.classList.remove('is-visible');
  panel.style.transform = '';
  panel.style.transition = '';
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    panel.classList.remove('is-sheet');
    state.marker.replaceWith(panel);
    presented.delete(panel);
  }, CLOSE_MS);
}

/** Dragging the sheet down moves it with the finger; far or fast enough, it closes. */
function initDrag(panel) {
  let start = null;
  let dragging = false;

  panel.addEventListener('touchstart', (event) => {
    start = null;
    dragging = false;
    if (!panel.classList.contains('is-sheet') || event.touches.length !== 1) return;
    // A list that's been scrolled down scrolls back up first.
    const list = event.target.closest('.month-picker__years, .table-filter__options, .menu__list');
    if (panel.scrollTop > 0 || list?.scrollTop > 0) return;
    start = { y: event.touches[0].clientY, time: event.timeStamp, dy: 0 };
  }, { passive: true });

  panel.addEventListener('touchmove', (event) => {
    if (!start) return;
    const dy = event.touches[0].clientY - start.y;
    if (!dragging) {
      if (dy < -DRAG_START) { start = null; return; } // moving up: an ordinary scroll
      if (dy < DRAG_START) return;
      dragging = true;
    }
    event.preventDefault();
    start.dy = Math.max(0, dy);
    panel.style.transition = 'none';
    panel.style.transform = `translateY(${start.dy}px)`;
  }, { passive: false });

  const end = (event) => {
    if (!start || !dragging) { start = null; return; }
    const { dy, time } = start;
    const flicked = dy / Math.max(1, event.timeStamp - time) > DISMISS_SPEED;
    start = null;
    dragging = false;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > DISMISS_PX || flicked) current?.close();
  };
  panel.addEventListener('touchend', end);
  panel.addEventListener('touchcancel', end);
}

/** Opens `panel` as a bottom sheet on phones. `close` is how its owner closes it. */
export function asSheet(panel, close) {
  initDrag(panel);
  new MutationObserver(() => {
    if (panel.hidden) dismiss(panel);
    else if (phone.matches) present(panel, close);
  }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
}

// Turning a tablet from portrait to landscape can take it past the phone width.
phone.addEventListener('change', () => current?.close());
