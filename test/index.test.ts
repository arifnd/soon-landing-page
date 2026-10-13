import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/index.ts';
import { CONFIRM_TTL_MS, signToken, UNSUBSCRIBE_TTL_MS, verifyToken } from '../src/tokens.ts';
import { createContext, createEnv, FakeRateLimit, subscribeRequest } from './test-utils.ts';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('landing worker', () => {
    it('serves the page with an email form', async () => {
        const { env } = createEnv();

        const response = await worker.fetch(
            new Request('https://soon.example.com/'),
            env,
            createContext(),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');

        const html = await response.text();

        expect(html).toContain('name="email"');
        expect(html).toContain('action="/subscribe"');
        expect(html).toContain('Segera Hadir');
    });

    it('links the stylesheet instead of inlining styles', async () => {
        const { env } = createEnv();

        const response = await worker.fetch(
            new Request('https://soon.example.com/'),
            env,
            createContext(),
        );

        const html = await response.text();

        expect(html).toContain('<link rel="stylesheet" href="/assets/landing.css" />');
        expect(html).not.toContain('<style>');
    });

    it('adds HSTS on https', async () => {
        const { env } = createEnv();

        const response = await worker.fetch(
            new Request('https://soon.example.com/'),
            env,
            createContext(),
        );

        expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    });

    it('reports health', async () => {
        const { env } = createEnv();

        const response = await worker.fetch(
            new Request('https://soon.example.com/health'),
            env,
            createContext(),
        );

        await expect(response.json()).resolves.toEqual({ ok: true });
    });

    it('returns 404 for unknown paths', async () => {
        const { env } = createEnv();

        const response = await worker.fetch(
            new Request('https://soon.example.com/missing'),
            env,
            createContext(),
        );

        expect(response.status).toBe(404);
    });

    it('emails a confirmation link for a valid submission', async () => {
        const { env, resend } = createEnv();
        const renderedAt = String(Date.now() - 5000);

        const response = await worker.fetch(
            subscribeRequest({ email: 'Baru@Example.com', rendered_at: renderedAt }),
            env,
            createContext(),
        );

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toContain('Cek email kamu');
        expect(resend.emails).toHaveLength(1);
        expect(resend.emails[0].to).toBe('baru@example.com');
    });

    it('does not re-email an already-subscribed contact', async () => {
        const { env, resend } = createEnv();
        resend.contacts.set('ada@example.com', { id: 'contact-1', email: 'ada@example.com', unsubscribed: false });

        const response = await worker.fetch(
            subscribeRequest({ email: 'ada@example.com', rendered_at: '0' }),
            env,
            createContext(),
        );

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toContain('Cek email kamu');
        expect(resend.emails).toHaveLength(0);
    });

    it('re-emails a previously unsubscribed contact', async () => {
        const { env, resend } = createEnv();
        resend.contacts.set('lagi@example.com', { id: 'contact-1', email: 'lagi@example.com', unsubscribed: true });

        await worker.fetch(subscribeRequest({ email: 'lagi@example.com', rendered_at: '0' }), env, createContext());

        expect(resend.emails).toHaveLength(1);
    });

    it('rate limits repeated submissions from the same visitor', async () => {
        const { env, resend } = createEnv({ SUBSCRIBE_RATE_LIMITER: new FakeRateLimit(2) });
        const fields = { email: 'a@example.com', rendered_at: '0' };

        const first = await worker.fetch(subscribeRequest(fields, { ip: '1.2.3.4' }), env, createContext());
        const second = await worker.fetch(subscribeRequest(fields, { ip: '1.2.3.4' }), env, createContext());
        const third = await worker.fetch(subscribeRequest(fields, { ip: '1.2.3.4' }), env, createContext());

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(third.status).toBe(429);
        await expect(third.text()).resolves.toContain('Terlalu banyak');
        expect(resend.emails).toHaveLength(2);
    });

    it('limits each visitor independently', async () => {
        const { env, resend } = createEnv({ SUBSCRIBE_RATE_LIMITER: new FakeRateLimit(1) });
        const fields = { email: 'a@example.com', rendered_at: '0' };

        const visitorA = await worker.fetch(subscribeRequest(fields, { ip: '1.1.1.1' }), env, createContext());
        const visitorB = await worker.fetch(subscribeRequest(fields, { ip: '2.2.2.2' }), env, createContext());

        expect(visitorA.status).toBe(200);
        expect(visitorB.status).toBe(200);
        expect(resend.emails).toHaveLength(2);
    });

    it('rejects an invalid email', async () => {
        const { env, resend } = createEnv();

        const response = await worker.fetch(
            subscribeRequest({ email: 'not-an-email', rendered_at: '0' }),
            env,
            createContext(),
        );

        expect(response.status).toBe(422);
        await expect(response.text()).resolves.toContain('Format email tidak valid.');
        expect(resend.emails).toHaveLength(0);
    });

    it('rejects a filled honeypot', async () => {
        const { env, resend } = createEnv();

        const response = await worker.fetch(
            subscribeRequest({ email: 'a@example.com', honeypot: 'bot' }),
            env,
            createContext(),
        );

        expect(response.status).toBe(422);
        expect(resend.emails).toHaveLength(0);
    });

    it('rejects a submission that is too fast', async () => {
        const { env, resend } = createEnv();

        const response = await worker.fetch(
            subscribeRequest({ email: 'a@example.com', rendered_at: String(Date.now()) }),
            env,
            createContext(),
        );

        expect(response.status).toBe(422);
        expect(resend.emails).toHaveLength(0);
    });

    it('renders a generic error when Resend fails', async () => {
        const { env, resend } = createEnv();
        resend.failContacts = true;

        const response = await worker.fetch(
            subscribeRequest({ email: 'a@example.com', rendered_at: '0' }),
            env,
            createContext(),
        );

        expect(response.status).toBe(500);
        await expect(response.text()).resolves.toContain('Pendaftaran gagal');
    });
});

describe('confirmation email', () => {
    it('sends a confirmation email containing the confirm link', async () => {
        const { env, resend } = createEnv();

        const response = await worker.fetch(
            subscribeRequest({ email: 'a@example.com', rendered_at: '0' }),
            env,
            createContext(),
        );

        expect(response.status).toBe(200);
        expect(resend.emails).toHaveLength(1);

        const email = resend.emails[0];
        expect(email.to).toBe('a@example.com');
        expect(email.from).toBe('Soon <hi@soon.test>');
        expect(email.html).toContain('/confirm?token=');

        const confirmUrl = new URL(email.html.match(/https:\/\/soon\.example\.com\/confirm\?token=[^"]+/)?.[0] ?? '');
        const token = confirmUrl.searchParams.get('token') ?? '';

        expect(await verifyToken(env.TOKEN_SECRET ?? '', token, 'confirm')).toBe('a@example.com');
    });

    it('uses PUBLIC_BASE_URL when building the confirm link', async () => {
        const { env, resend } = createEnv({ PUBLIC_BASE_URL: 'https://go.soon.test' });

        await worker.fetch(subscribeRequest({ email: 'a@example.com', rendered_at: '0' }), env, createContext());

        expect(resend.emails[0].html).toContain('https://go.soon.test/confirm?token=');
    });

    it('renders an error page when the provider rejects the send', async () => {
        const { env, resend } = createEnv();
        resend.failEmails = true;

        const response = await worker.fetch(
            subscribeRequest({ email: 'a@example.com', rendered_at: '0' }),
            env,
            createContext(),
        );

        expect(response.status).toBe(502);
        await expect(response.text()).resolves.toContain('Gagal mengirim email');
    });

    it('renders a generic error when Resend is not configured', async () => {
        const { env, resend } = createEnv({ RESEND_API_KEY: undefined });

        const response = await worker.fetch(
            subscribeRequest({ email: 'a@example.com', rendered_at: '0' }),
            env,
            createContext(),
        );

        expect(response.status).toBe(500);
        expect(resend.emails).toHaveLength(0);
    });
});

describe('confirm route', () => {
    it('creates a subscribed contact from a valid token', async () => {
        const { env, resend } = createEnv({ RESEND_SEGMENT_ID: 'segment-1' });
        const token = await signToken(env.TOKEN_SECRET ?? '', 'confirm', 'a@example.com', Date.now() + CONFIRM_TTL_MS);

        const response = await worker.fetch(
            new Request(`https://soon.example.com/confirm?token=${encodeURIComponent(token)}`),
            env,
            createContext(),
        );

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toContain('Email terverifikasi');
        expect(resend.contacts.get('a@example.com')).toMatchObject({ unsubscribed: false });
        expect(resend.segments).toEqual(['segment-1']);
    });

    it('re-activates a previously unsubscribed contact', async () => {
        const { env, resend } = createEnv();
        resend.contacts.set('a@example.com', { id: 'contact-1', email: 'a@example.com', unsubscribed: true });
        const token = await signToken(env.TOKEN_SECRET ?? '', 'confirm', 'a@example.com', Date.now() + CONFIRM_TTL_MS);

        const response = await worker.fetch(
            new Request(`https://soon.example.com/confirm?token=${encodeURIComponent(token)}`),
            env,
            createContext(),
        );

        expect(response.status).toBe(200);
        expect(resend.contacts.get('a@example.com')?.unsubscribed).toBe(false);
    });

    it('rejects a missing, invalid or expired token', async () => {
        const { env } = createEnv();
        const expired = await signToken(env.TOKEN_SECRET ?? '', 'confirm', 'a@example.com', Date.now() - 1);

        const missing = await worker.fetch(new Request('https://soon.example.com/confirm'), env, createContext());
        const invalid = await worker.fetch(
            new Request('https://soon.example.com/confirm?token=nope'),
            env,
            createContext(),
        );
        const stale = await worker.fetch(
            new Request(`https://soon.example.com/confirm?token=${encodeURIComponent(expired)}`),
            env,
            createContext(),
        );

        expect(missing.status).toBe(400);
        expect(invalid.status).toBe(400);
        expect(stale.status).toBe(400);
        await expect(invalid.text()).resolves.toContain('Tautan tidak valid');
    });
});

describe('unsubscribe route', () => {
    it('unsubscribes a contact from a valid token', async () => {
        const { env, resend } = createEnv();
        resend.contacts.set('a@example.com', { id: 'contact-1', email: 'a@example.com', unsubscribed: false });
        const token = await signToken(
            env.TOKEN_SECRET ?? '',
            'unsubscribe',
            'a@example.com',
            Date.now() + UNSUBSCRIBE_TTL_MS,
        );

        const response = await worker.fetch(
            new Request(`https://soon.example.com/unsubscribe?token=${encodeURIComponent(token)}`),
            env,
            createContext(),
        );

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toContain('Berhenti berlangganan');
        expect(resend.contacts.get('a@example.com')?.unsubscribed).toBe(true);
    });

    it('succeeds when the contact no longer exists', async () => {
        const { env } = createEnv();
        const token = await signToken(
            env.TOKEN_SECRET ?? '',
            'unsubscribe',
            'gone@example.com',
            Date.now() + UNSUBSCRIBE_TTL_MS,
        );

        const response = await worker.fetch(
            new Request(`https://soon.example.com/unsubscribe?token=${encodeURIComponent(token)}`),
            env,
            createContext(),
        );

        expect(response.status).toBe(200);
    });

    it('rejects an invalid token', async () => {
        const { env } = createEnv();

        const response = await worker.fetch(
            new Request('https://soon.example.com/unsubscribe?token=nope'),
            env,
            createContext(),
        );

        expect(response.status).toBe(400);
    });
});
