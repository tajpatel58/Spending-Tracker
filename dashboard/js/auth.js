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
 * Checks whether the browser already has a logged-in Supabase session
 * and redirects to keep login.html and the dashboard mutually
 * exclusive: signed-in visitors are bounced off the login page,
 * signed-out visitors are bounced off the dashboard.
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

  if (session && IS_LOGIN_PAGE) {
    window.location.replace('index.html');
    return session;
  }

  if (!session && !IS_LOGIN_PAGE) {
    window.location.replace('login.html');
    return null;
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
