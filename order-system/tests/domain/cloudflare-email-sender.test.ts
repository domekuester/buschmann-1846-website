import { describe, expect, it } from 'vitest';
import type { EmailMessage as ApplicationEmailMessage } from '../../src/infrastructure/email/email-sender';
import { CloudflareEmailSender } from '../../src/infrastructure/email/cloudflare-email-sender';

class RecordingSendEmailBinding implements SendEmail {
  readonly messages: EmailMessageBuilder[] = [];

  constructor(private readonly failure?: Error) {}

  send(message: EmailMessage): Promise<EmailSendResult>;
  send(builder: EmailMessageBuilder): Promise<EmailSendResult>;
  async send(message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> {
    if (this.failure !== undefined) throw this.failure;
    if (!('subject' in message)) throw new Error('Expected composed email payload.');
    this.messages.push(message);
    return { messageId: '<accepted@elsewherephotos.com>' };
  }
}

const MESSAGE: ApplicationEmailMessage = {
  to: 'domekuester@gmail.com',
  subject: 'Neue Bestellung BUS-2026-000123',
  text: 'Textinhalt',
  html: '<p>HTML-Inhalt</p>',
};

describe('CloudflareEmailSender', () => {
  it('meldet erst nach nativer Provider-Akzeptanz sent und setzt die feste Demo-Identität', async () => {
    const binding = new RecordingSendEmailBinding();
    const sender = new CloudflareEmailSender(binding);

    await expect(sender.send(MESSAGE)).resolves.toEqual({ kind: 'sent' });
    expect(binding.messages).toEqual([{
      to: 'domekuester@gmail.com',
      from: {
        email: 'buschmann-demo@elsewherephotos.com',
        name: 'Buschmann 1846 – Demo',
      },
      subject: 'Neue Bestellung BUS-2026-000123',
      text: 'Textinhalt',
      html: '<p>HTML-Inhalt</p>',
    }]);
  });

  it('reicht eine Provider-Ablehnung an den bestehenden Outbox-Lifecycle weiter', async () => {
    const sender = new CloudflareEmailSender(
      new RecordingSendEmailBinding(new Error('provider credential=secret')),
    );

    await expect(sender.send(MESSAGE)).rejects.toThrow('provider credential=secret');
  });
});
