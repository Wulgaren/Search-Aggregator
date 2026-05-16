import { getApiSecret } from './api-keys';
import { resolveQueryForBangHandling, redirectForBang } from './query-bangs';
import { searchApiFetch } from './search-fetch';

/**
 * Starts `?q=` search fetches ASAP (wired from HTML before deferred `script.js`).
 * Shares `searchApiFetch` with the main bundle so Google caching stays consistent.
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
    const base = `/api/search?q=${encodeURIComponent(searchQ)}&page=1&source=`;
    const hasGoogle = Boolean(getApiSecret('GOOGLE_SERVICE_ACCOUNT')) && Boolean(getApiSecret('GOOGLE_CX'));
    const enc = encodeURIComponent(searchQ);
    const imgGoogle = `/api/search?q=${enc}&source=images&imageSource=google&page=1`;
    const imgGooglePromise = hasGoogle ? searchApiFetch(imgGoogle) : null;
    window.__earlyFetch = {
        query: searchQ,
        brave: searchApiFetch(base + 'brave'),
        ...(hasGoogle && imgGooglePromise
            ? { google: searchApiFetch(base + 'google'), images: imgGooglePromise }
            : {}),
        marginalia: searchApiFetch(base + 'marginalia'),
        wiby: searchApiFetch(base + 'wiby'),
        infobox: searchApiFetch(`/api/search?q=${enc}&source=infobox`),
    };
}
