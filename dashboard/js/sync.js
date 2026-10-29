/**
 * sync.js
 * ---------------------------------------------------------------------
 * The "Updated 9:14 am" control beside the page heading. It shows how
 * fresh the data on screen is, spins while the background check runs,
 * and clicking it pulls fresh data from Supabase on demand (handy after
 * a manual data refresh). The fetching itself lives in data.js.
 * ---------------------------------------------------------------------
 */

import { dataStatus, refreshData } from './data.js';
import { afterEntrance } from './state.js';
import { showToast } from './toast.js';

/** "just now", "5 min ago", "9:14 am", "yesterday 6:02 pm", "12 Oct". */
function updatedAgo(time) {
  if (!time) return 'not yet';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const then = new Date(time);
  const clock = then.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '');
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (then.toDateString() === today.toDateString()) return `at ${clock}`;
  if (then.toDateString() === yesterday.toDateString()) return `yesterday ${clock}`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// A page drawn from a copy checked this recently doesn't check again on
// load, so moving between Overview and Calendar doesn't re-download
// everything each time. Clicking "Updated…" or pulling down always checks.
const FRESH_FOR_MS = 5 * 60000;

/**
 * Wires up the control and starts a quiet background check. Call once the
 * page has rendered. `onChange` re-renders the page when new data arrives.
 */
export function initSync({ onChange }) {
  const button = document.getElementById('sync-status');
  const label = document.getElementById('sync-label');
  let checking = false;

  const render = () => {
    button.classList.toggle('is-syncing', checking);
    label.textContent = checking ? 'Checking…' : `Updated ${updatedAgo(dataStatus.syncedAt)}`;
    button.title = checking ? 'Checking Supabase for new data' : 'Refresh data';
  };

  document.addEventListener('ledger:sync', (event) => {
    checking = event.detail.state === 'checking';
    render();
    // A finished check briefly swaps the refresh icon for a tick that draws itself.
    if (event.detail.state === 'done') {
      button.classList.remove('is-done');
      void button.offsetWidth;
      button.classList.add('is-done');
      clearTimeout(button.doneTimer);
      button.doneTimer = setTimeout(() => button.classList.remove('is-done'), 1800);
    }
  });
  document.addEventListener('ledger:data-changed', (event) => {
    // A new or removed account changes the filters' structure; a quick reload rebuilds them cleanly.
    if (event.detail.accountsChanged) { window.location.reload(); return; }
    onChange();
  });

  button.addEventListener('click', () => { if (!checking) manualRefresh(); });
  initPullToRefresh();

  // Keep "5 min ago" honest, and re-check when coming back to a tab left open.
  setInterval(render, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (dataStatus.syncedAt || 0) > 15 * 60000) {
      refreshData().catch(() => {});
    }
  });

  button.hidden = false;
  render();
  // Drawn from a saved copy that isn't recent? Quietly check for anything newer,
  // once the page has finished drawing in (comparing the data is main-thread work).
  if (dataStatus.fromCache && Date.now() - (dataStatus.syncedAt || 0) > FRESH_FOR_MS) {
    afterEntrance(() => refreshData().catch((error) => console.error('[Ledger data] Background refresh failed:', error)));
  }
}

/** Pulls fresh data on request and says how it went (Refresh button and pull-to-refresh). */
async function manualRefresh() {
  try {
    const { changed } = await refreshData();
    showToast(changed
      ? { message: 'Data refreshed — showing the latest' }
      : { message: 'Already up to date', tone: 'info', duration: 2500 });
  } catch (error) {
    console.error('[Ledger data] Refresh failed:', error);
    showToast({ message: "Couldn't refresh — showing your saved data", tone: 'error' });
  }
}

/**
 * Pull to refresh, for the installed (home-screen) app only — in a normal
 * browser tab Safari and Chrome already have their own pull-to-reload.
 * Dragging down at the top of the page draws a small indicator that turns
 * with your finger; letting go past the threshold refreshes the data.
 */
function initPullToRefresh() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (!standalone || !('ontouchstart' in window)) return;

  const THRESHOLD = 70;   // px of (damped) pull needed to refresh
  const MAX = 110;
  const indicator = document.createElement('div');
  indicator.className = 'pull-refresh';
  indicator.setAttribute('aria-hidden', 'true');
  // The Ledger monogram: its gold ring draws itself as you pull, then chases while refreshing.
  indicator.innerHTML = `<svg width="22" height="22" viewBox="0 0 64 64" fill="none">
    <circle class="sync-ring" cx="32" cy="32" r="29.5" stroke="var(--gold)" stroke-width="3.2" pathLength="1"/>
    <path transform="translate(20.527 46.412) scale(0.021008 -0.021008)" fill="currentColor" d="M572 1387 485 1374Q466.5 1371.5 457.25 1365.25Q448 1359 448 1347V58Q448 36.5 460.5 27.25Q473 18 497 18H716Q764 18 806.25 36.0Q848.5 54 889.5 101.0Q930.5 148 973.5 236L1064 422Q1066.5 426.5 1068.75 428.75Q1071 431 1074 430Q1078 429.5 1079.0 425.75Q1080 422 1078 415L986 -8Q983 -21 981.25 -24.5Q979.5 -28 977 -28Q970.5 -28 957.75 -21.0Q945 -14 924.25 -7.0Q903.5 0 872 0H79Q74.5 0 72.25 2.0Q70 4 70 6Q70 11.5 81 13L168 26Q187 29 196.0 35.0Q205 41 205 53V1347Q205 1359 196.0 1365.25Q187 1371.5 168 1374L81 1387Q70 1388.5 70 1394Q70 1396.5 72.25 1398.25Q74.5 1400 79 1400H574Q578.5 1400 580.75 1398.25Q583 1396.5 583 1394Q583 1388.5 572 1387Z"/></svg>`;
  document.body.appendChild(indicator);
  document.documentElement.classList.add('has-pull-refresh');
  const ring = indicator.querySelector('.sync-ring');

  let startY = null;
  let distance = 0;
  let busy = false;

  const draw = () => {
    const progress = Math.min(1, distance / THRESHOLD);
    indicator.style.transform = `translate(-50%, ${distance - 48}px)`;
    ring.style.strokeDashoffset = String(1 - progress);
    indicator.style.opacity = String(Math.min(1, distance / 30));
    indicator.classList.toggle('is-armed', distance >= THRESHOLD);
  };
  const reset = () => {
    indicator.classList.add('is-settling');
    distance = 0;
    draw();
    setTimeout(() => indicator.classList.remove('is-settling', 'is-refreshing'), 300);
  };

  window.addEventListener('touchstart', (e) => {
    if (busy || window.scrollY > 0 || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { startY = null; distance = 0; draw(); return; }
    e.preventDefault(); // we're handling this pull, not the page's bounce
    distance = Math.min(MAX, dy * 0.5);
    draw();
  }, { passive: false });

  window.addEventListener('touchend', async () => {
    if (startY === null) return;
    startY = null;
    if (distance < THRESHOLD) { reset(); return; }
    busy = true;
    distance = THRESHOLD;
    indicator.classList.add('is-settling', 'is-refreshing');
    draw();
    await manualRefresh();
    busy = false;
    reset();
  });
}
