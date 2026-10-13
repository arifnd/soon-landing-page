import { vi } from 'vitest';

import type { Env } from '../src/env.ts';

interface StoredContact {
    id: string;
    email: string;
    unsubscribed: boolean;
}

/**
 * In-memory stand-in for the Resend API, supporting the subset the Worker uses:
 * `/emails` (confirmation emails), `/contacts` (get/create/update) and
 * `POST /contacts/{email}/segments/{segmentId}`.
 */
export class FakeResend {
    readonly contacts = new Map<string, StoredContact>();

    readonly emails: Array<{ to: string; from: string; subject: string; html: string }> = [];

    /** Segments the contacts have been added to, in call order. */
    readonly segments: string[] = [];

    /** When true, contact endpoints fail, to exercise the error path. */
    failContacts = false;

    /** When true, sending email fails. */
    failEmails = false;

    private counter = 0;

    /** A `fetch` implementation suitable for `vi.stubGlobal('fetch', …)`. */
    fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input));
        const method = (init?.method ?? 'GET').toUpperCase();
        const path = url.pathname;

        if (url.hostname !== 'api.resend.com') {
            throw new Error(`Unexpected fetch: ${url.toString()}`);
        }

        if (path === '/emails' && method === 'POST') {
            if (this.failEmails) {
                return new Response('nope', { status: 500 });
            }

            this.emails.push(JSON.parse(String(init?.body ?? '{}')));

            return Response.json({ id: `email-${this.emails.length}` });
        }

        if (path === '/contacts' && method === 'POST') {
            if (this.failContacts) {
                return new Response('nope', { status: 500 });
            }

            const body = JSON.parse(String(init?.body ?? '{}')) as { email: string; unsubscribed?: boolean };
            const email = body.email.toLowerCase();
            const contact: StoredContact = {
                id: `contact-${++this.counter}`,
                email,
                unsubscribed: Boolean(body.unsubscribed),
            };

            this.contacts.set(email, contact);

            return Response.json({ object: 'contact', id: contact.id });
        }

        const segmentMatch = path.match(/^\/contacts\/(.+)\/segments\/(.+)$/);

        if (segmentMatch && method === 'POST') {
            if (this.failContacts) {
                return new Response('nope', { status: 500 });
            }

            const segmentId = decodeURIComponent(segmentMatch[2]);
            this.segments.push(segmentId);

            return Response.json({ id: segmentId });
        }

        const contactMatch = path.match(/^\/contacts\/(.+)$/);

        if (contactMatch) {
            const email = decodeURIComponent(contactMatch[1]).toLowerCase();
            const existing = this.contacts.get(email);

            if (this.failContacts) {
                return new Response('nope', { status: 500 });
            }

            if (method === 'GET') {
                return existing
                    ? Response.json({ object: 'contact', ...existing })
                    : new Response('not found', { status: 404 });
            }

            if (method === 'PATCH') {
                if (!existing) {
                    return new Response('not found', { status: 404 });
                }

                const body = JSON.parse(String(init?.body ?? '{}')) as { unsubscribed?: boolean };

                if (typeof body.unsubscribed === 'boolean') {
                    existing.unsubscribed = body.unsubscribed;
                }

                return Response.json({ object: 'contact', id: existing.id });
            }
        }

        throw new Error(`Unhandled Resend request: ${method} ${path}`);
    };
}

/**
 * In-memory rate-limiter stand-in that mirrors the Cloudflare `RateLimit`
 * binding: at most `limitPerKey` calls per key.
 */
export class FakeRateLimit implements RateLimit {
    private readonly counts = new Map<string, number>();

    constructor(private readonly limitPerKey: number = 5) {}

    async limit({ key }: RateLimitOptions): Promise<RateLimitOutcome> {
        const count = (this.counts.get(key) ?? 0) + 1;
        this.counts.set(key, count);

        return { success: count <= this.limitPerKey };
    }
}

export interface TestEnv {
    env: Env;
    resend: FakeResend;
}

/**
 * Build an `Env` backed by a fresh `FakeResend` and stub the global `fetch` at
 * it. Resend is fully configured by default; pass overrides to change that.
 */
export function createEnv(overrides: Partial<Env> = {}): TestEnv {
    const resend = new FakeResend();

    vi.stubGlobal('fetch', resend.fetch);

    return {
        resend,
        env: {
            RESEND_API_KEY: 're_test',
            EMAIL_FROM: 'Soon <hi@soon.test>',
            TOKEN_SECRET: 'test-token-secret',
            ...overrides,
        },
    };
}

/**
 * A form-encoded POST to `/subscribe`, mirroring a browser submission.
 */
export function subscribeRequest(
    fields: Record<string, string>,
    options: { url?: string; ip?: string } = {},
): Request {
    const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (options.ip) {
        headers['CF-Connecting-IP'] = options.ip;
    }

    return new Request(options.url ?? 'https://soon.example.com/subscribe', {
        method: 'POST',
        headers,
        body: new URLSearchParams(fields).toString(),
    });
}

export function createContext(): ExecutionContext {
    return {
        waitUntil: (): void => {},
        passThroughOnException: (): void => {},
    } as unknown as ExecutionContext;
}
