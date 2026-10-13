import { describe, expect, it } from 'vitest';

import { CONFIRM_TTL_MS, signToken, verifyToken } from '../src/tokens.ts';

const SECRET = 'test-token-secret';

describe('signed tokens', () => {
    it('round-trips the email it was issued for', async () => {
        const token = await signToken(SECRET, 'confirm', 'a@example.com', Date.now() + CONFIRM_TTL_MS);

        expect(await verifyToken(SECRET, token, 'confirm')).toBe('a@example.com');
    });

    it('rejects a token signed with a different secret', async () => {
        const token = await signToken('other-secret', 'confirm', 'a@example.com', Date.now() + CONFIRM_TTL_MS);

        expect(await verifyToken(SECRET, token, 'confirm')).toBeNull();
    });

    it('rejects a tampered payload', async () => {
        const token = await signToken(SECRET, 'confirm', 'a@example.com', Date.now() + CONFIRM_TTL_MS);
        const [payload, signature] = token.split('.');
        const forged = `${payload}.${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`;

        expect(await verifyToken(SECRET, forged, 'confirm')).toBeNull();
    });

    it('rejects a token used for the wrong purpose', async () => {
        const token = await signToken(SECRET, 'confirm', 'a@example.com', Date.now() + CONFIRM_TTL_MS);

        expect(await verifyToken(SECRET, token, 'unsubscribe')).toBeNull();
    });

    it('rejects an expired token', async () => {
        const token = await signToken(SECRET, 'confirm', 'a@example.com', Date.now() - 1);

        expect(await verifyToken(SECRET, token, 'confirm')).toBeNull();
    });

    it('rejects a malformed token', async () => {
        expect(await verifyToken(SECRET, 'not-a-token', 'confirm')).toBeNull();
    });
});
