import type { Env } from './env.ts';
import type { LandingNotice } from './notice.ts';
import { createContactsClient } from './audience.ts';
import { buildConfirmationEmail, createEmailSender } from './email.ts';
import { isSubscribeAllowed, RATE_LIMIT_MESSAGE } from './rate-limit.ts';
import { validateSubscribe } from './subscribe.ts';
import { CONFIRM_TTL_MS, signToken, UNSUBSCRIBE_TTL_MS, verifyToken } from './tokens.ts';
import { renderLandingPage, renderStatusPage } from './render.ts';

/**
 * Baseline security headers for the served HTML, mirroring the app's
 * `SecurityHeaders` middleware and the landing edge Worker.
 */
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' https: data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
].join('; ');

const NOT_FOUND: LandingNotice = { type: 'error', message: 'Halaman tidak ditemukan.' };
const GENERIC_ERROR: LandingNotice = { type: 'error', message: 'Pendaftaran gagal. Silakan coba lagi.' };

/**
 * Serve the coming-soon landing page and run the double opt-in flow against
 * Resend Contacts.
 */
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return Response.json({ ok: true });
        }

        if (url.pathname === '/subscribe' && request.method === 'POST') {
            return handleSubscribe(request, env, ctx);
        }

        if (url.pathname === '/confirm' && request.method === 'GET') {
            return handleConfirm(url, env);
        }

        if (url.pathname === '/unsubscribe' && request.method === 'GET') {
            return handleUnsubscribe(url, env);
        }

        if (url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
            return htmlResponse(renderLandingPage({ notice: null, renderedAt: Date.now() }), 200, request.url);
        }

        return htmlResponse(renderLandingPage({ notice: NOT_FOUND, renderedAt: Date.now() }), 404, request.url);
    },
} satisfies ExportedHandler<Env>;

/**
 * Validate a submission and email a signed confirmation link.
 *
 * Always returns the same "check your email" page for accepted submissions so
 * an existing address is never revealed; an already-subscribed contact is not
 * emailed again.
 */
export async function handleSubscribe(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
): Promise<Response> {
    if (!(await isSubscribeAllowed(env, request))) {
        return htmlResponse(
            renderLandingPage({ notice: { type: 'error', message: RATE_LIMIT_MESSAGE }, renderedAt: Date.now() }),
            429,
            request.url,
        );
    }

    const result = validateSubscribe(await readInput(request));

    if (!result.valid) {
        return htmlResponse(renderLandingPage({ notice: { type: 'error', message: result.message }, renderedAt: Date.now() }), 422, request.url);
    }

    const contacts = createContactsClient(env);
    const sender = createEmailSender(env);

    if (!contacts || !sender || !env.TOKEN_SECRET) {
        console.warn('Resend or TOKEN_SECRET is not configured; skipping the signup.');

        return htmlResponse(renderLandingPage({ notice: GENERIC_ERROR, renderedAt: Date.now() }), 500, request.url);
    }

    try {
        const existing = await contacts.get(result.email);

        if (existing && !existing.unsubscribed) {
            // Already confirmed: never re-send, but keep the response uniform.
            return htmlResponse(successPage(result.email), 200, request.url);
        }
    } catch (error) {
        console.error('Contact lookup failed:', error);

        return htmlResponse(renderLandingPage({ notice: GENERIC_ERROR, renderedAt: Date.now() }), 500, request.url);
    }

    const now = Date.now();
    const origin = env.PUBLIC_BASE_URL ?? new URL(request.url).origin;
    const confirmToken = await signToken(env.TOKEN_SECRET, 'confirm', result.email, now + CONFIRM_TTL_MS);
    const unsubscribeToken = await signToken(env.TOKEN_SECRET, 'unsubscribe', result.email, now + UNSUBSCRIBE_TTL_MS);
    const confirmUrl = new URL(`/confirm?token=${encodeURIComponent(confirmToken)}`, origin).toString();
    const unsubscribeUrl = new URL(`/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`, origin).toString();

    try {
        await sender.send(buildConfirmationEmail({ to: result.email, confirmUrl, unsubscribeUrl }));
    } catch (error) {
        console.error('Confirmation email failed:', error);

        return htmlResponse(
            renderStatusPage({
                tone: 'error',
                title: 'Gagal mengirim email',
                heading: 'Gagal mengirim email',
                message: 'Kami tidak dapat mengirim email konfirmasi. Silakan coba lagi sebentar lagi.',
                actionHref: '/',
                actionLabel: 'Coba lagi',
            }),
            502,
            request.url,
        );
    }

    return htmlResponse(successPage(result.email), 200, request.url);
}

/**
 * Confirm a subscriber from the emailed token: create the Resend contact (or
 * re-activate it) and add it to the configured Segment.
 */
export async function handleConfirm(url: URL, env: Env): Promise<Response> {
    const token = url.searchParams.get('token');

    if (!token) {
        return invalidLink(url, 'Tautan konfirmasi tidak lengkap.');
    }

    const contacts = createContactsClient(env);

    if (!env.TOKEN_SECRET || !contacts) {
        return serverErrorPage(url);
    }

    const email = await verifyToken(env.TOKEN_SECRET, token, 'confirm');

    if (!email) {
        return invalidLink(url, 'Tautan konfirmasi tidak valid atau sudah kedaluwarsa.');
    }

    try {
        const existing = await contacts.get(email);

        if (existing) {
            await contacts.setUnsubscribed(email, false);
        } else {
            await contacts.create(email, { unsubscribed: false });
        }

        if (env.RESEND_SEGMENT_ID) {
            try {
                await contacts.addToSegment(email, env.RESEND_SEGMENT_ID);
            } catch (error) {
                // The contact is subscribed either way; only grouping failed.
                console.warn('Failed to add the contact to its Segment:', error);
            }
        }
    } catch (error) {
        console.error('Confirmation failed:', error);

        return serverErrorPage(url);
    }

    return htmlResponse(
        renderStatusPage({
            tone: 'success',
            title: 'Email terverifikasi',
            heading: 'Email terverifikasi',
            message: 'Terima kasih! Langganan kamu sudah aktif.',
            actionHref: '/',
            actionLabel: 'Kembali ke beranda',
        }),
        200,
        url.toString(),
    );
}

/**
 * Stop emailing a subscriber from the token in the email footer.
 */
export async function handleUnsubscribe(url: URL, env: Env): Promise<Response> {
    const token = url.searchParams.get('token');

    if (!token) {
        return invalidLink(url, 'Tautan berhenti berlangganan tidak lengkap.');
    }

    const contacts = createContactsClient(env);

    if (!env.TOKEN_SECRET || !contacts) {
        return serverErrorPage(url);
    }

    const email = await verifyToken(env.TOKEN_SECRET, token, 'unsubscribe');

    if (!email) {
        return invalidLink(url, 'Tautan berhenti berlangganan tidak valid atau sudah digunakan.');
    }

    try {
        const existing = await contacts.get(email);

        if (existing && !existing.unsubscribed) {
            await contacts.setUnsubscribed(email, true);
        }
    } catch (error) {
        console.error('Unsubscribe failed:', error);

        return serverErrorPage(url);
    }

    return htmlResponse(
        renderStatusPage({
            tone: 'success',
            title: 'Berhenti berlangganan',
            heading: 'Berhenti berlangganan',
            message: 'Kamu berhasil berhenti berlangganan. Kami tidak akan mengirim email lagi.',
            actionHref: '/',
            actionLabel: 'Kembali ke beranda',
        }),
        200,
        url.toString(),
    );
}

/**
 * Read a form or JSON body into a plain object, tolerant of bad input.
 */
export async function readInput(request: Request): Promise<Record<string, unknown>> {
    try {
        const contentType = request.headers.get('Content-Type') ?? '';

        if (contentType.includes('application/json')) {
            return (await request.json()) as Record<string, unknown>;
        }

        const form = await request.formData();

        return Object.fromEntries(form.entries());
    } catch {
        return {};
    }
}

/**
 * The uniform "check your email" page shown for every accepted submission.
 */
function successPage(email: string): string {
    return renderStatusPage({
        tone: 'info',
        title: 'Cek email kamu',
        heading: 'Cek email kamu',
        message: `Kami sudah mengirim tautan konfirmasi ke ${email}. Buka email tersebut dan klik tautannya untuk mengaktifkan langganan.`,
        actionHref: '/',
        actionLabel: 'Kembali ke beranda',
    });
}

/**
 * Render a 400 status page for a bad or expired link.
 */
function invalidLink(url: URL, message: string): Response {
    return htmlResponse(
        renderStatusPage({
            tone: 'error',
            title: 'Tautan tidak valid',
            heading: 'Tautan tidak valid',
            message,
            actionHref: '/',
            actionLabel: 'Kembali ke beranda',
        }),
        400,
        url.toString(),
    );
}

/**
 * Render a 500 status page when Resend or the token secret is unavailable.
 */
function serverErrorPage(url: URL): Response {
    return htmlResponse(
        renderStatusPage({
            tone: 'error',
            title: 'Terjadi kesalahan',
            heading: 'Terjadi kesalahan',
            message: 'Kami tidak dapat memproses permintaanmu saat ini. Silakan coba lagi sebentar lagi.',
            actionHref: '/',
            actionLabel: 'Kembali ke beranda',
        }),
        500,
        url.toString(),
    );
}

/**
 * Build an HTML response with the baseline security headers.
 */
export function htmlResponse(html: string, status: number, requestUrl = 'https://localhost/'): Response {
    const headers: Record<string, string> = {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        // Report-only by default, matching the app, until the policy is verified.
        'Content-Security-Policy-Report-Only': CONTENT_SECURITY_POLICY,
    };

    if (new URL(requestUrl).protocol === 'https:') {
        headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    }

    return new Response(html, { status, headers });
}
