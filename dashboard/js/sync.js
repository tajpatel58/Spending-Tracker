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

  button.addEventListener('click', async () => {
    if (checking) return;
    try {
      const { changed } = await refreshData();
      showToast(changed
        ? { message: 'Data refreshed — showing the latest' }
        : { message: 'Already up to date', tone: 'info', duration: 2500 });
    } catch (error) {
      console.error('[Ledger data] Refresh failed:', error);
      showToast({ message: "Couldn't refresh — showing your saved data", tone: 'error' });
    }
  });

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
