/**
 * toast.js
 * ---------------------------------------------------------------------
 * Small confirmation toasts, e.g. "Moved Tesco to Groceries · Undo".
 * One shows at a time (a new one replaces the last). Each dismisses
 * itself after a few seconds — a thin line along the bottom shows the
 * time left, and hovering pauses it so there's time to hit Undo.
 *
 *   showToast({ message, action: { label: 'Undo', onClick }, tone: 'error' })
 * ---------------------------------------------------------------------
 */

const TOAST_DURATION = 10000;

const TOAST_ICONS = {
  success: '<path class="draw-tick" pathLength="1" d="M6.5 12.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  error: '<path d="M12 7.5v5.5M12 16.5h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  info: '<path d="M9 8.5L5.5 12 9 15.5M5.5 12H15a3.5 3.5 0 0 1 0 7h-1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};

function toastRegion() {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  return region;
}

/** Slides a toast out and removes it. */
function dismissToast(toast) {
  if (!toast || toast.classList.contains('is-leaving')) return;
  clearTimeout(toast.timer);
  toast.classList.add('is-leaving');
  const remove = () => toast.remove();
  toast.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 400); // in case animations are off (reduced motion)
}

/**
 * Shows a toast. `tone` is 'success' (default), 'error' or 'info'.
 * `action` adds a button (e.g. Undo); clicking it runs `onClick` and closes the toast.
 */
function showToast({ message, action, tone = 'success', duration = TOAST_DURATION }) {
  const region = toastRegion();
  region.querySelectorAll('.toast').forEach(dismissToast);

  const toast = document.createElement('div');
  toast.className = `toast toast--${tone}`;
  toast.style.setProperty('--toast-duration', `${duration}ms`);
  toast.innerHTML = `
    <span class="toast__icon" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">${TOAST_ICONS[tone] || TOAST_ICONS.success}</svg>
    </span>
    <span class="toast__message"></span>
    ${action ? '<button type="button" class="toast__action"></button>' : ''}
    <button type="button" class="toast__close" aria-label="Dismiss">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
    </button>
    <span class="toast__timer" aria-hidden="true"></span>`;
  toast.querySelector('.toast__message').textContent = message;

  if (action) {
    const button = toast.querySelector('.toast__action');
    button.textContent = action.label;
    button.addEventListener('click', () => {
      dismissToast(toast);
      action.onClick();
    });
  }
  toast.querySelector('.toast__close').addEventListener('click', () => dismissToast(toast));

  // Auto-dismiss, pausing while hovered or focused so there's time to act.
  let remaining = duration;
  let startedAt;
  let running = false;
  const start = () => {
    if (running) return;
    running = true;
    startedAt = Date.now();
    toast.classList.remove('is-paused');
    toast.timer = setTimeout(() => dismissToast(toast), remaining);
  };
  const pause = () => {
    if (!running) return;
    running = false;
    clearTimeout(toast.timer);
    remaining -= Date.now() - startedAt;
    toast.classList.add('is-paused');
  };
  toast.addEventListener('mouseenter', pause);
  toast.addEventListener('mouseleave', start);
  toast.addEventListener('focusin', pause);
  toast.addEventListener('focusout', (e) => { if (!toast.contains(e.relatedTarget)) start(); });

  region.appendChild(toast);
  start();
  return toast;
}
