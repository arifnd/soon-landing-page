import { describe, expect, it } from 'vitest';

import { MIN_ELAPSED_MS, validateSubscribe } from '../src/subscribe.ts';

describe('validateSubscribe', () => {
    it('accepts and normalises a valid email', () => {
        expect(validateSubscribe({ email: '  Baru@Example.com  ' })).toEqual({
            valid: true,
            email: 'baru@example.com',
        });
    });

    it('requires an email', () => {
        expect(validateSubscribe({})).toEqual({ valid: false, message: 'Email wajib diisi.' });
        expect(validateSubscribe({ email: '   ' })).toEqual({ valid: false, message: 'Email wajib diisi.' });
    });

    it('rejects a malformed email', () => {
        expect(validateSubscribe({ email: 'not-an-email' })).toEqual({
            valid: false,
            message: 'Format email tidak valid.',
        });
    });

    it('rejects an email longer than 255 characters', () => {
        const email = `${'a'.repeat(250)}@example.com`;

        expect(validateSubscribe({ email })).toEqual({
            valid: false,
            message: 'Email maksimal 255 karakter.',
        });
    });

    it('rejects a filled honeypot', () => {
        expect(validateSubscribe({ email: 'a@example.com', honeypot: 'bot' })).toEqual({
            valid: false,
            message: 'Pengiriman tidak valid.',
        });
    });

    it('rejects a submission that is too fast', () => {
        const now = 10_000;

        expect(
            validateSubscribe({ email: 'a@example.com', rendered_at: String(now - MIN_ELAPSED_MS + 1) }, now),
        ).toEqual({
            valid: false,
            message: 'Formulir dikirim terlalu cepat. Silakan coba lagi.',
        });
    });

    it('accepts a submission past the time-trap', () => {
        const now = 10_000;

        expect(
            validateSubscribe({ email: 'a@example.com', rendered_at: String(now - MIN_ELAPSED_MS) }, now),
        ).toEqual({ valid: true, email: 'a@example.com' });
    });
});
