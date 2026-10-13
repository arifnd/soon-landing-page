import { readFileSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

/**
 * Import `.html` files as raw text, matching the Wrangler Text loader rule in
 * wrangler.toml. Vite/Vitest do not handle `.html` imports outside the page
 * entry pipeline, so tests need this to mirror the bundled Worker.
 */
function htmlAsText() {
    return {
        name: 'html-as-text',
        enforce: 'pre' as const,
        load(id: string): string | null {
            if (!id.endsWith('.html')) {
                return null;
            }

            return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
        },
    };
}

export default defineConfig({
    plugins: [htmlAsText()],
});
