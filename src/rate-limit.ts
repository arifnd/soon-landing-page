import type { Env } from './env.ts';

export const RATE_LIMIT_MESSAGE = 'Terlalu banyak permintaan. Silakan coba lagi nanti.';

/**
 * Return true when the submitter is within the subscribe rate limit.
 *
 * The limiter is keyed on the visitor IP. Requests without an IP (local dev)
 * and environments without the binding configured are always allowed, so the
 * Worker keeps working without the optional binding.
 */
export async function isSubscribeAllowed(env: Env, request: Request): Promise<boolean> {
    const limiter = env.SUBSCRIBE_RATE_LIMITER;

    if (!limiter) {
        return true;
    }

    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';

    const { success } = await limiter.limit({ key });

    return success;
}
