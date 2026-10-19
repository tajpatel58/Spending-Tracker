/**
 * auth.js
 * ---------------------------------------------------------------------
 * Google Sign-In via Supabase Auth — shared by login.html and
 * index.html. Handles the Supabase client, the session check that
 * guards each page, and signing in/out.
 * ---------------------------------------------------------------------
 */

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const IS_LOGIN_PAGE = /login\.html$/.test(window.location.pathname);

// The dashboard keeps a copy of your data on this device so pages open
// instantly (see data.js). It's wiped whenever the session ends.
const LEDGER_DATA_CACHE_KEY = 'ledger-data';
function clearLocalData() {
  try { localStorage.removeItem(LEDGER_DATA_CACHE_KEY); } catch { /* storage unavailable */ }
}

/**
 * Checks whether the signed-in user's email is in the `users` allow-list
 * table — the actual access boundary is the Supabase RLS policies keyed
 * on that table, so a row missing for this email reads as "no access"
 * whether that's because the row genuinely isn't there or because RLS
 * silently filtered it out. Either way, that's the answer we want.
 *
 * @param {import('@supabase/supabase-js').Session} session
 * @returns {Promise<boolean>}
 */
async function hasDataAccess(session) {
  const { data, error } = await supabaseClient
    .from('users')
    .select('email')
    .eq('email', session.user.email)
    .maybeSingle();

  if (error) {
    console.error('[Ledger auth] Access check failed:', error);
    return false;
  }

  return !!data;
}

/**
 * Checks whether the browser already has a logged-in, authorized
 * Supabase session and redirects to keep login.html and the dashboard
 * mutually exclusive: signed-in and authorized visitors are bounced off
 * the login page, everyone else (signed-out, or signed-in but not on
 * the `users` allow-list) is bounced off the dashboard.
 *
 * @returns {Promise<import('@supabase/supabase-js').Session|null>}
 */
async function initializeAuth() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error('[Ledger auth] Session check failed:', error);
    return null;
  }

  const session = data.session;

  if (!session) {
    clearLocalData(); // signed out (or the session expired) — don't leave data on the device
    if (!IS_LOGIN_PAGE) window.location.replace('login.html');
    return null;
  }

  if (!(await hasDataAccess(session))) {
    clearLocalData();
    await supabaseClient.auth.signOut();
    window.location.replace('login.html?error=permission_denied');
    return null;
  }

  if (IS_LOGIN_PAGE) {
    window.location.replace('index.html');
    return session;
  }

  return session;
}

// Checks the existing session once when the page loads.
// Other scripts can `await authReady` if they need to know it has run.
const authReady = initializeAuth();

// Signed out in another tab (or the session expired) — bounce back to login.
supabaseClient.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && !IS_LOGIN_PAGE) {
    window.location.replace('login.html');
  }
});

/**
 * Starts the Google OAuth flow. Supabase redirects to Google, then back
 * to this same site once signed in.
 *
 * @returns {Promise<{error: Error|null}>}
 */
async function signInWithGoogle() {
  const redirectTo = `${window.location.origin}${window.location.pathname.replace(/login\.html$/, 'index.html')}`;
  return supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
}

/** Signs out and returns to the login page. */
async function signOut() {
  clearLocalData();
  await supabaseClient.auth.signOut();
  window.location.replace('login.html');
}

/** "Good evening, Taj" for the signed-in user, by time of day; null when there's no name. */
function greeting(session) {
  const firstName = (session.user?.user_metadata?.full_name || session.user?.user_metadata?.name || '').split(' ')[0];
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return firstName ? `${partOfDay}, ${firstName}` : null;
}

/**
 * The page heading's date line ("Monday 19 October") and, on pages that
 * opt in with data-greet on the <h1>, a personal greeting in place of
 * the page name.
 */
function initPageHeading(session) {
  const eyebrow = document.getElementById('page-eyebrow');
  if (eyebrow) eyebrow.textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const title = document.querySelector('.page-heading h1[data-greet]');
  const hello = greeting(session);
  if (title && hello) title.textContent = hello;
}

/**
 * Turns the account menu into an account card: a large emerald seal above
 * the name and (gold) email, and a Light / Dark switch above Sign out.
 * Built with DOM calls so names are never parsed as HTML.
 */
function buildAccountCard(panel, initials) {
  const identity = panel.querySelector('.user-menu__identity');
  identity.classList.add('user-menu__card');

  const seal = document.createElement('span');
  seal.className = 'user-menu__seal';
  seal.setAttribute('aria-hidden', 'true');
  seal.textContent = initials;
  identity.prepend(seal);

  // Appearance: a two-way switch that drives the same toggle as the header button.
  const row = document.createElement('div');
  row.className = 'user-menu__row';
  row.innerHTML = `
    <span class="user-menu__row-label">Appearance</span>
    <span class="theme-switch" role="group" aria-label="Appearance">
      <button type="button" data-theme-choice="light">Light</button>
      <button type="button" data-theme-choice="dark">Dark</button>
    </span>`;
  const divider = document.createElement('div');
  divider.className = 'user-menu__divider';
  identity.after(divider, row);

  const sync = () => {
    const current = document.documentElement.getAttribute('data-theme');
    row.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === current)));
  };
  row.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-theme-choice]')?.dataset.themeChoice;
    if (choice && choice !== document.documentElement.getAttribute('data-theme')) toggleTheme();
  });
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  sync();
}

/** Fills and wires the signed-in user's account menu in the dashboard header. */
function initUserMenu(session) {
  const user = session.user;
  const email = user.email || '';
  const name = user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0] || 'Account';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const menu = document.getElementById('user-menu');
  const button = document.getElementById('user-menu-button');
  const panel = document.getElementById('user-menu-panel');

  document.getElementById('user-menu-name').textContent = name;
  document.getElementById('user-menu-panel-name').textContent = name;
  document.getElementById('user-menu-email').textContent = email;
  document.getElementById('user-menu-avatar').textContent = initials;
  buildAccountCard(panel, initials);

  const close = () => {
    panel.hidden = true;
    menu.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.hidden = !panel.hidden;
    menu.classList.toggle('is-open', !panel.hidden);
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      button.focus();
    }
  });
}
