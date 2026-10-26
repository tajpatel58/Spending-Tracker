/**
 * category-icons.js
 * ---------------------------------------------------------------------
 * A small line icon for each category, shown in the transactions table's
 * avatars in place of the merchant's initial. Drawn on the same 24px
 * grid as the page's other icons and stroked in currentColor, so they
 * take the avatar's category tint and the shared line weight
 * (svg [stroke="currentColor"] in styles.css).
 * ---------------------------------------------------------------------
 */

// Each icon's shapes; every one is stroked (see categoryIcon).
const SHAPES = {
  // A basket with its handles.
  groceries: '<path d="M4.5 9.5h15l-1.6 8.1a2 2 0 0 1-2 1.6H8.1a2 2 0 0 1-2-1.6L4.5 9.5Z"/><path d="M8.5 9.5 11 4.5M15.5 9.5 13 4.5M9.5 13v3M14.5 13v3"/>',
  // A fork and a knife.
  dining: '<path d="M6.5 3.5v5a2.5 2.5 0 0 0 5 0v-5M9 3.5v5M9 11v9.5"/><path d="M17 20.5v-17c-1.9 1-3 3.2-3 6v4h3"/>',
  // A train, front on.
  transport: '<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 11h12M9 13.75h.5M14.5 13.75h.5M8.5 20.5l1.5-4M15.5 20.5l-1.5-4"/>',
  // A plane.
  holiday: '<path d="M10.5 10.6V5a1.5 1.5 0 0 1 3 0v5.6l7 4.4v1.8l-7-2.3v3.6l2 1.4v1.5L12 20l-3.5 1v-1.5l2-1.4v-3.6l-7 2.3V15l7-4.4Z"/>',
  // A house with its door.
  housing: '<path d="M4 10.5 12 4l8 6.5M6 9v10.5h12V9"/><path d="M10 19.5v-5h4v5"/>',
  // Two arrows chasing round: a repeat.
  subscriptions: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3l2.2 2.3M19.5 4.5V9H15"/><path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15M4.5 19.5V15H9"/>',
  // A bill, its lower edge torn.
  fixed_expense: '<path d="M6.5 3.5h11v17l-2.75-1.75L12 20.5l-2.75-1.75L6.5 20.5v-17Z"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>',
  // A medical cross.
  health: '<path d="M9.5 4.5h5v5h5v5h-5v5h-5v-5h-5v-5h5v-5Z"/>',
  // A shopping bag.
  shopping: '<path d="M5.5 8h13l-1 12.5h-11L5.5 8Z"/><path d="M9 10.5V6.5a3 3 0 0 1 6 0v4"/>',
  // A wrapped present.
  'birthday/gifts': '<rect x="4" y="8.5" width="16" height="4" rx="1"/><path d="M5.5 12.5v8h13v-8M12 8.5v12"/><path d="M12 8.5C10.5 5 7 4.5 7 7c0 1.5 2.5 1.5 5 1.5ZM12 8.5C13.5 5 17 4.5 17 7c0 1.5-2.5 1.5-5 1.5Z"/>',
  // A ticket.
  activities: '<path d="M3.5 7.5h17v3a1.5 1.5 0 0 0 0 3v3h-17v-3a1.5 1.5 0 0 0 0-3v-3Z"/><path d="M14.5 7.5v1.5M14.5 11.25v1.5M14.5 15v1.5"/>',
  // A blank tag: not yet categorised.
  other: '<path d="M4 4h7.5l8.5 8.5-7.5 7.5L4 11.5V4Z"/><circle cx="8.25" cy="8.25" r="1.25"/>',
  // A banknote.
  salary: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
  // A per cent sign.
  interest: '<path d="M18 6 6 18"/><circle cx="7.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>',
  // An arrow turning back: money returned.
  refund: '<path d="M8.5 8 4.5 12l4 4"/><path d="M4.5 12h10a4.5 4.5 0 0 1 0 9H12"/>',
};

/** The icon for a category id (Unassigned's tag for any it doesn't know), as inline SVG. */
export function categoryIcon(id) {
  const shapes = (SHAPES[id] || SHAPES.other).replaceAll('/>', ' stroke="currentColor"/>');
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">${shapes}</svg>`;
}
