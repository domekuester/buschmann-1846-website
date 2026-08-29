import { ValidationError } from './errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export const MAX_OPERATOR_RECIPIENTS = 10;
export const MAX_EMAIL_LENGTH = 190;

export interface EmailNotificationSettingsInput {
  readonly operatorNotificationsEnabled: boolean;
  readonly customerConfirmationsEnabled: boolean;
  readonly operatorRecipients: readonly string[];
}

export interface EmailNotificationSettings extends EmailNotificationSettingsInput {
  readonly updatedAt: string | null;
}

export function normalizeEmailAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0
    || [...normalized].length > MAX_EMAIL_LENGTH
    || !EMAIL_PATTERN.test(normalized)
  ) {
    throw ValidationError.field('email', 'Bitte eine gültige E-Mail-Adresse eingeben.');
  }
  return normalized;
}

export function normalizeOperatorRecipients(values: readonly string[]): readonly string[] {
  const recipients: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (value.trim() === '') continue;
    const normalized = normalizeEmailAddress(value);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      recipients.push(normalized);
    }
  }

  if (recipients.length > MAX_OPERATOR_RECIPIENTS) {
    throw ValidationError.field(
      'operator_recipients',
      `Es können höchstens ${MAX_OPERATOR_RECIPIENTS} Empfänger gespeichert werden.`,
    );
  }

  return recipients;
}
