import type { Env } from './env.ts';
import { escapeHtml } from './render.ts';
import emailConfirmationTemplate from './templates/email-confirmation.html';

/**
 * A single transactional email.
 */
export interface EmailMessage {
    to: string;
    subject: string;
    html: string;
}

/**
 * Minimal sending interface so the provider is swappable and tests can inject a
 * fake.
 */
export interface EmailSender {
    send(message: EmailMessage): Promise<void>;
}

/**
 * Build the Resend-backed sender, or `null` when email is not configured.
 *
 * A missing sender is not fatal: the Worker still records the subscriber, it
 * just cannot deliver the confirmation link.
 */
export function createEmailSender(env: Env): EmailSender | null {
    const apiKey = env.RESEND_API_KEY;
    const from = env.EMAIL_FROM;

    if (!apiKey || !from) {
        return null;
    }

    return {
        async send(message: EmailMessage): Promise<void> {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from,
                    to: message.to,
                    subject: message.subject,
                    html: message.html,
                }),
            });

            if (!response.ok) {
                const detail = await response.text().catch(() => '');

                throw new Error(`Resend responded with ${response.status}${detail ? `: ${detail}` : ''}`);
            }
        },
    };
}

export interface ConfirmationEmailOptions {
    to: string;
    confirmUrl: string;
    unsubscribeUrl: string;
}

/**
 * Render the double opt-in confirmation email.
 *
 * The body lives in `templates/email-confirmation.html` (imported as text). Its
 * styles are inline because email clients ignore external stylesheets; the URLs
 * are escaped before substitution.
 */
export function buildConfirmationEmail(options: ConfirmationEmailOptions): EmailMessage {
    const values: Record<string, string> = {
        confirm_url: escapeHtml(options.confirmUrl),
        unsubscribe_url: escapeHtml(options.unsubscribeUrl),
    };

    return {
        to: options.to,
        subject: 'Konfirmasi langganan Soon',
        html: emailConfirmationTemplate.replace(/\{\{(\w+)\}\}/g, (token, key: string) => values[key] ?? token),
    };
}
