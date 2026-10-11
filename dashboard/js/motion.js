/**
 * motion.js
 * ---------------------------------------------------------------------
 * Subtle motion that makes the dashboard feel responsive:
 *
 *   - Figures count to their new value whenever they change (first load
 *     counts up from zero), so switching month reads as a change rather
 *     than a cut.
 *   - On first load, cards rise into place one after another.
 *   - Switching month nudges the page in the direction you moved.
 *
 * Bars growing, calendar cells cascading and page-to-page transitions are
 * pure CSS (see "Motion" in styles.css). Everything here is skipped when
 * the visitor has asked their OS for reduced motion.
 * ---------------------------------------------------------------------
 */

const motion = (() => {
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = (t) => 1 - (1 - t) ** 3; // ease-out cubic

  // ---------- Counting figures ----------

  /** Splits "−£1,234.56/mo" into prefix, number, decimals, separators and suffix. */
  function parse(text) {
    const m = text.match(/^([^\d]*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s);
    if (!m) return null;
    return {
      prefix: m[1],
      value: parseFloat(m[2].replace(/,/g, '')),
      decimals: (m[2].split('.')[1] || '').length,
      grouped: m[2].includes(','),
      suffix: m[3],
    };
  }

  const format = (n, p) => p.prefix
    + n.toLocaleString('en-GB', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals, useGrouping: p.grouped })
    + p.suffix;

  const shown = new WeakMap();    // element -> the text it last settled on
  const writing = new WeakMap();  // element -> text we just wrote (so the observer ignores it)
  const frames = new WeakMap();   // element -> running animation frame

  function countTo(el) {
    const target = el.textContent;
    const to = parse(target);
    const from = parse(shown.get(el) || '');
    shown.set(el, target);
    cancelAnimationFrame(frames.get(el));
    // Only animate plain numeric text (not values with markup inside, like "£2.77/day").
    if (!to || el.children.length || reduced()) return;
    // Count from the old figure if it had the same sign/prefix, otherwise from zero.
    const start = from && from.prefix === to.prefix ? from.value : 0;
    if (start === to.value) return;

    const duration = 650;
    const began = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - began) / duration);
      const text = t < 1 ? format(start + (to.value - start) * ease(t), to) : target;
      writing.set(el, text);
      el.textContent = text;
      if (t < 1) frames.set(el, requestAnimationFrame(step));
    };
    frames.set(el, requestAnimationFrame(step));
  }

  /** Watches every headline figure and animates it whenever the page re-renders it. */
  function watchFigures() {
    const observer = new MutationObserver((records) => {
      const changed = new Set(records.map((r) => (r.target.nodeType === 3 ? r.target.parentElement : r.target).closest('.stat-tile__value')));
      changed.forEach((el) => {
        if (!el || writing.get(el) === el.textContent) return;
        countTo(el);
      });
    });
    document.querySelectorAll('.stat-tile__value').forEach((el) => {
      shown.set(el, el.textContent);
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  // ---------- First-load reveal ----------

  /** Cards rise into place one after another once the data has rendered. */
  function reveal() {
    if (reduced()) return;
    const items = [...document.querySelectorAll('main .page-heading, main .tile')]
      .filter((el) => !el.closest('[hidden]') && !el.hidden);
    items.forEach((el, i) => el.style.setProperty('--reveal-i', Math.min(i, 12)));
    document.body.classList.add('is-revealing');
    setTimeout(() => {
      document.body.classList.remove('is-revealing');
      items.forEach((el) => el.style.removeProperty('--reveal-i'));
    }, 1200);
  }

  // ---------- Month changes ----------

  /** Nudges the page content in the direction of travel (−1 = earlier month, 1 = later). */
  function monthChanged(direction) {
    if (reduced()) return;
    const main = document.querySelector('main');
    main?.animate([
      { opacity: 0.35, transform: `translateX(${direction * 14}px)` },
      { opacity: 1, transform: 'none' },
    ], { duration: 380, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  }

  document.addEventListener('DOMContentLoaded', watchFigures);
  return { reveal, monthChanged, reduced };
})();
