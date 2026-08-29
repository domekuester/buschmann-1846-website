export const EMAIL_NOTIFICATION_KINDS = [
  'operator_new_order',
  'customer_order_confirmation',
] as const;

export type EmailNotificationKind = (typeof EMAIL_NOTIFICATION_KINDS)[number];
export type EmailNotificationStatus = 'pending' | 'sent' | 'failed';

export interface EmailNotificationIntent {
  readonly notificationId: string;
  readonly kind: EmailNotificationKind;
  readonly recipient: string;
  readonly createdAt: string;
}

export interface EmailOutboxNotification extends EmailNotificationIntent {
  readonly orderNumber: string;
  readonly status: EmailNotificationStatus;
  readonly attempts: number;
  readonly sentAt: string | null;
  readonly lastError: string | null;
}
