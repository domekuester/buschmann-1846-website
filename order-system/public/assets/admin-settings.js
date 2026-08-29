/**
 * Ergänzt Empfängerzeilen als progressive Verbesserung. Ohne JavaScript
 * bleibt immer eine leere Zeile, die gespeichert und danach erneut ergänzt
 * werden kann.
 *
 * @param {Document} root
 * @param {number} maxRecipients
 */
export function initAdminEmailSettings(root, maxRecipients = 10) {
  const list = root.querySelector('[data-email-recipients]');
  const template = root.querySelector('[data-email-recipient-template]');
  const button = root.querySelector('[data-add-email-recipient]');
  if (!(list instanceof HTMLElement)
    || !(template instanceof HTMLTemplateElement)
    || !(button instanceof HTMLButtonElement)) return;

  const updateButton = () => {
    button.disabled = list.querySelectorAll('input[name="operator_recipient"]').length >= maxRecipients;
  };

  button.addEventListener('click', () => {
    const count = list.querySelectorAll('input[name="operator_recipient"]').length;
    if (count >= maxRecipients) return;

    const fragment = template.content.cloneNode(true);
    const row = /** @type {DocumentFragment} */ (fragment).firstElementChild;
    const input = row?.querySelector('input[name="operator_recipient"]');
    const label = row?.querySelector('label');
    if (!(input instanceof HTMLInputElement) || !(label instanceof HTMLLabelElement)) return;

    const number = count + 1;
    input.id = `email-empfaenger-${number}`;
    input.value = '';
    label.htmlFor = input.id;
    label.textContent = `Empfänger ${number}`;
    list.append(fragment);
    updateButton();
    input.focus();
  });

  updateButton();
}

initAdminEmailSettings(document);
