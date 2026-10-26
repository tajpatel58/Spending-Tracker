/**
 * summary.js
 * ---------------------------------------------------------------------
 * Entry point for summary.html — the household's months side by side,
 * and everything saved across them:
 *
 *   - What you kept: total saved over the period, with its running total
 *     against the savings target, the average month, the savings rate,
 *     the best month and how many months met the target.
 *   - Month by month: income against spending (fixed + everyday) with
 *     what was saved as a gold line, and the same months as a ledger
 *     (choosing one opens it on the Overview).
 *   - Analysis: plain-English highlights, each person's savings, and
 *     every category month by month, shaded against its own average.
 *
 * Only full months count towards totals and averages. The month still
 * coming in is shown as a forecast — its income includes any salary
 * still expected (expectedSalaries) and its spending is the month-end
 * forecast (forecastSpend) — so it never drags the figures down while
 * statements are still arriving. Reuses the dashboard's data, account
 * filter and expense rules, so a month's figures match the Overview's.
 * ---------------------------------------------------------------------
 */

import { initPageHeading, initUserMenu, signOut } from './auth.js';
import { fade, htmlTooltip, stripePattern } from './chart-kit.js';
import { ACCOUNTS, accountsReady, CATEGORIES, MONTH_LABEL, MONTHS, pageSession } from './data.js';
import { initAccountFilter, initSwipeStep, pageHooks } from './filters.js';
import {
  daysIn,
  expectedSalaries,
  forecastSpend,
  indexEvents,
  lastLoadedDate,
  pad2,
  savingsByPerson,
  sumAbs,
} from './forecast.js';
import { cssVar, currency, currencyShort, escapeAttr, MINUS, moneyMarkup } from './format.js';
import { motion } from './motion.js';
import {
  accountById,
  finishLoading,
  getMonthTransactions,
  isExpense,
  isVariableExpense,
  MONTHLY_SAVINGS_TARGET,
  showLoadError,
  spendOwnerColor,
  state,
} from './state.js';
import { initSync } from './sync.js';
import { initTheme, toggleTheme } from './theme.js';

const TARGET = MONTHLY_SAVINGS_TARGET;
const PERIOD_KEY = 'ledger-summary-period';
const PERIODS = ['6', '12', 'all'];

const view = {
  period: (() => { try { return PERIODS.includes(localStorage.getItem(PERIOD_KEY)) ? localStorage.getItem(PERIOD_KEY) : '12'; } catch { return '12'; } })(),
};

let cumulativeChart, flowChart, peopleChart;
const drawnCharts = new Set();
/** True the first time a chart draws on this page load: that draw grows in slowly. */
function isFirstDraw(id) {
  if (drawnCharts.has(id)) return false;
  drawnCharts.add(id);
  return !motion.reduced();
}

const monthName = (key) => MONTH_LABEL(key).split(' ')[0];
const shortMonth = (key) => monthName(key).slice(0, 3);
const percent = (n) => `${Math.round(n * 100)}%`;
const signedShort = (n) => `${n < 0 ? MINUS : '+'}${currencyShort(Math.abs(n))}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const average = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);

// ============================================================
// FIGURES
// ============================================================

/**
 * One month's figures. A full month is what actually happened; the month
 * still coming in is a forecast: income counts salaries still expected,
 * spending runs on to the month-end forecast (`toCome` is that gap).
 *   { key, complete, income, expected, fixed, everyday, spent, toCome, saved, rate, hit }
 */
function monthFigures(key) {
  const txs = getMonthTransactions(key);
  const complete = lastLoadedDate() >= `${key}-${pad2(daysIn(key))}`;
  const expected = complete ? [] : expectedSalaries(key);
  const income = txs.filter((t) => t.category === 'salary' || t.category === 'interest').reduce((s, t) => s + t.amount, 0)
    + expected.reduce((s, e) => s + e.amount, 0);
  const fixed = sumAbs(txs.filter((t) => t.category === 'fixed_expense'));
  const everyday = sumAbs(txs.filter(isVariableExpense));
  const spent = fixed + everyday;
  const toCome = complete ? 0 : Math.max(0, forecastSpend(key).total - spent);
  const saved = income - spent - toCome;
  return {
    key, complete, income, expected, fixed, everyday, spent, toCome, saved,
    rate: income > 0 ? saved / income : null,
    hit: saved >= TARGET,
  };
}

/** The months the period covers (oldest first), split into full months and the one in progress. */
function buildModel() {
  const keys = MONTHS.map((m) => m.key);
  const inRange = view.period === 'all' ? keys : keys.slice(-Number(view.period));
  const months = inRange.map(monthFigures);
  const full = months.filter((m) => m.complete);
  const current = months.find((m) => !m.complete) || null;
  const totals = {
    income: full.reduce((s, m) => s + m.income, 0),
    spent: full.reduce((s, m) => s + m.spent, 0),
    fixed: full.reduce((s, m) => s + m.fixed, 0),
    saved: full.reduce((s, m) => s + m.saved, 0),
    hits: full.filter((m) => m.hit).length,
  };
  return { months, full, current, totals };
}

// ============================================================
// WHAT YOU KEPT — the savings tiles
// ============================================================

const ROLLING = 3; // months in the Average saved tile's rolling window

/**
 * The rolling average saved at each of `full` (full months, oldest first):
 * that month and the ROLLING − 1 full months before it, reaching back
 * before the period where there's data.
 *   [{ to, from, avg }] — `from` and `to` are the window's first and last month keys
 */
function rollingSaved(full) {
  if (!full.length) return [];
  const keys = MONTHS.map((m) => m.key);
  const first = keys.indexOf(full[0].key);
  const before = keys.slice(Math.max(0, first - (ROLLING - 1)), first).map(monthFigures).filter((m) => m.complete);
  const series = [...before, ...full];
  return full.map((m, i) => {
    const end = before.length + i;
    const window = series.slice(Math.max(0, end - ROLLING + 1), end + 1);
    return { to: m.key, from: window[0].key, avg: average(window.map((w) => w.saved)) };
  });
}

function setNote(id, text, tone = '') {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.remove('is-positive', 'is-negative');
  if (tone) el.classList.add(tone);
}

function renderSavingsTiles({ months, full, current, totals }) {
  const n = full.length;
  document.getElementById('sum-saved').innerHTML = moneyMarkup(currency(totals.saved));
  setNote('sum-saved-note', n ? `${plural(n, 'full month')} · since ${MONTH_LABEL(full[0].key)}` : 'No full months yet');

  const forecast = document.getElementById('sum-forecast-note');
  forecast.hidden = !current;
  if (current) {
    forecast.textContent = `${monthName(current.key)} on course for ${currencyShort(current.saved)}`;
    forecast.className = `stat-tile__delta ${current.hit ? 'is-positive' : 'is-negative'}`;
    forecast.title = 'Forecast: income (including any salary still expected) minus the month-end spending forecast';
  }

  // Average saved, as a 3-month rolling window: the figure is the latest
  // three full months, against the target. The bars are the same average
  // taken at each month of the period, so the trend shows without one big
  // or lean month swinging it; the first few reach back before the period
  // where there's data, and average what there is at the very start.
  const rolling = rollingSaved(full);
  const latest = rolling[n - 1];
  document.getElementById('sum-avg-saved').innerHTML = n ? moneyMarkup(currency(latest.avg)) : '—';
  if (n) {
    const gap = latest.avg - TARGET;
    const span = latest.from === latest.to ? shortMonth(latest.to) : `${shortMonth(latest.from)}–${shortMonth(latest.to)}`;
    setNote('sum-avg-saved-note', `${span} · ${currencyShort(Math.abs(gap))} ${gap >= 0 ? 'above' : 'below'} target`, gap >= 0 ? 'is-positive' : 'is-negative');
    document.getElementById('sum-avg-saved-note').title = `Average of ${MONTH_LABEL(latest.from)} to ${MONTH_LABEL(latest.to)}, against the ${currencyShort(TARGET)} monthly target`;
  } else setNote('sum-avg-saved-note', `Last ${ROLLING} full months`);

  const bars = document.getElementById('sum-avg-bars');
  const peak = Math.max(TARGET, ...rolling.map((r) => r.avg));
  bars.hidden = !n;
  bars.style.setProperty('--target', `${(TARGET / peak) * 100}%`);
  bars.innerHTML = rolling.map((r, i) => {
    const tone = r.avg < 0 ? 'is-negative' : r.avg >= TARGET ? 'is-hit' : '';
    const height = r.avg > 0 ? Math.max(8, (r.avg / peak) * 100) : 8; // a window that lost money is a short rose stub
    return `<i class="${tone}" style="height:${height}%; --i:${i}" title="${MONTH_LABEL(r.to)}: ${ROLLING}-month average ${currencyShort(r.avg)}"></i>`;
  }).join('');

  // Savings rate: what share of income was kept, and (the gold tick) the share the target needs.
  const rate = totals.income > 0 ? totals.saved / totals.income : null;
  document.getElementById('sum-rate').textContent = rate === null ? '—' : percent(rate);
  document.getElementById('sum-rate-bar').style.width = `${Math.max(0, Math.min(1, rate || 0)) * 100}%`;
  const needs = n && totals.income > 0 ? (TARGET * n) / totals.income : null;
  setNote('sum-rate-note', needs === null ? 'Of income kept' : `Of income kept · target ${percent(needs)}`,
    needs === null ? '' : rate >= needs ? 'is-positive' : 'is-negative');
  const tick = document.getElementById('sum-rate-tick');
  tick.hidden = needs === null || needs > 1;
  if (!tick.hidden) tick.style.left = `${needs * 100}%`;

  // Best month, and the leanest one beneath it for the other end of the range.
  const best = full.reduce((top, m) => (!top || m.saved > top.saved ? m : top), null);
  document.getElementById('sum-best').innerHTML = best ? moneyMarkup(currency(best.saved)) : '—';
  setNote('sum-best-note', best ? `${MONTH_LABEL(best.key)}${best.rate !== null ? ` · ${percent(best.rate)} of income` : ''}` : 'No full months yet');
  const worst = n > 1 ? full.reduce((low, m) => (m.saved < low.saved ? m : low)) : null;
  const worstEl = document.getElementById('sum-worst');
  worstEl.hidden = !worst;
  if (worst) {
    worstEl.innerHTML = `<span>Leanest · ${MONTH_LABEL(worst.key)}</span>`
      + `<b class="${worst.saved < 0 ? 'is-negative' : ''}">${currencyShort(worst.saved)}</b>`;
  }

  // On target: "7 of 9", a bead per month (with its initial while there's
  // room — up to a year), and the current run.
  document.getElementById('sum-on-target').textContent = n ? `${totals.hits} of ${n}` : '—';
  const beads = document.getElementById('sum-beads');
  beads.classList.toggle('is-labelled', n <= 12);
  beads.innerHTML = full.map((m) =>
    `<li class="${m.hit ? 'is-hit' : ''}" title="${MONTH_LABEL(m.key)}: ${currencyShort(m.saved)}"><i></i><span>${monthName(m.key)[0]}</span></li>`).join('');
  let streak = 0;
  for (let i = full.length - 1; i >= 0 && full[i].hit; i -= 1) streak += 1;
  const lastHit = [...full].reverse().find((m) => m.hit);
  setNote('sum-on-target-note',
    !n ? `Months saving ${currencyShort(TARGET)}+`
      : streak >= 2 ? `${streak} months in a row`
        : streak === 1 ? `Met in ${monthName(full[n - 1].key)}`
          : lastHit ? `Last met in ${MONTH_LABEL(lastHit.key)}` : 'Not met yet',
    streak ? 'is-positive' : '');

  renderCumulativeChart(months);
}

/**
 * The Total saved tile's chart: savings piling up month by month (the
 * month in progress dashed on, as a forecast) against a dotted gold line
 * climbing by the target each month.
 */
function renderCumulativeChart(months) {
  let sum = 0;
  const saved = months.map((m) => (sum += m.saved));
  const target = months.map((_, i) => TARGET * (i + 1));
  const forecastFrom = months.findIndex((m) => !m.complete);

  const accent = cssVar('--accent');
  const gold = cssVar('--gold');
  const muted = cssVar('--text-faint');
  const surface = cssVar('--surface');
  const canvas = document.getElementById('sum-cumulative-chart');
  if (cumulativeChart) cumulativeChart.destroy();
  canvas.parentElement.querySelector('.chart-tooltip')?.classList.remove('is-visible');
  const firstDraw = isFirstDraw('cumulative');
  cumulativeChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: months.map((m) => shortMonth(m.key)),
      datasets: [
        {
          label: 'Saved',
          data: saved,
          borderColor: accent,
          borderWidth: 2,
          cubicInterpolationMode: 'monotone',
          fill: 'origin',
          backgroundColor: ({ chart }) => {
            const { ctx, chartArea } = chart;
            if (!chartArea) return 'transparent';
            const wash = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            wash.addColorStop(0, fade(accent, 0.2));
            wash.addColorStop(1, fade(accent, 0));
            return wash;
          },
          // The forecast month is dashed on from the last full month.
          segment: { borderDash: (c) => (forecastFrom >= 0 && c.p1DataIndex >= forecastFrom ? [4, 4] : undefined) },
          pointRadius: (c) => (c.dataIndex === months.length - 1 ? 4 : 0),
          pointHoverRadius: 4,
          pointBackgroundColor: surface,
          pointBorderColor: accent,
          pointBorderWidth: 2,
          order: 1,
        },
        {
          label: 'Savings target',
          data: target,
          borderColor: gold,
          borderWidth: 1.25,
          borderDash: [1, 3],
          pointRadius: 0,
          pointHoverRadius: 3,
          pointBackgroundColor: gold,
          order: 2,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      layout: { padding: { top: 6, left: 2, right: 6 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: htmlTooltip((points) => {
            const m = months[points[0].dataIndex];
            return {
              title: `${MONTH_LABEL(m.key)}${m.complete ? '' : ' (forecast)'}`,
              rows: [
                { label: 'Saved to date', value: currency(saved[points[0].dataIndex]), swatch: accent },
                { label: 'Target to date', value: currency(target[points[0].dataIndex]), swatch: gold },
              ],
            };
          }),
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { maxRotation: 0, autoSkipPadding: 12, padding: 4, color: muted, font: { family: 'Geist', size: 11 } },
        },
        y: { display: false, suggestedMin: 0, grace: '8%' },
      },
      animation: firstDraw ? { duration: 1000, easing: 'easeOutQuart' } : { duration: 400 },
    },
  });
}

// ============================================================
// MONTH BY MONTH — the flow chart and the ledger
// ============================================================

/** Opens a month on the Overview (the month is handed over through sessionStorage and read once by state.js). */
function openMonth(key) {
  try { sessionStorage.setItem('ledger-month', key); } catch { /* storage unavailable */ }
  window.location.href = 'index.html';
}

function renderFlowChart({ months, full }) {
  const colors = {
    income: cssVar('--accent'),
    fixed: cssVar('--forecast-fixed'),
    everyday: cssVar('--forecast-spent'),
    toCome: cssVar('--forecast-projected'),
    gold: cssVar('--gold'),
  };
  const text = cssVar('--text');
  const faint = cssVar('--text-faint');
  const surface = cssVar('--surface');
  const segment = { borderColor: surface, borderWidth: 2, borderSkipped: false, borderRadius: 5, maxBarThickness: 26, categoryPercentage: 0.72, barPercentage: 0.94 };
  const forecastFrom = months.findIndex((m) => !m.complete);
  const swatches = { Income: fade(colors.income, 0.85), Fixed: colors.fixed, Everyday: colors.everyday, 'Still to come': colors.toCome, Saved: colors.gold };

  document.getElementById('sum-flow-meta').textContent = `${plural(months.length, 'month')} · choose one to open it`;
  document.getElementById('sum-flow-legend-forecast').hidden = forecastFrom < 0;

  const canvas = document.getElementById('sum-flow-chart');
  if (flowChart) flowChart.destroy();
  canvas.parentElement.querySelector('.chart-tooltip')?.classList.remove('is-visible');
  const firstDraw = isFirstDraw('flow');
  flowChart = new Chart(canvas, {
    data: {
      labels: months.map((m) => shortMonth(m.key)),
      datasets: [
        { type: 'bar', label: 'Income', data: months.map((m) => m.income), backgroundColor: fade(colors.income, 0.85), ...segment, stack: 'in', order: 2 },
        { type: 'bar', label: 'Fixed', data: months.map((m) => m.fixed), backgroundColor: colors.fixed, ...segment, stack: 'out', order: 2 },
        { type: 'bar', label: 'Everyday', data: months.map((m) => m.everyday), backgroundColor: colors.everyday, ...segment, stack: 'out', order: 2 },
        { type: 'bar', label: 'Still to come', data: months.map((m) => m.toCome), backgroundColor: stripePattern(colors.toCome), ...segment, stack: 'out', order: 2 },
        {
          type: 'line',
          label: 'Saved',
          data: months.map((m) => m.saved),
          borderColor: colors.gold,
          borderWidth: 2,
          cubicInterpolationMode: 'monotone',
          segment: { borderDash: (c) => (forecastFrom >= 0 && c.p1DataIndex >= forecastFrom ? [4, 4] : undefined) },
          pointRadius: 3,
          pointHoverRadius: 4.5,
          pointBackgroundColor: (c) => (months[c.dataIndex]?.complete ? colors.gold : surface),
          pointBorderColor: colors.gold,
          pointBorderWidth: 1.5,
          order: 1,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick: (_event, elements) => { if (elements.length) openMonth(months[elements[0].index].key); },
      onHover: (event, elements) => { event.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          filter: (item) => item.raw !== 0 || item.dataset.type === 'line',
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          external: htmlTooltip((points) => {
            const m = months[points[0].dataIndex];
            return {
              title: `${MONTH_LABEL(m.key)}${m.complete ? '' : ' (forecast)'}`,
              rows: points.map((p) => ({ label: p.dataset.label, value: currency(p.raw), swatch: swatches[p.dataset.label] })),
              footer: m.rate === null ? null : ['Savings rate', percent(m.rate)],
            };
          }),
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { display: false },
          ticks: {
            padding: 6,
            font: (c) => ({ family: 'Geist', size: 11.5, weight: c.index === months.length - 1 ? '600' : '400' }),
            color: (c) => (c.index === months.length - 1 ? text : faint),
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          border: { display: false, dash: [2, 4] },
          grid: { color: cssVar('--border-strong'), lineWidth: 1, drawTicks: false },
          ticks: { color: faint, padding: 10, maxTicksLimit: 5, font: { family: 'Geist', size: 11 }, callback: (v) => currencyShort(v) },
        },
      },
      animation: firstDraw
        ? { duration: 800, easing: 'easeOutQuart', delay: (c) => (c.type === 'data' && c.mode === 'default' ? c.dataIndex * 45 : 0) }
        : { duration: 450 },
    },
  });

  renderFlowSummary(full);
}

/** The foot of the flow tile: average income, spending and savings per full month, and which way spending is heading. */
function renderFlowSummary(full) {
  const items = [];
  if (full.length) {
    items.push({ label: 'Average income', value: currencyShort(average(full.map((m) => m.income))), note: { text: 'Salary + interest' } });
    const avgSpent = average(full.map((m) => m.spent));
    items.push({ label: 'Average spending', value: currencyShort(avgSpent), note: { text: `${percent(average(full.map((m) => m.fixed)) / (avgSpent || 1))} fixed costs` } });
    const avgSaved = average(full.map((m) => m.saved));
    items.push({
      label: 'Average saved',
      value: currencyShort(avgSaved),
      note: { text: `${currencyShort(Math.abs(avgSaved - TARGET))} ${avgSaved >= TARGET ? 'above' : 'below'} target`, tone: avgSaved >= TARGET ? 'is-positive' : 'is-negative' },
    });
    // Spending direction: the last three full months against the three before (or what there is).
    const span = Math.min(3, Math.floor(full.length / 2));
    if (span >= 1) {
      const recent = average(full.slice(-span).map((m) => m.spent));
      const before = average(full.slice(-2 * span, -span).map((m) => m.spent));
      const change = recent - before;
      items.push({
        label: 'Spending trend',
        value: `${change > 0 ? '↑' : '↓'} ${currencyShort(Math.abs(change))}`,
        note: { text: span === 1 ? `${monthName(full[full.length - 1].key)} vs the month before` : `A month, last ${span} vs the ${span} before`, tone: change > 0 ? 'is-negative' : 'is-positive' },
      });
    }
  }
  document.getElementById('sum-flow-summary').innerHTML = items.map((item) => `
    <div class="trend-summary__item">
      <dt>${item.label}</dt>
      <dd class="trend-summary__value">${item.value}</dd>
      <dd class="trend-summary__note ${item.note.tone || ''}">${item.note.text}</dd>
    </div>`).join('');
}

/**
 * The ledger: one row per month, newest first — income, spending, what
 * was saved, the rate, and a bar against the target (the gold tick).
 * The foot totals the full months. Choosing a row opens it on the Overview.
 */
function renderLedger({ months, full, totals }) {
  // The bar's scale runs to one and a half times the target, so the tick sits two thirds along.
  const scale = TARGET * 1.5;
  const bar = (saved) => {
    const width = Math.max(0, Math.min(1, saved / scale)) * 100;
    const gap = saved - TARGET;
    return `
      <span class="ledger-bar${gap >= 0 ? ' is-hit' : ''}">
        <span class="ledger-bar__track"><span class="ledger-bar__fill" style="width:${width}%"></span><span class="ledger-bar__tick" style="left:${(TARGET / scale) * 100}%"></span></span>
        <span class="ledger-bar__gap">${signedShort(gap)}</span>
      </span>`;
  };

  document.getElementById('sum-ledger-body').innerHTML = months.slice().reverse().map((m, i) => {
    const est = m.expected.length
      ? `<span class="est-badge" title="Assumes last month's salary for ${escapeAttr(m.expected.map((e) => e.person).join(', '))}">Est.</span>` : '';
    return `
      <tr class="${m.complete ? '' : 'is-forecast'}" data-month="${m.key}" style="--i:${Math.min(i, 12)}">
        <th scope="row" class="ledger-table__month">
          <a href="index.html" data-month="${m.key}">${monthName(m.key)} <span class="ledger-table__year">${m.key.slice(0, 4)}</span></a>
          ${m.complete ? '' : '<span class="ledger-table__flag">Forecast</span>'}
        </th>
        <td class="ledger-table__num"><span class="ledger-table__figure">${currency(m.income)}${est}</span></td>
        <td class="ledger-table__num">${currency(m.spent + m.toCome)}</td>
        <td class="ledger-table__num ledger-table__saved ${m.saved < 0 ? 'is-negative' : ''}">${currency(m.saved)}</td>
        <td class="ledger-table__num ledger-table__rate">${m.rate === null ? '—' : percent(m.rate)}</td>
        <td class="ledger-table__target">${bar(m.saved)}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="6" class="ledger-table__empty">No months to show yet</td></tr>';

  document.getElementById('sum-ledger-foot').innerHTML = full.length ? `
    <tr>
      <th scope="row">Full months <span class="ledger-table__year">${full.length}</span></th>
      <td class="ledger-table__num">${currency(totals.income)}</td>
      <td class="ledger-table__num">${currency(totals.spent)}</td>
      <td class="ledger-table__num ledger-table__saved">${currency(totals.saved)}</td>
      <td class="ledger-table__num">${totals.income > 0 ? percent(totals.saved / totals.income) : '—'}</td>
      <td class="ledger-table__target"><span class="ledger-table__hits">${totals.hits} of ${full.length} on target</span></td>
    </tr>` : '';
}

function initLedger() {
  const body = document.getElementById('sum-ledger-body');
  body.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-month]');
    if (!row) return;
    event.preventDefault();
    openMonth(row.dataset.month);
  });
}

// ============================================================
// ANALYSIS — highlights, people, categories
// ============================================================

/** The expense categories, in CATEGORIES order (income and refunds left out). */
const EXPENSE_CATEGORIES = CATEGORIES.filter((c) => isExpense({ category: c.id }));

/** Spend per expense category for each month: { groceries: [212, 198, ...], ... } (in `months` order). */
function categoryMatrix(months) {
  const matrix = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.id, months.map(() => 0)]));
  months.forEach((m, i) => {
    getMonthTransactions(m.key).filter(isExpense).forEach((t) => {
      if (matrix[t.category]) matrix[t.category][i] += Math.abs(t.amount);
    });
  });
  return matrix;
}

/**
 * Up to six plain-English observations about the period, most telling
 * first: the best month, the savings target, the categories that moved
 * most in the latest full month against their usual, the spending
 * direction, fixed costs' share, and how the month in progress is going.
 */
function renderHighlights({ months, full, current, totals }, matrix) {
  const items = [];
  const em = (text) => `<em>${text}</em>`;
  const n = full.length;
  document.getElementById('sum-highlights-meta').textContent = n ? plural(n, 'full month') : '';

  if (n) {
    const best = full.reduce((top, m) => (m.saved > top.saved ? m : top));
    items.push({
      tone: 'is-positive',
      html: `<b>${MONTH_LABEL(best.key)}</b> was the best month: ${em(currencyShort(best.saved))} saved${best.rate !== null ? `, ${percent(best.rate)} of income` : ''}.`,
    });
    items.push({
      tone: totals.hits >= n / 2 ? 'is-positive' : 'is-negative',
      html: `The ${currencyShort(TARGET)} savings target was met in ${em(`${totals.hits} of ${n}`)} months.`,
    });
  }

  // Categories in the latest full month against their average over the full months before it.
  if (n >= 2) {
    const fullIndex = months.map((m, i) => (m.complete ? i : -1)).filter((i) => i >= 0);
    const latest = fullIndex[fullIndex.length - 1];
    const earlier = fullIndex.slice(0, -1);
    const moves = EXPENSE_CATEGORIES.map((c) => {
      const usual = average(earlier.map((i) => matrix[c.id][i]));
      const now = matrix[c.id][latest];
      // Regular categories only: one that's usually nothing (a holiday) isn't "down" in a month without one.
      const regular = earlier.filter((i) => matrix[c.id][i] > 0).length >= Math.ceil((earlier.length * 2) / 3);
      return { c, usual, now, change: now - usual, regular };
    }).filter((move) => move.regular && (move.usual >= 25 || move.now >= 25));
    const rise = moves.reduce((top, m) => (m.change > (top?.change ?? 0) ? m : top), null);
    const fall = moves.reduce((low, m) => (m.change < (low?.change ?? 0) ? m : low), null);
    const latestName = monthName(months[latest].key);
    if (rise && rise.change >= 30) {
      items.push({
        tone: 'is-negative',
        html: `<b>${rise.c.label}</b> rose to ${em(currencyShort(rise.now))} in ${latestName}, ${currencyShort(rise.change)} above its usual ${currencyShort(rise.usual)}.`,
      });
    }
    if (fall && fall.change <= -30) {
      items.push({
        tone: 'is-positive',
        html: `<b>${fall.c.label}</b> fell to ${em(currencyShort(fall.now))} in ${latestName}, ${currencyShort(-fall.change)} below its usual ${currencyShort(fall.usual)}.`,
      });
    }

    const span = Math.min(3, Math.floor(n / 2));
    const recent = average(full.slice(-span).map((m) => m.spent));
    const before = average(full.slice(-2 * span, -span).map((m) => m.spent));
    const change = recent - before;
    if (Math.abs(change) >= 1) {
      items.push({
        tone: change > 0 ? 'is-negative' : 'is-positive',
        html: `Spending ${span === 1 ? `in ${latestName}` : `over the last ${span} months averaged`} ${em(currencyShort(recent))}, ${currencyShort(Math.abs(change))} ${change > 0 ? 'more' : 'less'} than ${span === 1 ? 'the month before' : `the ${span} before`}.`,
      });
    }
  }

  if (n && totals.spent > 0) {
    items.push({
      tone: '',
      html: `Fixed costs took ${em(percent(totals.fixed / totals.spent))} of spending, about ${currencyShort(totals.fixed / n)} a month.`,
    });
  }

  if (current) {
    const gap = current.saved - TARGET;
    items.push({
      tone: gap >= 0 ? 'is-positive' : 'is-negative',
      html: `<b>${monthName(current.key)}</b> is on course to save ${em(currencyShort(current.saved))}, ${currencyShort(Math.abs(gap))} ${gap >= 0 ? 'above' : 'short of'} target.`,
    });
  }

  document.getElementById('sum-highlights').innerHTML = items.slice(0, 6).map((item, i) => `
    <li class="highlights__item ${item.tone}" style="--i:${i}">
      <span class="highlights__marker" aria-hidden="true">${pad2(i + 1)}</span>
      <p>${item.html}</p>
    </li>`).join('') || '<li class="highlights__empty">Highlights appear once there\'s a full month of data.</li>';
}

/**
 * Who saved: each person's savings over the full months (the joint
 * account split evenly between them, as on the Overview), with their
 * share of the household's savings as a bar and their savings rate.
 */
function renderPeople({ full }) {
  const totals = {};
  full.forEach((m) => savingsByPerson(m.key).forEach((p) => {
    const t = totals[p.person] || (totals[p.person] = { person: p.person, income: 0, spent: 0, saved: 0 });
    t.income += p.income;
    t.spent += p.spent;
    t.saved += p.saved;
  }));
  const rows = Object.values(totals).sort((a, b) => b.saved - a.saved);
  const top = Math.max(1, ...rows.map((r) => r.saved));
  const household = rows.reduce((s, r) => s + Math.max(0, r.saved), 0);
  document.getElementById('sum-people-meta').textContent = full.length ? 'Joint account split evenly' : '';

  document.getElementById('sum-people').innerHTML = rows.map((r, i) => `
    <li class="budget-item${r.saved < 0 ? ' is-over' : ''}" style="--i:${i}">
      <div class="budget-item__header">
        <span class="budget-item__category"><i class="people-list__dot" style="background:${spendOwnerColor(r.person)}"></i>${escapeAttr(r.person)}</span>
        <span class="budget-item__summary">
          <span class="budget-item__amounts">${currencyShort(r.saved)} saved</span>
          <span class="budget-item__status">${r.income > 0 ? `${percent(r.saved / r.income)} kept` : '—'}</span>
        </span>
      </div>
      <div class="budget-item__bar" role="img" aria-label="${escapeAttr(r.person)}: ${currencyShort(r.saved)} saved">
        <span class="budget-item__track"><span class="budget-item__fill" style="width:${Math.max(0, r.saved / top) * 100}%; background:${spendOwnerColor(r.person)}"></span></span>
      </div>
      <p class="budget-item__note">${currencyShort(r.income)} in · ${currencyShort(r.spent)} out${household > 0 && r.saved > 0 ? ` · ${percent(r.saved / household)} of the household's savings` : ''}</p>
    </li>`).join('') || '<li class="legend__name">No full months yet</li>';

  renderPeopleChart(full, rows.map((r) => r.person));
}

/** A spend owner's colour as a hex value for Chart.js ('var(--user-1)' -> '#3a6fe0'). */
const ownerHex = (person) => cssVar(spendOwnerColor(person).slice(4, -1));

/** Under Who saved: each person's savings month by month, side by side. */
function renderPeopleChart(full, everyone) {
  const wrap = document.getElementById('sum-people-chart-wrap');
  wrap.hidden = !full.length || !everyone.length;
  if (peopleChart) peopleChart.destroy();
  peopleChart = null;
  if (wrap.hidden) return;

  const byMonth = full.map((m) => Object.fromEntries(savingsByPerson(m.key).map((p) => [p.person, p.saved])));
  const faint = cssVar('--text-faint');
  const canvas = document.getElementById('sum-people-chart');
  canvas.parentElement.querySelector('.chart-tooltip')?.classList.remove('is-visible');
  const firstDraw = isFirstDraw('people');
  peopleChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: full.map((m) => shortMonth(m.key)),
      datasets: everyone.map((person) => ({
        label: person,
        data: byMonth.map((saved) => saved[person] || 0),
        backgroundColor: ownerHex(person),
        borderRadius: 3,
        borderSkipped: false,
        maxBarThickness: 10,
        categoryPercentage: 0.7,
        barPercentage: 0.9,
      })),
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: htmlTooltip((points) => ({
            title: MONTH_LABEL(full[points[0].dataIndex].key),
            rows: points.map((p) => ({ label: p.dataset.label, value: currency(p.raw), swatch: ownerHex(p.dataset.label) })),
            footer: ['Household', currency(points.reduce((sum, p) => sum + p.raw, 0))],
          })),
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8, color: faint, font: { family: 'Geist', size: 10.5 } } },
        y: {
          beginAtZero: true,
          border: { display: false, dash: [2, 4] },
          grid: { color: cssVar('--border-strong'), drawTicks: false },
          ticks: { color: faint, padding: 8, maxTicksLimit: 4, font: { family: 'Geist', size: 10.5 }, callback: (v) => currencyShort(v) },
        },
      },
      animation: firstDraw
        ? { duration: 700, easing: 'easeOutQuart', delay: (c) => (c.type === 'data' && c.mode === 'default' ? c.dataIndex * 35 : 0) }
        : { duration: 400 },
    },
  });
}

/**
 * Where it went: categories down the side, months across. Every month
 * with spending is filled with the category's colour, brightening
 * the further it ran above that category's own monthly average, so the
 * unusual months stand out and steady costs stay quiet. Then the
 * average, and the latest full month against the months before it.
 */
function renderCategories({ months, full }, matrix) {
  const fullIndex = months.map((m, i) => (m.complete ? i : -1)).filter((i) => i >= 0);
  const latest = fullIndex[fullIndex.length - 1];
  const rows = EXPENSE_CATEGORIES
    .map((c) => ({ c, values: matrix[c.id], total: matrix[c.id].reduce((s, v) => s + v, 0) }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  const head = `
    <thead>
      <tr>
        <th scope="col" class="category-matrix__name">Category</th>
        ${months.map((m, i) => `<th scope="col" class="category-matrix__month${m.complete ? '' : ' is-forecast'}">${shortMonth(m.key)}${i === 0 || m.key.endsWith('-01') ? `<span>${m.key.slice(2, 4)}</span>` : ''}${m.complete ? '' : '<span>so far</span>'}</th>`).join('')}
        <th scope="col" class="category-matrix__stat">Avg</th>
        <th scope="col" class="category-matrix__stat">${latest !== undefined ? shortMonth(months[latest].key) : 'Latest'} vs avg</th>
      </tr>
    </thead>`;

  const body = rows.map(({ c, values }) => {
    const avg = full.length ? average(fullIndex.map((i) => values[i])) : 0;
    const before = average(fullIndex.slice(0, -1).map((i) => values[i]));
    const change = latest !== undefined && fullIndex.length >= 2 && before > 0 ? (values[latest] - before) / before : null;
    const trend = latest !== undefined && fullIndex.length >= 2 && values[latest] === 0 ? '<span class="category-matrix__steady">None</span>'
      : change === null ? '<span class="category-matrix__steady">—</span>'
      : Math.abs(change) < 0.1 ? '<span class="category-matrix__steady">Steady</span>'
        : `<span class="${change > 0 ? 'is-negative' : 'is-positive'}">${change > 0 ? '↑' : '↓'} ${percent(Math.abs(change))}</span>`;
    return `
      <tr>
        <th scope="row" class="category-matrix__name"><i style="background:${c.color}"></i>${c.label}</th>
        ${values.map((v, i) => {
          // The category's colour dimmed towards black, at its brightest at twice the average or more.
          const above = avg > 0 ? Math.max(0, Math.min(1, (v - avg) / avg)) : 0;
          const strength = Math.round(70 + above * 30);
          return `<td class="category-matrix__cell${months[i].complete ? '' : ' is-forecast'}"${v ? ` style="--tint:color-mix(in srgb, ${c.color} ${strength}%, black)"` : ''} title="${c.label}, ${MONTH_LABEL(months[i].key)}: ${currency(v)}">${v ? currencyShort(v) : '<span class="category-matrix__none">—</span>'}</td>`;
        }).join('')}
        <td class="category-matrix__stat">${full.length ? currencyShort(avg) : '—'}</td>
        <td class="category-matrix__stat">${trend}</td>
      </tr>`;
  }).join('');

  document.getElementById('sum-categories').innerHTML = rows.length
    ? `${head}<tbody>${body}</tbody>`
    : '<tbody><tr><td class="ledger-table__empty">No spending to show yet</td></tr></tbody>';
}

// ============================================================
// PAGE
// ============================================================

function renderAll() {
  const model = buildModel();
  const matrix = categoryMatrix(model.months);
  renderSavingsTiles(model);
  renderFlowChart(model);
  renderLedger(model);
  renderHighlights(model, matrix);
  renderPeople(model);
  renderCategories(model, matrix);
}

/**
 * The ‹ 12 months › stepper in the top bar, which works like Overview's
 * month: the arrows step between 6 months, 12 months and All (stopping at
 * either end), clicking the label opens the list, ←/→ step when you're not
 * typing, and on touch screens a sideways swipe across the page steps too.
 * The page slides the way you moved (motion.js).
 */
function initPeriod() {
  const select = document.getElementById('period-select');
  const sync = () => {
    const index = PERIODS.indexOf(view.period);
    document.getElementById('period-label').textContent = select.options[index].textContent;
    select.value = view.period;
    document.getElementById('period-prev').disabled = index <= 0;
    document.getElementById('period-next').disabled = index >= PERIODS.length - 1;
  };
  const choose = (period) => {
    if (!period || period === view.period) return;
    const direction = PERIODS.indexOf(period) > PERIODS.indexOf(view.period) ? 1 : -1;
    motion.monthTransition(direction, () => {
      view.period = period;
      try { localStorage.setItem(PERIOD_KEY, period); } catch { /* storage unavailable */ }
      sync();
      renderAll();
    });
  };
  const step = (delta) => choose(PERIODS[PERIODS.indexOf(view.period) + delta]);
  const canStep = (delta) => Boolean(PERIODS[PERIODS.indexOf(view.period) + delta]);

  select.addEventListener('change', () => choose(select.value));
  document.getElementById('period-prev').addEventListener('click', () => step(-1));
  document.getElementById('period-next').addEventListener('click', () => step(1));
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  });
  initSwipeStep(step, canStep);
  sync();
}

pageHooks.renderAll = renderAll; // the account filter redraws through this (filters.js)

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  // Straight away when this device has a copy of the data; otherwise after the auth check (data.js).
  const session = await pageSession;
  if (!session) return; // auth.js is already redirecting to login.html

  initUserMenu(session);
  initPageHeading(session);
  document.getElementById('signout-button').addEventListener('click', signOut);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  try {
    await accountsReady;
    indexEvents(); // the month in progress forecasts with upcoming calendar events
    state.activeAccounts = new Set(ACCOUNTS.map((a) => a.id));
    Object.assign(accountById, Object.fromEntries(ACCOUNTS.map((a) => [a.id, a])));

    initAccountFilter();
    initPeriod();
    initLedger();

    renderAll();
    finishLoading();
    // The charts hold theme colours, so they redraw when light/dark changes (theme.js).
    document.addEventListener('ledger:theme-changed', renderAll);
    initSync({
      onChange: () => {
        indexEvents();
        renderAll();
      },
    });
  } catch (error) {
    showLoadError(error);
  }
});
