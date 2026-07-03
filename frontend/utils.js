/** Escape text for safe insertion into HTML. */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TOAST_ICONS = {
  success: 'fa-circle-check',
  error: 'fa-circle-xmark',
  info: 'fa-circle-info',
};

const TOAST_DURATIONS = {
  success: 4000,
  error: 5000,
  info: 4000,
};

let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/** Show a transient toast notification (top-center, auto-dismiss). */
export function showToast(message, type = 'info', duration) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  const variant = TOAST_ICONS[type] ? type : 'info';
  toast.className = `toast toast--${variant}`;
  toast.setAttribute('role', 'status');

  const icon = document.createElement('i');
  icon.className = `fas ${TOAST_ICONS[variant]} toast__icon`;
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'toast__text';
  text.textContent = message;

  toast.append(icon, text);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
  });

  const dismissMs = duration ?? TOAST_DURATIONS[variant] ?? TOAST_DURATIONS.info;

  const dismiss = () => {
    if (toast.classList.contains('toast--leaving')) return;
    toast.classList.remove('toast--visible');
    toast.classList.add('toast--leaving');
    const remove = () => toast.remove();
    toast.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 400);
  };

  const timer = setTimeout(dismiss, dismissMs);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}
