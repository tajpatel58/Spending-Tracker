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

/**
 * Chart.js `external` tooltip drawn as HTML, so it matches the app's menus
 * (frosted surface, serif title, tabular figures) and glides between bars.
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
      wrap.appendChild(el);
    }
    if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
      el.classList.remove('is-visible');
      return;
    }

    const { title, rows, footer } = build(tooltip.dataPoints);
    el.innerHTML = `
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
