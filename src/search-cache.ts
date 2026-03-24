/** Cache Storage for GET /api/search JSON responses (per-origin, ~6h TTL). */

const CACHE_NAME = 'search-api-v1';
export const SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EXPIRES_HEADER = 'X-Search-Cache-Expires';

function isCacheableSearchUrl(url: URL): boolean {
    return url.pathname === '/api/search';
}

async function openCache(): Promise<Cache | null> {
    if (typeof caches === 'undefined') return null;
    try {
        return await caches.open(CACHE_NAME);
    } catch {
        return null;
    }
}

function withExpiryHeaders(res: Response, expiresAtMs: number): Response {
    const headers = new Headers(res.headers);
    headers.set(EXPIRES_HEADER, String(expiresAtMs));
    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
    });
}

async function readFromCache(cache: Cache, request: Request): Promise<Response | null> {
    const hit = await cache.match(request);
    if (!hit) return null;
    const exp = hit.headers.get(EXPIRES_HEADER);
    if (!exp || Number(exp) <= Date.now()) {
        await cache.delete(request);
        return null;
    }
    return hit;
}

export async function invalidateSearchCache(): Promise<void> {
    if (typeof caches === 'undefined') return;
    try {
        await caches.delete(CACHE_NAME);
    } catch {
        // ignore
    }
}

type SearchHandler = (request: Request) => Promise<Response>;

/**
 * GET /api/search only: serve from Cache Storage when fresh; otherwise run handler and store.
 */
export function createCachedSearchGet(handler: SearchHandler): (path: string) => Promise<Response> {
    return async function cachedSearchGet(path: string): Promise<Response> {
        const url = new URL(path, window.location.origin);
        if (!isCacheableSearchUrl(url)) {
            return handler(new Request(url.toString()));
        }

        const request = new Request(url.toString(), { method: 'GET' });
        const cache = await openCache();

        if (cache) {
            const cached = await readFromCache(cache, request);
            if (cached) {
                return cached.clone();
            }
        }

        const live = await handler(request);
        if (!live.ok || !cache) {
            return live;
        }
        const ct = live.headers.get('content-type') ?? '';
        if (!ct.includes('json')) {
            return live;
        }

        try {
            const body = await live.clone().arrayBuffer();
            const expiresAt = Date.now() + SEARCH_CACHE_TTL_MS;
            const stored = withExpiryHeaders(
                new Response(body, {
                    status: live.status,
                    statusText: live.statusText,
                    headers: live.headers,
                }),
                expiresAt
            );
            await cache.put(request, stored);
            return stored.clone();
        } catch {
            // quota / private mode
        }

        return live;
    };
}
