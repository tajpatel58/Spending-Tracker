/**
 * sync.js
 * ---------------------------------------------------------------------
 * The "Updated 9:14 am" control beside the page heading. It shows how
 * fresh the data on screen is, spins while the background check runs,
 * and clicking it pulls fresh data from Supabase on demand (handy after
 * a manual data refresh). The fetching itself lives in data.js.
 * ---------------------------------------------------------------------
 */

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

/**
 * Wires up the control and starts a quiet background check. Call once the
 * page has rendered. `onChange` re-renders the page when new data arrives.
 */
function initSync({ onChange }) {
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
  // Drawn from the saved copy? Quietly check for anything newer.
  if (dataStatus.fromCache) refreshData().catch((error) => console.error('[Ledger data] Background refresh failed:', error));
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
  indicator.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" stroke-width="2"/>
    <path d="M20 4v4.5h-4.5" stroke="currentColor" stroke-width="2"/></svg>`;
  document.body.appendChild(indicator);
  document.documentElement.classList.add('has-pull-refresh');

  let startY = null;
  let distance = 0;
  let busy = false;

  const draw = () => {
    const progress = Math.min(1, distance / THRESHOLD);
    indicator.style.transform = `translate(-50%, ${distance - 48}px) rotate(${progress * 270}deg)`;
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
