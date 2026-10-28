/**
 * UNIPROMET ADMIN - Core Modal Manager
 * Universal modal opening, closing, and smooth backdrop dismissal
 */

export function openModal(modalId) {
  const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
  if (!modal) return;
  modal.classList.remove('modal-closing');
  modal.style.display = 'flex';
  if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

export function closeModal(modalId, callback) {
  const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
  if (!modal || modal.style.display === 'none') return;
  if (modal.classList.contains('modal-closing')) return;

  modal.classList.add('modal-closing');
  setTimeout(() => {
    modal.style.display = 'none';
    modal.classList.remove('modal-closing');
    if (typeof callback === 'function') callback();
  }, 190);
}

export function initModalDismissListeners() {
  document.querySelectorAll('.modal-overlay, .modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeModal(backdrop);
      }
    });

    backdrop.querySelectorAll('.modal-close-icon, .btn-modal-close, .btn-modal-cancel, .btn-cancel-modal').forEach(closeBtn => {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal(backdrop);
      });
    });
  });
}

