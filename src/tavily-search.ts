/**
 * Tavily Search in the browser. API key from localStorage (see api-keys.ts).
 * Called directly (no Edge hop) when `source=tavily`, same pattern as Google CSE.
 */

import { getApiSecret } from './api-keys';
import type { SearchHandler, SearchResult } from './types';

const SEARCH_JSON_CACHE =
    'public, max-age=300, s-maxage=300, stale-while-revalidate=86400';
const TAVILY_SEARCH_CACHE_NAME = 'search-api-tavily-v1';
const TAVILY_SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TAVILY_SEARCH_EXPIRES_HEADER = 'X-Search-Cache-Expires';
const TAVILY_MAX_RESULTS = 10;
const TAVILY_API_ORIGIN = 'https://api.tavily.com';
const TAVILY_PRECONNECT_ATTR = 'data-tavily-preconnect';

/**
 * Warm DNS + TLS to Tavily when a key is configured (homepage or before search).
 * Skips injecting duplicate link tags. Does not send an API request.
 */
export function primeTavilyConnection(): void {
    if (typeof document === 'undefined') return;
    if (document.head.querySelector(`link[${TAVILY_PRECONNECT_ATTR}]`)) return;

    const dns = document.createElement('link');
    dns.rel = 'dns-prefetch';
    dns.href = TAVILY_API_ORIGIN;
    dns.setAttribute(TAVILY_PRECONNECT_ATTR, '1');

    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = TAVILY_API_ORIGIN;
    pre.crossOrigin = 'anonymous';
    pre.setAttribute(TAVILY_PRECONNECT_ATTR, '1');

    document.head.append(dns, pre);
}

type TavilyResultItem = {
    title?: string;
    url?: string;
    content?: string;
};

type TavilySearchResponse = {
    results?: TavilyResultItem[];
    detail?: { error?: string } | string;
    error?: string;
};

type TavilySearchPayload = {
    results: SearchResult[];
    hasMore: boolean;
    totalResults: string;
};

async function openTavilySearchCache(): Promise<Cache | null> {
    if (typeof caches === 'undefined') return null;
    try {
        return await caches.open(TAVILY_SEARCH_CACHE_NAME);
    } catch {
        return null;
    }
}

function withExpiryHeaders(res: Response, expiresAtMs: number): Response {
    const headers = new Headers(res.headers);
    headers.set(TAVILY_SEARCH_EXPIRES_HEADER, String(expiresAtMs));
    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
    });
}

async function readFromTavilySearchCache(cache: Cache, request: Request): Promise<Response | null> {
    const hit = await cache.match(request);
    if (!hit) return null;
    const exp = hit.headers.get(TAVILY_SEARCH_EXPIRES_HEADER);
    if (!exp || Number(exp) <= Date.now()) {
        await cache.delete(request);
        return null;
    }
    return hit;
}

export async function invalidateTavilySearchCache(): Promise<void> {
    if (typeof caches === 'undefined') return;
    try {
        await caches.delete(TAVILY_SEARCH_CACHE_NAME);
    } catch {
        // ignore
    }
}

/** Cache only Tavily-client /api/search GET routes in Cache Storage. */
export function createCachedTavilySearchGet(handler: SearchHandler): (path: string) => Promise<Response> {
    return async function cachedTavilySearchGet(path: string): Promise<Response> {
        const url = new URL(path, window.location.origin);
        if (!isTavilyClientSearchUrl(url)) {
            return handler(new Request(url.toString()));
        }

        const request = new Request(url.toString(), { method: 'GET' });
        const cache = await openTavilySearchCache();
        if (cache) {
            const cached = await readFromTavilySearchCache(cache, request);
            if (cached) return cached.clone();
        }

        const live = await handler(request);
        if (!live.ok || !cache) return live;
        const ct = live.headers.get('content-type') ?? '';
        if (!ct.includes('json')) return live;

        try {
            const body = await live.clone().arrayBuffer();
            const expiresAt = Date.now() + TAVILY_SEARCH_CACHE_TTL_MS;
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

export function isTavilyClientSearchUrl(url: URL): boolean {
    return url.pathname === '/api/search' && url.searchParams.get('source') === 'tavily';
}

function displayUrlFromHref(href: string): string {
    try {
        return new URL(href).hostname;
    } catch {
        return href;
    }
}

async function fetchTavily(query: string, page: number, resultsPerPage: number): Promise<TavilySearchPayload> {
    const apiKey = getApiSecret('TAVILY_API_KEY');
    if (!apiKey) {
        return { results: [], hasMore: false, totalResults: '0' };
    }

    // Tavily has no offset pagination; only serve the first page.
    if (page > 1) {
        return { results: [], hasMore: false, totalResults: '0' };
    }

    const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            query,
            search_depth: 'fast',
            include_answer: false,
            max_results: Math.min(Math.max(1, resultsPerPage), TAVILY_MAX_RESULTS),
        }),
    });

    if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as TavilySearchResponse;
        const detail = errorData.detail;
        const detailMsg =
            typeof detail === 'string'
                ? detail
                : detail && typeof detail === 'object'
                  ? detail.error
                  : undefined;
        throw new Error(detailMsg || errorData.error || `Tavily API error: ${response.status}`);
    }

    const data = (await response.json()) as TavilySearchResponse;
    const results = (data.results || [])
        .filter((item): item is TavilyResultItem & { url: string; title: string } =>
            Boolean(item.url && item.title)
        )
        .map((item) => ({
            title: item.title,
            url: item.url,
            displayUrl: displayUrlFromHref(item.url),
            snippet: item.content || '',
            source: 'tavily',
        }));

    return {
        results,
        hasMore: false,
        totalResults: String(results.length),
    };
}

export async function handleTavilySearchRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const query = url.searchParams.get('q');
    const page = parseInt(url.searchParams.get('page') ?? '', 10) || 1;

    if (!query || query.trim() === '') {
        return new Response(JSON.stringify({ error: 'Query parameter "q" is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const tavily = await fetchTavily(query.trim(), page, TAVILY_MAX_RESULTS);
        return new Response(JSON.stringify({ page, tavily }), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': SEARCH_JSON_CACHE,
            },
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(
            JSON.stringify({
                page,
                tavily: { error: msg, results: [], hasMore: false },
            }),
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': SEARCH_JSON_CACHE,
                },
            }
        );
    }
}
