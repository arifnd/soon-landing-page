/**
 * Bindings available to the landing Worker.
 */
export interface Env {
    /**
     * Native Cloudflare rate limiter guarding `POST /subscribe` (per visitor
     * IP). Optional so local dev and tests can run without the binding.
     */
    SUBSCRIBE_RATE_LIMITER?: RateLimit;

    /**
     * Resend API key. Used for both the Contacts API (the subscriber list) and
     * sending confirmation emails. Must have **full access** — a sending-only
     * key is rejected for Contacts with `401 restricted_api_key`.
     */
    RESEND_API_KEY?: string;

    /**
     * From address for outgoing mail, e.g. `Soon <hello@soon.example.com>`.
     * Must be a verified Resend sender/domain.
     */
    EMAIL_FROM?: string;

    /**
     * Resend Segment confirmed contacts are added to (Resend deprecated
     * Audiences in favour of Segments). Optional: without it contacts are still
     * subscribed, just not grouped.
     */
    RESEND_SEGMENT_ID?: string;

    /**
     * Secret used to sign the confirmation/unsubscribe tokens (HMAC-SHA256).
     * Required for the double opt-in flow.
     */
    TOKEN_SECRET?: string;

    /**
     * Absolute base URL used to build confirmation links (e.g. production
     * custom domain). Falls back to the request origin when unset.
     */
    PUBLIC_BASE_URL?: string;
}
