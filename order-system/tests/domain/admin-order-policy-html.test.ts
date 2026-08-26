import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER_POLICY, type OrderPolicy } from '../../src/domain/order-policy';
import {
  renderAdminOrderPolicyPage,
  type AdminOrderPolicyPageView,
} from '../../src/ui/admin-order-policy-html';

/**
 * Die Regelseite als reines HTML — ohne Worker, ohne D1.
 *
 * Geprüft wird, was ausgeliefert wird: dass das Formular die gespeicherte
 * Regel zeigt, dass es nichts enthält, was nicht hineingehört, und dass die
 * Seite in Sätzen spricht statt in Spaltennamen.
 */

const NOW = new Date('2026-08-25T09:00:00.000Z');

function view(overrides: Partial<AdminOrderPolicyPageView> = {}): AdminOrderPolicyPageView {
  return {
    loginIdentifier: 'admin@example.test',
    csrfToken: 'csrf-token-fuer-tests',
    policy: DEFAULT_ORDER_POLICY,
    updatedAt: null,
    now: NOW,
    noticeCode: null,
    ...overrides,
  };
}

function mit(policy: Partial<OrderPolicy>): string {
  return renderAdminOrderPolicyPage(view({ policy: { ...DEFAULT_ORDER_POLICY, ...policy } }));
}

describe('Die Regelseite zeigt die gespeicherte Regel', () => {
  it('hakt genau die erlaubten Wochentage an', () => {
    const html = mit({ weekdays: [true, false, false, false, true, false, false] });

    expect(html).toContain('value="monday" checked');
    expect(html).toContain('value="friday" checked');
    expect(html).toContain('value="tuesday">');
    expect(html).toContain('value="sunday">');
  });

  it('trägt Vorlauf und Uhrzeit in die Felder ein', () => {
    const html = mit({ cutoffEnabled: true, leadDays: 2, cutoffTime: '09:30' });

    expect(html).toContain('name="lead_days"');
    expect(html).toContain('value="2"');
    expect(html).toContain('name="cutoff_time"');
    expect(html).toContain('value="09:30"');
    expect(html).toContain('name="cutoff_enabled" value="1" checked');
  });

  it('begrenzt das Zahlenfeld auf den erlaubten Bereich', () => {
    const html = mit({});
    expect(html).toContain('min="0"');
    expect(html).toContain('max="30"');
  });

  /**
   * step="60" ist kein Detail: Ohne ihn liefern manche Browser 'HH:MM:SS',
   * und der Endpunkt lehnt das zu Recht ab — der Admin sähe dann eine
   * Fehlermeldung für ein Feld, das er gar nicht angefasst hat.
   */
  it('lässt das Uhrzeitfeld nur ganze Minuten liefern', () => {
    expect(mit({})).toContain('step="60"');
  });
});

describe('Die Regelseite spricht in Sätzen', () => {
  it('sagt bei der Voreinstellung, dass nichts eingeschränkt ist', () => {
    const html = renderAdminOrderPolicyPage(view());

    expect(html).toContain('Wir nehmen Bestellungen für alle Wochentage an.');
    expect(html).toContain('Es gibt zurzeit keinen Bestellschluss.');
    expect(html).toContain('Noch nie geändert.');
  });

  it('zählt die Bestelltage auf, sobald welche fehlen', () => {
    const html = mit({ weekdays: [true, true, false, false, true, false, false] });
    expect(html).toContain('Wir nehmen Bestellungen für Montag, Dienstag und Freitag an.');
  });

  it('erklärt die aktive Regel an einem echten künftigen Tag', () => {
    const html = mit({
      weekdays: [false, false, false, false, true, false, false],
      cutoffEnabled: true,
      leadDays: 1,
      cutoffTime: '12:00',
    });

    expect(html).toContain('Bestellschluss ist einen Tag vorher um 12:00 Uhr.');
    expect(html).toContain(
      'Für Freitag, 28. August endet die Bestellung am Donnerstag, 27. August um 12:00 Uhr.',
    );
  });

  it('nennt den Zeitpunkt der letzten Änderung', () => {
    const html = renderAdminOrderPolicyPage(view({ updatedAt: '2026-08-25T09:00:00.000Z' }));
    expect(html).toContain('Zuletzt geändert am 25.08.2026, 11:00 Uhr.');
  });

  /** §7 — kein Fachjargon in der sichtbaren Seite. */
  it('benutzt keine Fachsprache im sichtbaren Text', () => {
    const sichtbar = mit({ cutoffEnabled: true }).replace(/<[^>]*>/g, ' ');

    for (const wort of ['lead_days', 'policy', 'Policy', 'cutoff', 'Cutoff', 'enforcement', 'weekday']) {
      expect(sichtbar).not.toContain(wort);
    }
  });
});

describe('Das Formular enthält nur, was hineingehört', () => {
  it('schickt an den vorgesehenen Endpunkt und trägt den CSRF-Token', () => {
    const html = renderAdminOrderPolicyPage(view());

    expect(html).toContain('method="post" action="/api/admin/order-policy"');
    expect(html).toContain('name="csrf_token" value="csrf-token-fuer-tests"');
  });

  it('kennt genau vier Eingabenamen', () => {
    const html = renderAdminOrderPolicyPage(view());
    const namen = [...html.matchAll(/name="([^"]+)"/g)].map((treffer) => treffer[1]);

    expect(new Set(namen)).toEqual(
      new Set(['csrf_token', 'weekday', 'cutoff_enabled', 'lead_days', 'cutoff_time', 'viewport', 'robots', 'color-scheme']),
    );
  });

  it('trägt kein Rückkehrziel und keine Kennung im Körper', () => {
    const html = renderAdminOrderPolicyPage(view());

    for (const verboten of ['name="next"', 'name="redirect"', 'name="id"', 'name="updated_at"']) {
      expect(html).not.toContain(verboten);
    }
  });

  it('kommt ohne Skript aus', () => {
    expect(renderAdminOrderPolicyPage(view())).not.toContain('<script');
  });
});

describe('Rückmeldungen', () => {
  it('zeigt den Erfolg ohne Warndreieck', () => {
    const html = renderAdminOrderPolicyPage(view({ noticeCode: 'saved' }));

    expect(html).toContain('Die Bestellregeln wurden gespeichert.');
    expect(html).toContain('kundenmeldung--erfolg');
    expect(html).not.toContain('class="banner kundenmeldung"');
  });

  it('sagt bei jedem Fehlschlag ausdrücklich, dass nichts gespeichert wurde', () => {
    for (const code of ['no_day', 'invalid_lead_days', 'invalid_cutoff_time', 'invalid', 'internal']) {
      const html = renderAdminOrderPolicyPage(view({ noticeCode: code }));
      expect(html).toContain('class="banner kundenmeldung"');
      expect(html).toMatch(/nicht gespeichert|nichts gespeichert/);
    }
  });

  it('zeigt für einen erfundenen Code gar nichts an', () => {
    const html = renderAdminOrderPolicyPage(view({ noticeCode: '"><script>alert(1)</script>' }));

    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('role="status"');
  });
});
