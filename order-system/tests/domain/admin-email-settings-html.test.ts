import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER_POLICY } from '../../src/domain/order-policy';
import { renderAdminOrderPolicyPage } from '../../src/ui/admin-order-policy-html';

function page(recipients: readonly string[] = []): string {
  return renderAdminOrderPolicyPage({
    loginIdentifier: 'admin@example.test',
    csrfToken: 'csrf-test',
    policy: DEFAULT_ORDER_POLICY,
    updatedAt: null,
    notificationSettings: {
      operatorNotificationsEnabled: true,
      customerConfirmationsEnabled: true,
      operatorRecipients: recipients,
      updatedAt: null,
    },
    now: new Date('2026-08-29T09:00:00.000Z'),
    noticeCode: null,
  });
}

function pageWithNotice(noticeCode: string): string {
  return renderAdminOrderPolicyPage({
    loginIdentifier: 'admin@example.test',
    csrfToken: 'csrf-test',
    policy: DEFAULT_ORDER_POLICY,
    updatedAt: null,
    notificationSettings: {
      operatorNotificationsEnabled: false,
      customerConfirmationsEnabled: false,
      operatorRecipients: [],
      updatedAt: null,
    },
    now: new Date('2026-08-29T09:00:00.000Z'),
    noticeCode,
  });
}

describe('E-Mail-Benachrichtigungen in Einstellungen', () => {
  it('bleibt im bestehenden Einstellungsziel und bietet alle Pflichtkontrollen', () => {
    const html = page(['claudia@example.test', 'gregor@example.test']);

    expect(html).toContain('>E-Mail-Benachrichtigungen</h2>');
    expect(html).toContain('method="post" action="/api/admin/email-notifications"');
    expect(html).toContain('Neue Bestellungen an Betrieb senden');
    expect(html).toContain('Empfänger');
    expect(html).toContain('+ Weitere E-Mail-Adresse');
    expect(html).toContain('Kunden erhalten eine Bestellbestätigung');
    const liveList = html.match(/<div class="email-empfaenger__liste"[\s\S]*?<\/div>\s*<template/)?.[0] ?? '';
    expect(liveList.match(/name="operator_recipient"/g)).toHaveLength(3);
    expect(html).toContain('value="claudia@example.test"');
    expect(html).toContain('value="gregor@example.test"');
    expect(html).toContain('name="csrf_token" value="csrf-test"');
  });

  it('verwendet nur ein lokales externes Skript und kein Inline-Skript', () => {
    const html = page();
    expect(html).toContain('<script type="module" src="/assets/admin-settings.js"></script>');
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  });

  it('escaped gespeicherte Empfänger', () => {
    const html = page(['"><script>alert(1)</script>@example.test']);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;@example.test');
  });

  it('zeigt den erfolgreichen E-Mail-Speichervorgang als Erfolg', () => {
    const html = pageWithNotice('email_saved');
    expect(html).toContain('class="kundenmeldung kundenmeldung--erfolg" role="status"');
    expect(html).toContain('Die E-Mail-Benachrichtigungen wurden gespeichert.');
  });
});
