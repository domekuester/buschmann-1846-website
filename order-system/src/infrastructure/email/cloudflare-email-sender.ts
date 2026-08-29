import {
  NoProviderEmailSender,
  type EmailMessage as ApplicationEmailMessage,
  type EmailSender,
  type EmailSendResult as ApplicationEmailSendResult,
} from './email-sender';

const DEMO_SENDER_ADDRESS = 'buschmann-demo@elsewherephotos.com';
const DEMO_SENDER_NAME = 'Buschmann 1846 – Demo';

/** Cloudflare-spezifischer Adapter; Fach- und Templatecode kennen das Binding nicht. */
export class CloudflareEmailSender implements EmailSender {
  constructor(private readonly binding: SendEmail) {}

  async send(message: ApplicationEmailMessage): Promise<ApplicationEmailSendResult> {
    await this.binding.send({
      to: message.to,
      from: {
        email: DEMO_SENDER_ADDRESS,
        name: DEMO_SENDER_NAME,
      },
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { kind: 'sent' };
  }
}

/**
 * Das Binding existiert ausschließlich in env.demo. Lokal und in jeder
 * anderen Umgebung bleibt der ehrliche No-Provider-Fallback erhalten.
 */
export function createEnvironmentEmailSender(environment: object): EmailSender {
  const binding = readEmailBinding(environment);
  return binding === undefined
    ? new NoProviderEmailSender()
    : new CloudflareEmailSender(binding);
}

function readEmailBinding(environment: object): SendEmail | undefined {
  if (!('EMAIL' in environment)) return undefined;
  const candidate: unknown = environment.EMAIL;
  if (typeof candidate !== 'object' || candidate === null || !('send' in candidate)) {
    return undefined;
  }
  if (typeof candidate.send !== 'function') return undefined;
  return candidate as SendEmail;
}
