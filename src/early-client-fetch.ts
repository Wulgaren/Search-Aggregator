import { hasGoogleSearchConfigured, hasTavilySearchConfigured } from './api-keys';
import { resolveQueryForBangHandling, redirectForBang } from './query-bangs';
import { searchApiFetch } from './search-fetch';
import { primeTavilyConnection } from './tavily-search';
import type { EarlyFetchState } from './types';
import { detectUtilityIntent } from './utility-intent';
import { buildUtilityEarlyFetchPath } from './utility-early-path';

/**
 * Starts `?q=` search fetches ASAP (wired from HTML before deferred `script.js`).
 * Shares `searchApiFetch` with the main bundle so Google/Tavily caching stays consistent.
 * When a Tavily key is present, primes DNS/TLS even on the homepage (no `?q=`).
 * Utility intents skip web/infobox/images early fetches (search is opt-in via UI).
 * Utility early fetch only when intent ≠ null and the intent needs a network call.
 */
export function bootstrapEarlyFetch(): void {
    const hasTavily = hasTavilySearchConfigured();
    if (hasTavily) primeTavilyConnection();

    const q = new URLSearchParams(window.location.search).get('q');
    if (!q) return;
    const resolved = resolveQueryForBangHandling(q);
    if (resolved.kind === 'redirect') {
        redirectForBang(resolved.q);
        return;
    }
    const searchQ = resolved.q;
    if (!searchQ.trim()) return;

    const intent = detectUtilityIntent(searchQ);
    if (intent) {
        const early: EarlyFetchState = { query: searchQ };
        const utilityPath = buildUtilityEarlyFetchPath(intent);
        if (utilityPath) {
            early.utility = searchApiFetch(utilityPath);
        }
        window.__earlyFetch = early;
        return;
    }

    const base = `/api/search?q=${encodeURIComponent(searchQ)}&page=1&source=`;
    const hasGoogle = hasGoogleSearchConfigured();
    const enc = encodeURIComponent(searchQ);
    const imgGoogle = `/api/search?q=${enc}&source=images&imageSource=google&page=1`;
    const imgGooglePromise = hasGoogle ? searchApiFetch(imgGoogle) : null;
    const early: EarlyFetchState = {
        query: searchQ,
        brave: searchApiFetch(base + 'brave'),
        ...(hasGoogle && imgGooglePromise
            ? { google: searchApiFetch(base + 'google'), images: imgGooglePromise }
            : {}),
        ...(hasTavily ? { tavily: searchApiFetch(base + 'tavily') } : {}),
        marginalia: searchApiFetch(base + 'marginalia'),
        wiby: searchApiFetch(base + 'wiby'),
        infobox: searchApiFetch(`/api/search?q=${enc}&source=infobox`),
    };
    window.__earlyFetch = early;
}
