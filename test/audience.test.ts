import { afterEach, describe, expect, it, vi } from 'vitest';

import { createContactsClient } from '../src/audience.ts';
import { createEnv } from './test-utils.ts';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('createContactsClient', () => {
    it('is null without a Resend API key', () => {
        expect(createContactsClient({})).toBeNull();
    });

    it('returns null for an unknown contact', async () => {
        const { env } = createEnv();
        const client = createContactsClient(env);

        await expect(client?.get('missing@example.com')).resolves.toBeNull();
    });

    it('creates and then reads a contact', async () => {
        const { env } = createEnv();
        const client = createContactsClient(env);

        const created = await client?.create('a@example.com', { unsubscribed: false });

        expect(created).toMatchObject({ email: 'a@example.com', unsubscribed: false });
        await expect(client?.get('a@example.com')).resolves.toMatchObject({
            email: 'a@example.com',
            unsubscribed: false,
        });
    });

    it('updates the unsubscribed status', async () => {
        const { env, resend } = createEnv();
        const client = createContactsClient(env);

        await client?.create('a@example.com', { unsubscribed: false });
        await client?.setUnsubscribed('a@example.com', true);

        expect(resend.contacts.get('a@example.com')?.unsubscribed).toBe(true);
    });

    it('adds a contact to a segment', async () => {
        const { env, resend } = createEnv();
        const client = createContactsClient(env);

        await client?.create('a@example.com');
        await client?.addToSegment('a@example.com', 'segment-1');

        expect(resend.segments).toEqual(['segment-1']);
    });

    it('surfaces the Resend error body when a contact request fails', async () => {
        const { env, resend } = createEnv();
        resend.failContacts = true;
        const client = createContactsClient(env);

        await expect(client?.get('a@example.com')).rejects.toThrow('Resend responded with 500');
    });
});
