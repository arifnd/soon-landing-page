import type { Env } from './env.ts';

/**
 * Resend Contacts API client.
 *
 * Contacts are a global list in Resend (the former Audiences, now organized into
 * Segments). A contact's `unsubscribed` flag is our source of truth for the
 * double opt-in lifecycle: `true` = no Broadcasts, `false` = active subscriber.
 *
 * NOTE: every call here needs an API key with **full access**; a sending-only
 * key is rejected by Resend with `401 restricted_api_key`.
 */

const RESEND_API_BASE = 'https://api.resend.com';

export interface Contact {
    id: string;
    email: string;
    unsubscribed: boolean;
}

export interface ContactsClient {
    /** Return the contact for an email, or `null` when it does not exist. */
    get(email: string): Promise<Contact | null>;

    /** Create a contact. */
    create(email: string, options?: { unsubscribed?: boolean }): Promise<Contact>;

    /** Set the contact's global subscription status. */
    setUnsubscribed(email: string, unsubscribed: boolean): Promise<void>;

    /** Add the contact to a Segment (used once they confirm). */
    addToSegment(email: string, segmentId: string): Promise<void>;
}

/**
 * Build the Resend-backed contacts client, or `null` when `RESEND_API_KEY` is
 * not configured.
 */
export function createContactsClient(env: Env): ContactsClient | null {
    const apiKey = env.RESEND_API_KEY;

    if (!apiKey) {
        return null;
    }

    async function request(path: string, init: RequestInit = {}): Promise<Response> {
        return fetch(`${RESEND_API_BASE}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                ...init.headers,
            },
        });
    }

    async function ensureOk(response: Response, action: string): Promise<void> {
        if (response.ok) {
            return;
        }

        const detail = await response.text().catch(() => '');

        throw new Error(`Resend responded with ${response.status} while ${action}${detail ? `: ${detail}` : ''}`);
    }

    /**
     * Resend expects the raw email in the path (their SDK does
     * `/contacts/${email}`); encode it so an address can never break the URL.
     */
    function contactPath(email: string): string {
        return `/contacts/${encodeURIComponent(email)}`;
    }

    return {
        async get(email: string): Promise<Contact | null> {
            const response = await request(contactPath(email));

            if (response.status === 404) {
                return null;
            }

            await ensureOk(response, 'reading a contact');

            return (await response.json()) as Contact;
        },

        async create(email: string, options: { unsubscribed?: boolean } = {}): Promise<Contact> {
            const response = await request('/contacts', {
                method: 'POST',
                body: JSON.stringify({ email, unsubscribed: options.unsubscribed ?? false }),
            });

            await ensureOk(response, 'creating a contact');

            const data = (await response.json()) as { id: string };

            return { id: data.id, email, unsubscribed: options.unsubscribed ?? false };
        },

        async setUnsubscribed(email: string, unsubscribed: boolean): Promise<void> {
            const response = await request(contactPath(email), {
                method: 'PATCH',
                body: JSON.stringify({ unsubscribed }),
            });

            await ensureOk(response, 'updating a contact');
        },

        async addToSegment(email: string, segmentId: string): Promise<void> {
            const response = await request(
                `${contactPath(email)}/segments/${encodeURIComponent(segmentId)}`,
                { method: 'POST' },
            );

            await ensureOk(response, 'adding a contact to a segment');
        },
    };
}
