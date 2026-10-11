/**
 * nav.js
 * ---------------------------------------------------------------------
 * On phones the Overview / Calendar / Assistant links form a bottom tab
 * bar. So it doesn't cover content while reading, it slides away as you
 * scroll down and comes back when you scroll up, return to the top, or
 * reach the end of the page (the same pattern as Safari's toolbar).
 * On desktop the links sit in the top bar and this has no visible effect.
 * ---------------------------------------------------------------------
 */
(() => {
  const nav = document.querySelector('.view-nav');
  if (!nav) return;

  const THRESHOLD = 8; // px of movement before reacting, so small jitters don't toggle it
  let lastY = window.scrollY;
  let queued = false;

  const update = () => {
    queued = false;
    const y = Math.max(0, window.scrollY); // iOS bounce can report negative values
    const atTop = y < 48;
    const atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 4;
    const delta = y - lastY;
    if (Math.abs(delta) < THRESHOLD && !atTop && !atBottom) return;

    nav.classList.toggle('is-hidden', delta > 0 && !atTop && !atBottom);
    lastY = y;
  };

  window.addEventListener('scroll', () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }, { passive: true });

  // Keyboard users tabbing into the bar should always see it.
  nav.addEventListener('focusin', () => nav.classList.remove('is-hidden'));
})();
