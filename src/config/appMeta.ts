/**
 * App public metadata from root config.json (no secrets).
 * Support contact is shown on screens and appended to error alerts.
 */
import raw from '../../config.json';

export interface AppPublicConfig {
  support_contact_email: string;
  support_contact_label?: string;
}

const FALLBACK_EMAIL = 'senthil930@gmail.com';

export function getAppPublicConfig(): AppPublicConfig {
  const email = String(
    (raw as AppPublicConfig)?.support_contact_email || FALLBACK_EMAIL
  )
    .trim()
    .toLowerCase();
  const label = String(
    (raw as AppPublicConfig)?.support_contact_label || 'Support'
  ).trim();
  return {
    support_contact_email: email || FALLBACK_EMAIL,
    support_contact_label: label || 'Support',
  };
}

export function supportContactEmail(): string {
  return getAppPublicConfig().support_contact_email;
}

/** Short line for footers: "Support: senthil930@gmail.com" */
export function supportContactLine(): string {
  const { support_contact_email, support_contact_label } = getAppPublicConfig();
  return `${support_contact_label}: ${support_contact_email}`;
}

/**
 * Append support contact to error bodies so alerts and banners tell the user
 * who to email when something breaks.
 */
export function withSupportContact(message: string): string {
  const msg = String(message || '').trim();
  const email = supportContactEmail();
  if (!msg) return `Need help? Email ${email}`;
  if (msg.toLowerCase().includes(email.toLowerCase())) return msg;
  return `${msg}\n\nNeed help? Email ${email}`;
}

export function mailtoSupportUrl(subject?: string): string {
  const email = supportContactEmail();
  const q = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  return `mailto:${email}${q}`;
}
