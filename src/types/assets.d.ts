/**
 * Ambient module declarations for non-code files imported as text.
 *
 * Wrangler bundles these via the `[[rules]]` Text loader in wrangler.toml; the
 * declaration below only teaches TypeScript the shape of the import.
 */
declare module '*.html' {
    const content: string;
    export default content;
}
