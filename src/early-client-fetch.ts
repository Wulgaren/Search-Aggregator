import { resolveQueryForBangHandling, redirectForBang } from './query-bangs';
import { searchApiFetch } from './search-fetch';

/** Stagger images after aggregate so Brave web + Brave images are less likely to race the same rate limit. */
const IMAGES_EARLY_FETCH_DELAY_MS = 500;

/**
 * Starts `?q=` search fetches ASAP (wired from HTML before deferred `script.js`).
 * Always fires aggregate + google + combined images + infobox (Node/Edge quiet no-op Google if unset).
 * Images start after {@link IMAGES_EARLY_FETCH_DELAY_MS} so they don't share Brave's burst with aggregate.
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
    const imagesPath = `/api/search?q=${enc}&source=images&page=1`;
    window.__earlyFetch = {
        query: searchQ,
        aggregate: searchApiFetch(`/api/search?q=${enc}&page=1`),
        google: searchApiFetch(`/api/search?q=${enc}&page=1&source=google`),
        images: new Promise((resolve, reject) => {
            window.setTimeout(() => {
                void searchApiFetch(imagesPath).then(resolve, reject);
            }, IMAGES_EARLY_FETCH_DELAY_MS);
        }),
        infobox: searchApiFetch(`/api/search?q=${enc}&source=infobox`),
    };
}
