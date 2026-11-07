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
 *   - Switching month slides the page the way you moved (swiping
 *     sideways on a phone does it too — see filters.js).
 *   - Once you scroll, the header gains a soft shadow. On wider screens,
 *     scrolling down gathers it into a small pill and scrolling up opens it.
 *   - In the top nav, a soft highlight glides to whichever tab the mouse
 *     is over.
 *   - Clicking a tab notes which way you're moving along the tab bar, so
 *     the next page slides that way and plays its icon.
 *   - On summary cards, the glass edge catches the light near the mouse.
 *
 * Bars growing, calendar cells cascading, ticks drawing themselves and
 * page-to-page transitions are pure CSS (see "Motion" in styles.css).
 * Everything here is skipped when the visitor has asked their OS for
 * reduced motion.
 * ---------------------------------------------------------------------
 */

import { moneyMarkup } from './format.js';

export const motion = (() => {
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

  // One formatter per style: toLocaleString builds a new one on every call,
  // which is slow enough in Safari to drop frames while figures count.
  const formatters = new Map();
  const formatter = (p) => {
    const key = `${p.decimals}|${p.grouped}`;
    if (!formatters.has(key)) {
      formatters.set(key, new Intl.NumberFormat('en-GB', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals, useGrouping: p.grouped }));
    }
    return formatters.get(key);
  };
  const format = (n, p) => p.prefix + formatter(p).format(n) + p.suffix;

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
    // £ sign and pence (moneyMarkup) — not values like "£2.77/day" with a unit.
    const money = el.children.length > 0 && [...el.children].every((child) => child.matches('.money__sym, .money__pence'));
    if (!to || (el.children.length && !money) || reduced()) return;
    // Count from the old figure if it had the same sign/prefix, otherwise from zero.
    const start = from && from.prefix === to.prefix ? from.value : 0;
    if (start === to.value) return;

    const duration = 650;
    const began = performance.now();
    let last = null;
    let parts = null; // a money figure's [pounds text node, pence span], updated in place
    const write = (text, final) => {
      writing.set(el, text);
      if (!money) { el.textContent = text; return; }
      // Mid-count, change only the digits rather than rebuilding the £/pence
      // markup, so Safari isn't re-laying out fresh nodes every frame.
      const pence = text.match(/(\.\d+)(?!.*\d)/)?.[1];
      if (!final && parts && pence) {
        parts[0].nodeValue = text.slice(text.indexOf('£') + 1, text.lastIndexOf(pence));
        parts[1].textContent = pence;
        return;
      }
      el.innerHTML = moneyMarkup(text);
      const sym = el.querySelector('.money__sym');
      const penceEl = el.querySelector('.money__pence');
      parts = sym && penceEl && sym.nextSibling?.nodeType === 3 && sym.nextSibling.nextSibling === penceEl
        ? [sym.nextSibling, penceEl] : null;
    };
    const step = (now) => {
      const t = Math.min(1, (now - began) / duration);
      const text = t < 1 ? format(start + (to.value - start) * ease(t), to) : target;
      if (text !== last || t >= 1) write(text, t >= 1);
      last = text;
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
    const items = [...document.querySelectorAll('main .page-heading, main .section-eyebrow, main .tile')]
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

  let monthTransitions = 0; // so an earlier, interrupted slide doesn't tidy up after a newer one

  /**
   * Runs a month change (`update` redraws the page) as a slide in the
   * direction of travel (−1 = earlier month, 1 = later): the old month
   * slides away and fades as the new one slides in from the other side,
   * the month name in the header slides with it, and the rest of the
   * header holds still (see "Changing month" in styles.css). Browsers
   * without view transitions get the simpler nudge below.
   */
  function monthTransition(direction, update) {
    const main = document.querySelector('main');
    const settle = () => { if (main) { main.style.transition = 'none'; main.style.transform = ''; } }; // after a swipe
    if (reduced()) { settle(); update(); if (main) main.style.transition = ''; return; }
    if (!document.startViewTransition) { settle(); update(); if (main) main.style.transition = ''; monthChanged(direction); return; }

    const root = document.documentElement;
    const id = ++monthTransitions;
    root.dataset.monthStep = direction > 0 ? 'next' : 'prev';
    root.classList.add('month-transition');
    const transition = document.startViewTransition(() => { settle(); update(); });
    // A slide can be cut short (another month change, or the viewport resizing as a
    // phone's address bar slides away); the new month is already drawn either way.
    transition.ready.catch(() => {});
    transition.finished.finally(() => {
      if (main) main.style.transition = '';
      if (id !== monthTransitions) return;
      root.classList.remove('month-transition');
      delete root.dataset.monthStep;
    });
  }

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
    if (!scroller) tuckHeader(topbar); // the Assistant's page doesn't scroll under its header
  }

  // ---------- The header tucks away ----------

  const TUCK_FROM = 160; // px down the page before the bar will tuck
  const TUCK_AFTER = 14; // px of scrolling down that tucks it
  const SHOW_AFTER = 10; // px of scrolling up that brings it back

  /**
   * Wider screens only (on a phone the tabs live at the bottom): scrolling
   * down gathers the floating bar into a small pill at the top of the screen,
   * so it stops covering the cards, and scrolling up opens it again. So does
   * reaching the top, or hovering or choosing the pill. It stays open while
   * it's in use: under the pointer, a menu open, keyboard focus inside it, or
   * rows selected (its "Hide selected" button is the only way to act on them).
   */
  function tuckHeader(topbar) {
    const wide = window.matchMedia('(min-width: 561px)');
    const hideButton = topbar.querySelector('#hide-selected-button');
    const activeLink = topbar.querySelector('.view-nav__link.is-active');

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'topbar__pill';
    pill.setAttribute('aria-label', 'Show navigation');
    pill.title = 'Show navigation';
    const mark = topbar.querySelector('.brand__svg')?.cloneNode(true);
    if (mark) pill.append(mark);
    const label = document.createElement('span');
    label.textContent = activeLink?.textContent.trim() || 'Ledger';
    pill.append(label);
    topbar.prepend(pill);

    // The bar's glass closes to the pill's width, which depends on the page's name and font.
    const measure = () => topbar.style.setProperty('--pill-w', `${pill.offsetWidth}px`);
    measure();
    document.fonts?.ready.then(measure);

    const inUse = () => topbar.matches(':hover')
      || Boolean(topbar.querySelector('[aria-expanded="true"], :focus-visible'))
      || (hideButton && !hideButton.hidden);

    let lastY = 0;
    let travelled = 0; // how far the page has moved in the current direction
    let lastScroll = 0;
    let queued = false;
    const setTucked = (tucked) => {
      travelled = 0;
      topbar.classList.toggle('is-tucked', tucked);
    };

    const update = () => {
      queued = false;
      // Clamped, so a rubber-band bounce at either end doesn't count as a change of direction.
      const y = Math.min(Math.max(0, window.scrollY), document.documentElement.scrollHeight - window.innerHeight);
      const moved = y - lastY;
      lastY = y;
      if (!moved || !wide.matches) return;
      if (moved * travelled < 0) travelled = 0;
      travelled += moved;
      if (y <= TUCK_FROM || travelled <= -SHOW_AFTER) setTucked(false);
      else if (travelled >= TUCK_AFTER && !inUse()) setTucked(true);
    };
    window.addEventListener('scroll', () => {
      lastScroll = performance.now();
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }, { passive: true });
    lastY = window.scrollY;

    pill.addEventListener('click', (e) => {
      setTucked(false);
      if (e.detail === 0) activeLink?.focus(); // from the keyboard: carry on into the bar
    });
    // Not when the page has just scrolled the pill under a resting pointer.
    pill.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && performance.now() - lastScroll > 200) setTucked(false);
    });
    wide.addEventListener('change', () => { setTucked(false); measure(); });
    // Rows selected further down the page: bring back the button that acts on them.
    if (hideButton) {
      new MutationObserver(() => { if (!hideButton.hidden) setTucked(false); })
        .observe(hideButton, { attributes: true, attributeFilter: ['hidden'] });
    }
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

  // ---------- Which way the tabs are moving ----------

  /**
   * Each tab is its own page, so the way you're moving along the tab bar is
   * left for the next page to pick up: a script in its <head> turns this into
   * html[data-nav-step], which slides the page that way and plays the tab's
   * icon (see "Moving along the tab bar" in styles.css). Reloads and
   * back/forward leave nothing, and keep the plain cross-fade.
   */
  function trackNavStep() {
    const nav = document.querySelector('.view-nav');
    if (!nav || reduced()) return;
    nav.addEventListener('click', (e) => {
      const link = e.target.closest('.view-nav__link');
      if (!link || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // a new tab or window
      const links = [...nav.querySelectorAll('.view-nav__link')];
      const from = links.findIndex((l) => l.classList.contains('is-active'));
      const to = links.indexOf(link);
      if (from < 0 || from === to) return;
      try { sessionStorage.setItem('ledger-nav-step', to > from ? 'next' : 'prev'); } catch { /* slides are optional */ }
    });
  }

  // ---------- Card rim light ----------

  /** The glass edge of a summary card catches the light nearest the pointer. */
  function rimLight() {
    if (reduced() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let latest = null; // the newest position, drawn once per frame
    const draw = () => {
      const { target, clientX, clientY } = latest;
      latest = null;
      const tile = target instanceof Element && target.closest('.stat-tile, .chart-tile');
      if (!tile) return;
      const box = tile.getBoundingClientRect();
      tile.style.setProperty('--rim-x', `${clientX - box.left}px`);
      tile.style.setProperty('--rim-y', `${clientY - box.top}px`);
    };
    document.addEventListener('pointermove', (e) => {
      if (!latest) requestAnimationFrame(draw);
      latest = e;
    }, { passive: true });
  }

  // iOS Safari only applies :active (the press styles) once a page listens for touches.
  document.addEventListener('touchstart', () => {}, { passive: true });

  document.addEventListener('DOMContentLoaded', navGlide);
  document.addEventListener('DOMContentLoaded', trackNavStep);
  document.addEventListener('DOMContentLoaded', rimLight);
  document.addEventListener('DOMContentLoaded', watchFigures);
  document.addEventListener('DOMContentLoaded', watchHeader);
  return { reveal, monthTransition, reduced };
})();
