const trigger = document.querySelector('[data-print-trigger]');

if (trigger instanceof HTMLButtonElement) {
  trigger.addEventListener('click', () => window.print());
}
