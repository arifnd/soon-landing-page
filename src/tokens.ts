/**
 * Stateless confirmation/unsubscribe tokens.
 *
 * Tokens are `<base64url(payload)>.<base64url(hmac)>` where the payload is
 * `{ p: purpose, e: email, x: expiresAt(ms) }`. The HMAC is keyed on
 * `TOKEN_SECRET`, so a valid token can only be minted by the Worker and nothing
 * needs to be stored server-side (no D1 needed for the double opt-in flow).
 */

export type TokenPurpose = 'confirm' | 'unsubscribe';

/**
 * How long a confirmation link stays valid.
 */
export const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long the unsubscribe link in the email footer stays valid.
 */
export const UNSUBSCRIBE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

interface TokenPayload {
    p: TokenPurpose;
    e: string;
    x: number;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function encodeSegments(value: string): string {
    return toBase64Url(encoder.encode(value));
}

function decodeSegments(value: string): string {
    return new TextDecoder().decode(fromBase64Url(value));
}

/**
 * Constant-time comparison of two strings.
 */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }

    let difference = 0;

    for (let index = 0; index < a.length; index++) {
        difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }

    return difference === 0;
}

async function signature(secret: string, payload: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );

    const hmac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));

    return toBase64Url(new Uint8Array(hmac));
}

/**
 * Sign a token binding an email to a purpose until `expiresAt` (epoch ms).
 */
export async function signToken(
    secret: string,
    purpose: TokenPurpose,
    email: string,
    expiresAt: number,
): Promise<string> {
    const payload = encodeSegments(JSON.stringify({ p: purpose, e: email, x: expiresAt } satisfies TokenPayload));

    return `${payload}.${await signature(secret, payload)}`;
}

/**
 * Verify a token and return the email it was issued for, or `null` when the
 * signature is wrong, the purpose does not match, or it has expired.
 */
export async function verifyToken(
    secret: string,
    token: string,
    purpose: TokenPurpose,
    now: number = Date.now(),
): Promise<string | null> {
    const separator = token.indexOf('.');
    const payload = separator === -1 ? '' : token.slice(0, separator);
    const provided = separator === -1 ? '' : token.slice(separator + 1);

    if (payload === '' || provided === '') {
        return null;
    }

    if (!timingSafeEqual(await signature(secret, payload), provided)) {
        return null;
    }

    let parsed: TokenPayload;

    try {
        parsed = JSON.parse(decodeSegments(payload)) as TokenPayload;
    } catch {
        return null;
    }

    if (parsed?.p !== purpose || typeof parsed.e !== 'string' || typeof parsed.x !== 'number') {
        return null;
    }

    if (parsed.x < now) {
        return null;
    }

    return parsed.e;
}
