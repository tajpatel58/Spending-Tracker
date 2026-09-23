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
    if (!IS_LOGIN_PAGE) window.location.replace('login.html');
    return null;
  }

  if (!(await hasDataAccess(session))) {
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
  await supabaseClient.auth.signOut();
  window.location.replace('login.html');
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
