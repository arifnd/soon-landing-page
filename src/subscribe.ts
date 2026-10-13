/**
 * Email capture: validation only.
 *
 * Validation mirrors the app's `SubscribeRequest` rules (email format, honeypot,
 * a 2s time-trap) so the Worker rejects obvious bots before talking to Resend.
 * Persistence now lives in Resend Contacts (see `src/audience.ts`), not D1.
 */

export const MAX_EMAIL_LENGTH = 255;

/**
 * Minimum time between page render and submission, in milliseconds.
 */
export const MIN_ELAPSED_MS = 2000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SubscribeInput {
    email?: unknown;
    honeypot?: unknown;
    rendered_at?: unknown;
}

export type ValidationResult =
    | { valid: true; email: string }
    | { valid: false; message: string };

/**
 * Validate a raw form/JSON submission.
 *
 * `now` is injectable so the time-trap can be tested deterministically.
 */
export function validateSubscribe(input: SubscribeInput, now: number = Date.now()): ValidationResult {
    const honeypot = input.honeypot;

    if (typeof honeypot === 'string' && honeypot.trim() !== '') {
        return { valid: false, message: 'Pengiriman tidak valid.' };
    }

    const raw = typeof input.email === 'string' ? input.email.trim() : '';

    if (raw === '') {
        return { valid: false, message: 'Email wajib diisi.' };
    }

    if (raw.length > MAX_EMAIL_LENGTH) {
        return { valid: false, message: 'Email maksimal 255 karakter.' };
    }

    if (!EMAIL_PATTERN.test(raw)) {
        return { valid: false, message: 'Format email tidak valid.' };
    }

    const renderedAt = input.rendered_at;

    if (typeof renderedAt === 'string' && renderedAt !== '') {
        const elapsed = now - Number(renderedAt);

        if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_ELAPSED_MS) {
            return { valid: false, message: 'Formulir dikirim terlalu cepat. Silakan coba lagi.' };
        }
    }

    return { valid: true, email: raw.toLowerCase() };
}
