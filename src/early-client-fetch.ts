import { resolveQueryForBangHandling, redirectForBang } from './query-bangs';
import { searchApiFetch } from './search-fetch';

/**
 * Starts `?q=` search fetches ASAP (wired from HTML before deferred `script.js`).
 * Always fires aggregate + google + combined images + infobox (Node/Edge quiet no-op Google if unset).
 */
export function bootstrapEarlyFetch(): void {
    const q = new URLSearchParams(window.location.search).get('q');
    if (!q) return;
    const resolved = resolveQueryForBangHandling(q);
    if (resolved.kind === 'redirect') {
        redirectForBang(resolved.q);
        return;
    }
    const searchQ = resolved.q;
    if (!searchQ.trim()) return;
    const enc = encodeURIComponent(searchQ);
    window.__earlyFetch = {
        query: searchQ,
        aggregate: searchApiFetch(`/api/search?q=${enc}&page=1`),
        google: searchApiFetch(`/api/search?q=${enc}&page=1&source=google`),
        images: searchApiFetch(`/api/search?q=${enc}&source=images&page=1`),
        infobox: searchApiFetch(`/api/search?q=${enc}&source=infobox`),
    };
}
