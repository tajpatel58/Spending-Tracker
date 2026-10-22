/**
 * chart-kit.js
 * ---------------------------------------------------------------------
 * Small Chart.js helpers shared by the Overview (charts.js) and Summary
 * (summary.js) pages: colour fading, the striped "still to come" fill,
 * and the HTML tooltip that matches the app's menus.
 * ---------------------------------------------------------------------
 */

import { escapeAttr } from './format.js';

/** '#RRGGBB' -> 'rgba(r, g, b, a)', for dimming the slices that aren't highlighted. */
export function fade(hex, alpha) {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/** Diagonal stripes in `color` — the "still to come" part of a month's bar. */
export function stripePattern(color) {
  const size = 8;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const g = tile.getContext('2d');
  g.fillStyle = fade(color, 0.16);
  g.fillRect(0, 0, size, size);
  g.strokeStyle = fade(color, 0.6);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-2, size + 2); g.lineTo(size + 2, -2);
  g.moveTo(-2, 2); g.lineTo(2, -2);
  g.moveTo(size - 2, size + 2); g.lineTo(size + 2, size - 2);
  g.stroke();
  return g.createPattern(tile, 'repeat');
}

/** Touch screens can't hover away from a chart, so its tooltip carries a close button there. */
const canHover = () => window.matchMedia('(hover: hover)').matches;

/** Closes a chart's tooltip and clears the highlighted bar or point with it. */
function dismissTooltip(chart) {
  if (!chart?.canvas) return; // the chart was redrawn and this one destroyed
  chart.setActiveElements([]);
  chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
  chart.update('none');
}

/**
 * Chart.js `external` tooltip drawn as HTML, so it matches the app's menus
 * (frosted surface, serif title, tabular figures) and glides between bars.
 * On touch screens it has a small × in its corner, since there's no
 * hovering off the chart to close it.
 *
 *   build(dataPoints) -> { title, rows: [{ label, value, swatch }], footer: [label, value] }
 *   swatch is a CSS background, or 'line' for the dashed target line.
 */
export function htmlTooltip(build) {
  return ({ chart, tooltip }) => {
    const wrap = chart.canvas.parentElement;
    let el = wrap.querySelector('.chart-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.className = 'chart-tooltip';
      el.setAttribute('aria-hidden', 'true');
      // The element outlives redraws (charts are rebuilt on each change), so
      // the button closes whichever chart last filled it.
      el.addEventListener('click', (event) => {
        if (event.target.closest('.chart-tooltip__close')) dismissTooltip(el.chart);
      });
      wrap.appendChild(el);
    }
    el.chart = chart;
    if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
      el.classList.remove('is-visible');
      return;
    }

    const { title, rows, footer } = build(tooltip.dataPoints);
    el.innerHTML = `
      ${canHover() ? '' : `<button type="button" class="chart-tooltip__close" aria-label="Close" tabindex="-1">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor"/></svg>
      </button>`}
      <p class="chart-tooltip__title">${escapeAttr(title)}</p>
      ${rows.map((row) => `
        <p class="chart-tooltip__row">
          <i class="chart-tooltip__swatch${row.swatch === 'line' ? ' chart-tooltip__swatch--line' : ''}"${row.swatch === 'line' ? '' : ` style="background:${row.swatch}"`}></i>
          <span>${escapeAttr(row.label)}</span><b>${row.value}</b>
        </p>`).join('')}
      ${footer ? `<p class="chart-tooltip__row chart-tooltip__row--total"><span>${footer[0]}</span><b>${footer[1]}</b></p>` : ''}`;

    // Beside the hovered bar (flipping to the other side near the edge), vertically clamped.
    const gap = 14;
    const x0 = chart.canvas.offsetLeft + tooltip.caretX;
    const y0 = chart.canvas.offsetTop + tooltip.caretY;
    const { offsetWidth: w, offsetHeight: h } = el;
    const x = x0 + gap + w > wrap.clientWidth ? x0 - gap - w : x0 + gap;
    const y = Math.min(Math.max(y0 - h / 2, 0), wrap.clientHeight - h);
    if (!el.classList.contains('is-visible')) el.classList.add('is-placing'); // appear in place, don't glide in
    el.style.setProperty('--x', `${Math.round(x)}px`);
    el.style.setProperty('--y', `${Math.round(y)}px`);
    void el.offsetWidth;
    el.classList.remove('is-placing');
    el.classList.add('is-visible');
  };
}
