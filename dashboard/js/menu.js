/**
 * menu.js
 * ---------------------------------------------------------------------
 * Ledger's own pick-one menu, in place of the browser's dropdown: a glass
 * list beside the button that opened it, or a bottom sheet on phones
 * (sheet.js).
 *
 *   openMenu({
 *     anchor,   // the button that opens it (pressing it again closes it)
 *     label,    // what's being chosen, for screen readers
 *     value,    // the current choice
 *     items,    // [{ value, label, color?, icon? }]; icon is inline SVG
 *     onSelect, // (value) => ..., called only when the choice changes
 *   });
 * ---------------------------------------------------------------------
 */

import { escapeAttr } from './format.js';
import { asSheet, isPhone } from './sheet.js';

const GRID_FROM = 9;   // on phones, lists this long sit in two columns
const GAP = 6;       // px between the menu and its button
const EDGE = 8;        // px kept clear of the screen's edges

const CHECK = '<svg class="menu__check" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor"/></svg>';

let element = null;
let current = null; // the open menu: { anchor, listeners }

function ensureElement() {
  if (element) return element;
  element = document.createElement('div');
  element.className = 'menu';
  element.hidden = true;
  document.body.append(element);
  asSheet(element, () => closeMenu());
  return element;
}

/** Closes the open menu, if any; `refocus` returns the keyboard to its button. */
export function closeMenu({ refocus = false } = {}) {
  if (!current) return;
  const { anchor, listeners } = current;
  current = null;
  listeners.abort();
  element.hidden = true;
  anchor.setAttribute('aria-expanded', 'false');
  if (refocus) anchor.focus({ preventScroll: true });
}

/** Beside its button: below if there's room, otherwise whichever side has more. */
function place(menu, anchor) {
  menu.style.minWidth = `${Math.max(anchor.getBoundingClientRect().width, 220)}px`;
  menu.style.maxHeight = '';
  const button = anchor.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = menu; // not its rect: that's scaled while it eases open
  const below = window.innerHeight - button.bottom - GAP - EDGE;
  const above = button.top - GAP - EDGE;
  const opensUp = height > below && above > below;
  menu.style.maxHeight = `${Math.min(height, opensUp ? above : below)}px`;
  menu.style.top = opensUp ? 'auto' : `${button.bottom + GAP}px`;
  menu.style.bottom = opensUp ? `${window.innerHeight - button.top + GAP}px` : 'auto';
  menu.style.left = `${Math.max(EDGE, Math.min(button.left, window.innerWidth - width - EDGE))}px`;
  menu.style.transformOrigin = opensUp ? 'bottom left' : 'top left';
}

export function openMenu({ anchor, label, value, items, onSelect }) {
  if (current?.anchor === anchor) { closeMenu({ refocus: true }); return; }
  closeMenu();

  const menu = ensureElement();
  const phone = isPhone();
  menu.classList.toggle('menu--grid', phone && items.length >= GRID_FROM);
  menu.innerHTML = `
    ${phone ? `<p class="menu__title">${escapeAttr(label)}</p>` : ''}
    <ul class="menu__list" role="listbox" tabindex="-1" aria-label="${escapeAttr(label)}">
      ${items.map((item, i) => {
        const selected = item.value === value;
        const mark = item.icon
          ? `<span class="menu__icon" style="--menu-color:${item.color}">${item.icon}</span>`
          : item.color ? `<span class="chip__dot" style="background:${item.color}" aria-hidden="true"></span>` : '';
        return `
          <li class="menu__item${selected ? ' is-selected' : ''}" id="menu-option-${i}" role="option" aria-selected="${selected}" data-index="${i}">
            ${mark}<span class="menu__label">${escapeAttr(item.label)}</span>${selected ? CHECK : ''}
          </li>`;
      }).join('')}
    </ul>`;
  const list = menu.querySelector('.menu__list');
  const options = [...list.children];

  let active = Math.max(0, items.findIndex((item) => item.value === value));
  const setActive = (index, scroll = true) => {
    active = index;
    options.forEach((option, i) => option.classList.toggle('is-active', i === index));
    list.setAttribute('aria-activedescendant', options[index].id);
    if (scroll) options[index].scrollIntoView({ block: 'nearest' });
  };
  const choose = (item) => {
    closeMenu({ refocus: true }); // first: a redraw puts focus back on whatever has it (table.js)
    if (item.value !== value) onSelect(item.value);
  };

  const listeners = new AbortController();
  const { signal } = listeners;
  current = { anchor, listeners };
  anchor.setAttribute('aria-expanded', 'true');

  list.addEventListener('click', (event) => {
    const option = event.target.closest('[data-index]');
    if (option) choose(items[Number(option.dataset.index)]);
  }, { signal });
  list.addEventListener('pointermove', (event) => {
    const option = event.target.closest('[data-index]');
    if (option && Number(option.dataset.index) !== active) setActive(Number(option.dataset.index), false);
  }, { signal });
  // Kept inside the menu, so the page's own shortcuts (←/→ change month, Esc closes other things) don't fire too.
  menu.addEventListener('keydown', (event) => {
    event.stopPropagation();
    const last = items.length - 1;
    if (event.key === 'ArrowDown') setActive(active >= last ? 0 : active + 1);
    else if (event.key === 'ArrowUp') setActive(active <= 0 ? last : active - 1);
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(last);
    else if (event.key === 'Enter' || event.key === ' ') choose(items[active]);
    else if (event.key === 'Escape') closeMenu({ refocus: true });
    else if (event.key === 'Tab') { closeMenu({ refocus: true }); return; }
    else return;
    event.preventDefault();
  }, { signal });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target) && !anchor.contains(event.target)) closeMenu();
  }, { capture: true, signal });
  if (!phone) {
    // A floating menu would be left behind by the page, so it closes instead.
    window.addEventListener('scroll', (event) => { if (!menu.contains(event.target)) closeMenu(); }, { capture: true, passive: true, signal });
    window.addEventListener('resize', () => closeMenu(), { signal });
  }

  menu.hidden = false;
  if (phone) {
    menu.style.cssText = ''; // the sheet's own position applies
  } else {
    place(menu, anchor);
  }
  list.focus({ preventScroll: true });
  setActive(active);
}
