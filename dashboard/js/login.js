/**
 * login.js
 * ---------------------------------------------------------------------
 * The sign-in page: the theme toggle, the "Sign in with Google" button,
 * and the message shown when an account isn't on the allow-list.
 * ---------------------------------------------------------------------
 */

import { signInWithGoogle } from './auth.js';
import { initTheme, toggleTheme } from './theme.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  const button = document.getElementById('google-signin');
  const errorEl = document.getElementById('login-error');

  if (new URLSearchParams(window.location.search).get('error') === 'permission_denied') {
    errorEl.textContent = 'Permission not granted.';
    window.history.replaceState({}, '', 'login.html');
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    errorEl.textContent = '';

    const { error } = await signInWithGoogle();

    if (error) {
      console.error('[Ledger auth] Google sign-in failed:', error);
      errorEl.textContent = 'Sign-in failed. Please try again.';
      button.disabled = false;
    }
    // On success the browser is redirected to Google, then back to
    // index.html, so there's nothing further to do here.
  });
});
