/**
 * chart-kit.js
 * ---------------------------------------------------------------------
 * Small Chart.js helpers shared by the Overview (charts.js), Summary
 * (summary.js) and Trips (trips.js) pages: colour fading, the striped
 * "still to come" fill, the entrance animations, and the HTML tooltip that
 * matches the app's menus.
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
 * Draws `config` on `canvas` and returns the chart. The chart drawn there
 * last (`chart`) is given the new data and options instead of being
 * destroyed and rebuilt, which saves Chart.js setting the canvas up and
 * measuring the page again on every redraw. Its datasets are new objects,
 * so Chart.js plays the same draw-in as for a new chart; any hover is
 * cleared, as a new chart would start without one.
 */
export function drawChart(chart, canvas, config) {
  if (!chart || chart.canvas !== canvas) {
    chart?.destroy();
    return new Chart(canvas, config);
  }
  chart.setActiveElements([]);
  chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
  chart._lastEvent = null; // otherwise Chart.js replays the last pointer position onto the new data
  chart.data = config.data;
  chart.options = config.options;
  chart.update();
  return chart;
}

// ---- The entrance ----
// A chart's draw-in as its card lands (played by motion.js). Only the first
// draw uses these: later changes (a new month, an edit) stay quick.

/** Bars spring up, month after month, each stack building from the bottom. */
export function barEntrance({ step = 70, duration = 1000 } = {}) {
  return {
    duration,
    easing: 'easeOutBack',
    delay: (c) => (c.type === 'data' && c.mode === 'default' ? c.dataIndex * step + c.datasetIndex * 90 : 0),
  };
}

/** A ring opens outwards as it sweeps round. */
export const donutEntrance = () => ({ duration: 1500, easing: 'easeOutExpo', animateScale: true });

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Where the chart's main line crosses `x`, following its curve: { x, y }. Past its end, its last point. */
function pointOnLine(chart, x) {
  const points = chart.getDatasetMeta(0).data.filter((p) => !p.skip);
  if (!points.length) return null;
  const last = points[points.length - 1];
  if (x >= last.x) return { x: last.x, y: last.y, ended: true };
  const next = points.findIndex((p) => p.x > x);
  if (next <= 0) return { x: points[0].x, y: points[0].y };
  const a = points[next - 1];
  const b = points[next];
  const t = (x - a.x) / (b.x - a.x);
  // A monotone curve's control points sit a third of the way along, so x runs evenly with t.
  const c1 = a.cp2y ?? a.y;
  const c2 = b.cp1y ?? b.y;
  const u = 1 - t;
  return { x, y: u * u * u * a.y + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * b.y };
}

/**
 * A line chart that draws itself: everything is uncovered from the left
 * (lines, wash, target) behind a glowing pen tip on the main line, and a ring
 * ripples out from the latest point as it finishes. Add this to the chart's
 * `plugins` and set `chart.$replay = () => playDrawIn(chart)`.
 */
export const drawInLine = {
  id: 'drawInLine',
  beforeDatasetsDraw(chart) {
    const state = chart.$drawIn;
    if (!state || state.progress >= 1) return;
    const { ctx, chartArea: area } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.left - 8, 0, (area.width + 8) * state.progress + 8, chart.height);
    ctx.clip();
    state.clipped = true;
  },
  afterDatasetsDraw(chart) {
    const state = chart.$drawIn;
    if (!state) return;
    const { ctx, chartArea: area } = chart;
    if (state.clipped) { ctx.restore(); state.clipped = false; }
    const color = chart.data.datasets[0].borderColor;
    const at = pointOnLine(chart, area.left + area.width * state.progress);
    if (!at) return;
    ctx.save();
    if (state.progress < 1 && !at.ended) {
      const glow = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, 16);
      glow.addColorStop(0, fade(color, 0.55));
      glow.addColorStop(1, fade(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.ripple > 0) {
      ctx.strokeStyle = fade(color, 0.5 * (1 - state.ripple));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 4 + state.ripple * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },
};

/** Plays a chart's draw-in (see drawInLine). */
export function playDrawIn(chart, { duration = 1700, rippleFor = 750 } = {}) {
  const state = { progress: 0, ripple: 0, clipped: false };
  chart.stop();
  chart.update('none');
  chart.$drawIn = state;
  let began = null;
  const tick = (now) => {
    if (chart.$drawIn !== state || !chart.ctx) return; // replayed, or the chart was destroyed
    began ??= now;
    const elapsed = now - began;
    state.progress = easeInOut(Math.min(1, elapsed / duration));
    state.ripple = elapsed > duration ? Math.min(1, (elapsed - duration) / rippleFor) : 0;
    if (elapsed >= duration + rippleFor) chart.$drawIn = null;
    chart.draw();
    if (chart.$drawIn === state) requestAnimationFrame(tick);
  };
  chart.draw();
  requestAnimationFrame(tick);
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
