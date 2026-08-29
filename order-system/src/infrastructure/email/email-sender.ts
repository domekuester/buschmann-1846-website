export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export type EmailSendResult = { readonly kind: 'sent' } | { readonly kind: 'unavailable' };

/** Transportgrenze. Ein späterer Cloudflare-Adapter implementiert nur dieses Interface. */
export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** Sichere Laufzeit-Voreinstellung: ohne Provider wird kein Versand behauptet. */
export class NoProviderEmailSender implements EmailSender {
  async send(_message: EmailMessage): Promise<EmailSendResult> {
    return { kind: 'unavailable' };
  }
}

/** Deterministischer Sender für Tests und lokale, rein interne Prüfungen. */
export class MemoryEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.messages.push(message);
    return { kind: 'sent' };
  }
}
