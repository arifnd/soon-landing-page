import type { LandingNotice } from './notice.ts';
import landingTemplate from './templates/landing.html';
import statusTemplate from './templates/status.html';

/**
 * Path of the landing stylesheet served from Workers Assets.
 */
export const LANDING_STYLESHEET = '/assets/landing.css';

/**
 * Escape a value for use in HTML text or an attribute.
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export interface LandingPageOptions {
    notice: LandingNotice | null;
    /**
     * Server-rendered timestamp the honeypot/time-trap compares against. A
     * submission faster than the threshold is treated as a bot.
     */
    renderedAt: number;
}

/**
 * Render the coming-soon landing document with the email capture form.
 *
 * The markup lives in `templates/landing.html` (imported as text) and the
 * styling in `public/assets/landing.css`, so the page ships without inline CSS;
 * the form posts back to `/subscribe`.
 */
export function renderLandingPage(options: LandingPageOptions): string {
    const values: Record<string, string> = {
        stylesheet: LANDING_STYLESHEET,
        rendered_at: String(options.renderedAt),
        notice_class: options.notice ? ` ${options.notice.type}` : '',
        // Escaped before substitution so a notice can never inject markup.
        notice_text: options.notice ? escapeHtml(options.notice.message) : '',
    };

    return landingTemplate.replace(/\{\{(\w+)\}\}/g, (token, key: string) => values[key] ?? token);
}

export interface StatusPageOptions {
    tone: 'success' | 'error' | 'info';
    title: string;
    heading: string;
    message: string;
    actionHref?: string;
    actionLabel?: string;
}

/**
 * Render a standalone status page (confirm, unsubscribe, errors) using the
 * shared brand styling. The `tone` drives which icon and accent are shown.
 */
export function renderStatusPage(options: StatusPageOptions): string {
    const values: Record<string, string> = {
        stylesheet: LANDING_STYLESHEET,
        tone: options.tone,
        title: escapeHtml(options.title),
        heading: escapeHtml(options.heading),
        message: escapeHtml(options.message),
        action_href: escapeHtml(options.actionHref ?? '/'),
        action_label: escapeHtml(options.actionLabel ?? 'Kembali ke beranda'),
    };

    return statusTemplate.replace(/\{\{(\w+)\}\}/g, (token, key: string) => values[key] ?? token);
}
