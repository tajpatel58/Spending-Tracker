/**
 * table-edges.js
 * ---------------------------------------------------------------------
 * The tables that scroll sideways inside their cards (Summary, Trips):
 * says whether there's more to the right (a fade at the card's edge) and
 * whether they've been scrolled (the pinned first column, glass until then,
 * hides the figures passing under it). See .table-scroll in styles.css.
 * ---------------------------------------------------------------------
 */

export function initTableEdges() {
  document.querySelectorAll('.table-scroll').forEach((scroller) => {
    const update = () => {
      scroller.classList.toggle('has-more', scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1);
      scroller.classList.toggle('is-scrolled', scroller.scrollLeft > 0);
    };
    scroller.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(scroller);
    [...scroller.children].forEach((child) => new ResizeObserver(update).observe(child)); // a redraw can change the table's width
    update();
  });
}
