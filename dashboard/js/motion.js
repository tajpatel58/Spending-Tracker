/**
 * motion.js
 * ---------------------------------------------------------------------
 * Motion that makes the dashboard feel responsive:
 *
 *   - Headline figures count to their new value whenever they change
 *     (first load counts up from zero).
 *   - After a data refresh, cards whose figure changed glow briefly.
 *   - On first load, cards in view rise into place one after another;
 *     cards further down rise in (and replay their charts) as you scroll
 *     to them.
 *   - Switching month nudges the page in the direction you moved.
 *   - Once you scroll, the header gains a soft shadow.
 *   - In the top nav, a soft highlight glides to whichever tab the mouse
 *     is over.
 *
 * Bars growing, calendar cells cascading, ticks drawing themselves and
 * page-to-page transitions are pure CSS (see "Motion" in styles.css).
 * Everything here is skipped when the visitor has asked their OS for
 * reduced motion.
 * ---------------------------------------------------------------------
 */

const motion = (() => {
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Counting figures ----------

  const ease = (t) => 1 - (1 - t) ** 3; // ease-out cubic

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
  let flashUntil = 0;             // after a data refresh, changed figures glow until this time

  /** After a refresh, makes it obvious which figures changed. */
  function flash(el) {
    const tile = el.closest('.tile');
    if (!tile) return;
    tile.classList.remove('is-changed');
    void tile.offsetWidth; // restart the glow
    tile.classList.add('is-changed');
    setTimeout(() => tile.classList.remove('is-changed'), 1800);
  }

  function countTo(el) {
    const target = el.textContent;
    const to = parse(target);
    const before = shown.get(el) || '';
    const from = parse(before);
    shown.set(el, target);
    cancelAnimationFrame(frames.get(el));
    if (before !== target && from && Date.now() < flashUntil) flash(el);
    // Animate plain numeric text, or a money figure whose only markup is its
    // smaller pence (moneyMarkup) — not values like "£2.77/day" with a unit.
    const money = el.children.length === 1 && el.firstElementChild.classList.contains('money__pence');
    if (!to || (el.children.length && !money) || reduced()) return;
    // Count from the old figure if it had the same sign/prefix, otherwise from zero.
    const start = from && from.prefix === to.prefix ? from.value : 0;
    if (start === to.value) return;

    const duration = 650;
    const began = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - began) / duration);
      const text = t < 1 ? format(start + (to.value - start) * ease(t), to) : target;
      writing.set(el, text);
      if (money) el.innerHTML = moneyMarkup(text);
      else el.textContent = text;
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
    document.addEventListener('ledger:data-changed', () => { flashUntil = Date.now() + 1500; });
  }

  // ---------- First-load reveal + scroll-in ----------

  /** Replays a card's chart draw-in (Chart.js) as it comes into view. */
  function replay(tile) {
    tile.querySelectorAll('canvas').forEach((canvas) => {
      const chart = typeof Chart !== 'undefined' && Chart.getChart(canvas);
      if (chart) { chart.reset(); chart.update(); }
    });
  }

  /**
   * Cards already on screen rise into place one after another; cards
   * further down wait, then rise in as they're scrolled into view.
   */
  function reveal() {
    if (reduced()) return;
    const items = [...document.querySelectorAll('main .page-heading, main .tile')]
      .filter((el) => !el.closest('[hidden]') && !el.hidden);
    const inView = (el) => el.getBoundingClientRect().top < window.innerHeight - 40;

    const now = items.filter(inView);
    now.forEach((el, i) => el.style.setProperty('--reveal-i', Math.min(i, 12)));
    document.body.classList.add('is-revealing');
    now.forEach((el) => el.classList.add('reveal-now'));
    setTimeout(() => {
      document.body.classList.remove('is-revealing');
      now.forEach((el) => { el.classList.remove('reveal-now'); el.style.removeProperty('--reveal-i'); });
    }, 1200);

    const later = items.filter((el) => !inView(el));
    if (!later.length || !('IntersectionObserver' in window)) return;
    later.forEach((el) => el.classList.add('reveal-pending'));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        observer.unobserve(el);
        el.classList.remove('reveal-pending');
        el.classList.add('reveal-in');
        replay(el);
        setTimeout(() => el.classList.remove('reveal-in'), 800);
      });
    }, { rootMargin: '0px 0px -12% 0px' });
    later.forEach((el) => observer.observe(el));
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

  // ---------- Header on scroll ----------

  /** The header picks up a soft shadow once the page (or the chat) is scrolled. */
  function watchHeader() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const scroller = document.getElementById('chat-scroll'); // the Assistant scrolls inside the page
    const position = () => (scroller ? scroller.scrollTop : window.scrollY);
    let queued = false;
    const update = () => { queued = false; topbar.classList.toggle('is-scrolled', position() > 6); };
    (scroller || window).addEventListener('scroll', () => {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  // ---------- Nav hover highlight ----------

  /** A highlight under the nav that glides from tab to tab with the mouse. */
  function navGlide() {
    const nav = document.querySelector('.view-nav');
    if (!nav || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const glider = document.createElement('span');
    glider.className = 'view-nav__glider';
    glider.setAttribute('aria-hidden', 'true');
    nav.prepend(glider);

    const moveTo = (link) => {
      glider.style.setProperty('--glide-x', `${link.offsetLeft}px`);
      glider.style.setProperty('--glide-w', `${link.offsetWidth}px`);
    };
    nav.addEventListener('pointerover', (e) => {
      const link = e.target.closest('.view-nav__link');
      if (!link) return;
      if (!nav.classList.contains('is-hovering')) {
        // Arriving from outside: appear under the tab rather than sliding in from the edge.
        glider.classList.add('is-placing');
        moveTo(link);
        void glider.offsetWidth;
        glider.classList.remove('is-placing');
        nav.classList.add('is-hovering');
      } else moveTo(link);
    });
    nav.addEventListener('pointerleave', () => nav.classList.remove('is-hovering'));
  }

  document.addEventListener('DOMContentLoaded', navGlide);
  document.addEventListener('DOMContentLoaded', watchFigures);
  document.addEventListener('DOMContentLoaded', watchHeader);
  return { reveal, monthChanged, reduced };
})();
