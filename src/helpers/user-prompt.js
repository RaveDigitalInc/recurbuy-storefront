import { escapeHtml } from './dom-html.js';

const CONFIRM_CLASS = 'recurbuy-user-prompt';
const ERROR_CLASS = 'recurbuy-user-prompt-error';

/**
 * In-DOM confirm (replaces window.confirm). Resolves true on Confirm, false on Cancel.
 *
 * @param {HTMLElement} root
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export function confirmAction(root, message) {
  if (!(root instanceof HTMLElement)) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    root.querySelector(`.${CONFIRM_CLASS}`)?.remove();

    const dialog = document.createElement('div');
    dialog.className = CONFIRM_CLASS;
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'recurbuy-confirm-message');
    dialog.innerHTML = `
      <div class="${CONFIRM_CLASS}__panel">
        <p id="recurbuy-confirm-message" class="${CONFIRM_CLASS}__message">${escapeHtml(message)}</p>
        <div class="${CONFIRM_CLASS}__actions">
          <button type="button" class="${CONFIRM_CLASS}__cancel">Cancel</button>
          <button type="button" class="${CONFIRM_CLASS}__confirm">Confirm</button>
        </div>
      </div>
    `;

    const finish = (result) => {
      dialog.remove();
      resolve(result);
    };

    dialog.querySelector(`.${CONFIRM_CLASS}__confirm`)?.addEventListener('click', () => {
      finish(true);
    });
    dialog.querySelector(`.${CONFIRM_CLASS}__cancel`)?.addEventListener('click', () => {
      finish(false);
    });

    root.appendChild(dialog);
    /** @type {HTMLButtonElement|null} */
    const confirmBtn = dialog.querySelector(`.${CONFIRM_CLASS}__confirm`);
    confirmBtn?.focus();
  });
}

/**
 * In-DOM error banner (replaces window.alert).
 *
 * @param {HTMLElement} root
 * @param {string} message
 */
export function showError(root, message) {
  if (!(root instanceof HTMLElement)) return;

  root.querySelector(`.${ERROR_CLASS}`)?.remove();

  const banner = document.createElement('div');
  banner.className = `${ERROR_CLASS} message error`;
  banner.setAttribute('role', 'alert');
  banner.setAttribute('aria-live', 'assertive');
  banner.innerHTML = `<span>${escapeHtml(message)}</span>`;
  root.prepend(banner);
}
