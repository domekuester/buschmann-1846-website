import { beforeEach, describe, expect, it } from 'vitest';
import { initAdminEmailSettings } from '../../public/assets/admin-settings.js';

describe('Empfängerzeilen in Einstellungen', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div data-email-recipients>
        <div><label for="email-empfaenger-1">Empfänger 1</label><input id="email-empfaenger-1" type="email" name="operator_recipient"></div>
      </div>
      <template data-email-recipient-template>
        <div><label>Empfänger</label><input type="email" name="operator_recipient"></div>
      </template>
      <button type="button" data-add-email-recipient>+ Weitere E-Mail-Adresse</button>`;
  });

  it('fügt per Tastatur oder Klick eine beschriftete Empfängerzeile hinzu', () => {
    initAdminEmailSettings(document, 10);
    (document.querySelector('[data-add-email-recipient]') as HTMLButtonElement).click();

    const fields = document.querySelectorAll<HTMLInputElement>('input[name="operator_recipient"]');
    expect(fields).toHaveLength(2);
    expect(fields[1]?.id).toBe('email-empfaenger-2');
    expect(document.querySelector('label[for="email-empfaenger-2"]')?.textContent).toContain('Empfänger 2');
  });

  it('deaktiviert den Hinzufügen-Knopf an der Obergrenze', () => {
    initAdminEmailSettings(document, 2);
    const button = document.querySelector('[data-add-email-recipient]') as HTMLButtonElement;
    button.click();
    expect(button.disabled).toBe(true);
  });
});
