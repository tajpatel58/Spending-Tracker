/**
 * budget-sliders.js
 * ---------------------------------------------------------------------
 * Editing budgets in place, shared by the Overview's Budget vs Actual
 * tile and a trip's By part tile. The tile keeps its bars, but each one
 * becomes a gauge: what's spent in its colour, the budget as a soft tint
 * of it, any overspend in rose stripes, and a knob at the budget to
 * drag. The "of £400" in its corner becomes a field to type into, and
 * the note beneath says what's left or over as it moves. The tile's
 * header carries the live total with Cancel and Save, and a line under
 * its title (budgetEditHeader). Nothing is saved here — the page reads
 * values() when Save is chosen.
 * ---------------------------------------------------------------------
 */

import { categoryIcon } from './category-icons.js';
import { currencyShort, escapeAttr } from './format.js';

const roundUp = (n) => Math.ceil(n / 100) * 100;

/** Each list's listeners while it's being edited, so the next edit (or the end of this one) can take them off. */
const listeners = new WeakMap();
const unlisten = (list) => (listeners.get(list) || []).forEach(([type, fn]) => list.removeEventListener(type, fn));

/**
 * Draws `rows` — [{ key, label, color, icon?, value, spent, fallback? }] —
 * into `list` (a budget list) as gauges, and returns { values(),
 * set(values) }: the amounts as { key: pounds }, and a way to move every
 * knob at once (e.g. back to the defaults). Each gauge reaches at least
 * `minReach`, and twice its amount or its spending when that's more
 * (a row's `fallback`, its default, is noted while it's set otherwise);
 * typing past the end stretches it. `onInput(total)` runs on every
 * change, for a live total; Enter in a field calls `onSubmit`, and
 * Escape anywhere in the list `onCancel`.
 */
export function budgetSliders(list, rows, { minReach = 1000, onInput = () => {}, onSubmit = () => {}, onCancel = () => {} } = {}) {
  const draft = Object.fromEntries(rows.map((r) => [r.key, r.value || 0]));
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const total = () => Object.values(draft).reduce((s, v) => s + v, 0);

  list.classList.remove('is-entering');
  list.classList.add('is-editing');
  list.innerHTML = rows.map((r, i) => {
    const id = `budget-range-${r.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const reach = Math.max(minReach, roundUp(draft[r.key] * 2), roundUp(r.spent || 0));
    return `
      <li class="budget-item budget-gauge" data-key="${escapeAttr(r.key)}" style="--avatar-color:${r.color}; --i:${i}">
        <div class="budget-item__header">
          <label class="budget-item__category${r.icon ? ' trip-part' : ''}" for="${id}">
            ${r.icon ? `<span class="trip-part__icon" aria-hidden="true">${categoryIcon(r.icon)}</span>` : ''}${r.label}
          </label>
          <span class="budget-item__summary">
            <span class="budget-item__amounts">${currencyShort(r.spent || 0)} of</span>
            <span class="budget-gauge__amount">
              <span aria-hidden="true">£</span><input type="number" min="0" step="any" inputmode="decimal" placeholder="0" aria-label="${r.label} budget, in pounds">
            </span>
          </span>
        </div>
        <div class="budget-item__bar budget-gauge__bar">
          <span class="budget-item__track budget-gauge__track">
            <span class="budget-gauge__budget"></span>
            <span class="budget-gauge__spent"></span>
            <span class="budget-gauge__over"></span>
          </span>
          <input type="range" id="${id}" min="0" max="${reach}" step="10" value="${draft[r.key]}">
        </div>
        <p class="budget-item__note"></p>
      </li>`;
  }).join('');

  /** Brings a gauge in line with its amount: knob, field, tint, overspend and note. */
  const sync = (item, from = null) => {
    const key = item.dataset.key;
    const value = draft[key];
    const spent = byKey[key].spent || 0;
    const range = item.querySelector('input[type="range"]');
    const amount = item.querySelector('input[type="number"]');
    if (value > Number(range.max)) range.max = roundUp(value);
    if (from !== range) range.value = value;
    if (from !== amount) amount.value = value || '';
    amount.style.width = `${Math.max(String(amount.value || '0').length, 1) + 0.25}ch`; // grows with the figure

    const max = Number(range.max);
    const at = (n) => `${(Math.min(n, max) / max) * 100}%`;
    const over = spent > value;
    item.style.setProperty('--budget', at(value));
    item.style.setProperty('--spent', at(Math.min(spent, value)));
    item.style.setProperty('--over', over ? at(spent) : at(value));
    item.classList.toggle('is-over', over && value > 0);

    const note = item.querySelector('.budget-item__note');
    let text = !spent ? 'Nothing spent yet' : over ? `${currencyShort(spent - value)} over` : value - spent < 1 ? 'All spent' : `${currencyShort(value - spent)} left`;
    if (!value) text = spent ? `${currencyShort(spent)} spent · no budget` : 'No budget';
    const { fallback } = byKey[key];
    note.textContent = fallback != null && value !== fallback ? `${text} · default ${currencyShort(fallback)}` : text;
    note.className = `budget-item__note${over && value > 0 ? ' is-negative' : ''}`;
  };
  const items = () => list.querySelectorAll('.budget-gauge');
  items().forEach((item) => sync(item));

  const handlers = {
    input: (event) => {
      const item = event.target.closest('.budget-gauge');
      if (!item) return;
      const value = Number(event.target.value);
      draft[item.dataset.key] = value > 0 ? Math.round(value * 100) / 100 : 0;
      sync(item, event.target);
      onInput(total());
    },
    keydown: (event) => {
      if (event.key === 'Escape') onCancel();
      else if (event.key === 'Enter' && event.target.type === 'number') { event.preventDefault(); onSubmit(); }
    },
  };
  unlisten(list);
  listeners.set(list, Object.entries(handlers));
  Object.entries(handlers).forEach(([type, fn]) => list.addEventListener(type, fn));

  return {
    values: () => ({ ...draft }),
    set(values) {
      Object.keys(draft).forEach((key) => { draft[key] = values[key] || 0; });
      items().forEach((item) => sync(item));
      onInput(total());
    },
  };
}

/** Takes a budget list out of editing: its listeners go, and the next render draws plain bars. */
export function endBudgetSliders(list) {
  list.classList.remove('is-editing');
  unlisten(list);
  listeners.delete(list);
}

/**
 * Puts a tile's header into editing: the meta shows the live total,
 * Cancel and Save stand beside it (the pencil steps aside), and `hint`
 * (markup) runs in a quiet line under the title. Returns showTotal(n).
 * The buttons carry data-cancel-budget and data-save-budget, so the
 * tile's click handler picks them up.
 */
export function budgetEditHeader(tile, hint) {
  const aside = tile.querySelector('.tile__aside');
  const meta = aside.querySelector('.tile__meta');
  const sub = tile.querySelector('.tile__sub');
  tile.classList.add('is-editing');
  aside.querySelector('.budget-edit-actions')?.remove();
  aside.insertAdjacentHTML('beforeend', `
    <span class="budget-edit-actions">
      <button type="button" class="budget-edit-btn" data-cancel-budget>Cancel</button>
      <button type="button" class="budget-edit-btn budget-edit-btn--save" data-save-budget>Save</button>
    </span>`);
  sub.innerHTML = hint;
  sub.hidden = false;
  meta.classList.add('is-editing');
  return (total) => { meta.innerHTML = `<span class="budget-edit-total__label">Total</span> ${currencyShort(total)}`; };
}

/** Puts a tile's header back as it was (the render that follows fills its meta in again). */
export function endBudgetEditHeader(tile) {
  tile.classList.remove('is-editing');
  tile.querySelector('.budget-edit-actions')?.remove();
  const sub = tile.querySelector('.tile__sub');
  sub.hidden = true;
  sub.innerHTML = '';
  tile.querySelector('.tile__meta').classList.remove('is-editing');
}
