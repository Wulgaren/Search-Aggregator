import { hasGoogleSearchConfigured } from './api-keys';
import { resolveQueryForBangHandling, redirectForBang } from './query-bangs';
import { searchApiFetch } from './search-fetch';

/**
 * Starts `?q=` search fetches ASAP (wired from HTML before deferred `script.js`).
 * Shares `searchApiFetch` with the main bundle so Google caching stays consistent.
 * Edge sources (brave/marginalia/wiby/tavily) use one aggregate `/api/search` (no `source`).
 * Images: combined Google+Brave when Google is configured (`source=images`, no `imageSource`);
 * Brave-only via edge when not (`imageSource=brave`).
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
    const hasGoogle = hasGoogleSearchConfigured();
    const imagesUrl = hasGoogle
        ? `/api/search?q=${enc}&source=images&page=1`
        : `/api/search?q=${enc}&source=images&imageSource=brave&page=1`;
    window.__earlyFetch = {
        query: searchQ,
        aggregate: searchApiFetch(`/api/search?q=${enc}&page=1`),
        images: searchApiFetch(imagesUrl),
        ...(hasGoogle ? { google: searchApiFetch(`/api/search?q=${enc}&page=1&source=google`) } : {}),
        infobox: searchApiFetch(`/api/search?q=${enc}&source=infobox`),
    };
}
