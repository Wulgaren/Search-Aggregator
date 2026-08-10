import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LS_KEYS,
    clearStoredGoogleAccessToken,
    setApiSecrets,
    setStoredGoogleAccessToken,
} from './api-keys';
import {
    clearGoogleClientCaches,
    createCachedGoogleSearchGet,
    handleGoogleSearchRequest,
    invalidateGoogleSearchCache,
    isGoogleClientSearchUrl,
} from './google-search';

const CACHE_NAME = 'search-api-google-v1';
const EXPIRES_HEADER = 'X-Search-Cache-Expires';

const MIN_SA = JSON.stringify({
    type: 'service_account',
    client_email: 'bot@example.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n',
});

/** Minimal Cache Storage stub (jsdom has no caches). */
function installCacheStorageStub() {
    const cachesMap = new Map<string, Map<string, Response>>();

    const openCache = (name: string) => {
        if (!cachesMap.has(name)) cachesMap.set(name, new Map());
        const store = cachesMap.get(name)!;
        return {
            async match(request: RequestInfo | URL): Promise<Response | undefined> {
                const key = request instanceof Request ? request.url : String(request);
                const hit = store.get(key);
                return hit ? hit.clone() : undefined;
            },
            async put(request: RequestInfo | URL, response: Response): Promise<void> {
                const key = request instanceof Request ? request.url : String(request);
                store.set(key, response.clone());
            },
            async delete(request: RequestInfo | URL): Promise<boolean> {
                const key = request instanceof Request ? request.url : String(request);
                return store.delete(key);
            },
        };
    };

    const storage = {
        open: async (name: string) => openCache(name),
        delete: async (name: string) => cachesMap.delete(name),
        has: async (name: string) => cachesMap.has(name),
        keys: async () => [...cachesMap.keys()],
        match: async () => undefined,
        _map: cachesMap,
    };

    vi.stubGlobal('caches', storage);
    return storage;
}

function seedGoogleConfig(opts?: { token?: boolean }) {
    setApiSecrets({
        GOOGLE_CX: 'cx-test',
        GOOGLE_SERVICE_ACCOUNT: MIN_SA,
    });
    if (opts?.token !== false) {
        setStoredGoogleAccessToken('test-access-token', 3600);
    }
}

function googleCseFetchMock(handler: (url: URL) => Response | Promise<Response>) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.hostname === 'www.googleapis.com' && url.pathname === '/customsearch/v1') {
            return handler(url);
        }
        if (url.pathname === '/api/search') {
            // Brave / images edge fallbacks in tests
            if (url.searchParams.get('source') === 'brave') {
                return Response.json({
                    brave: {
                        results: [{ title: 'Brave', url: 'https://brave.example', snippet: 'b' }],
                        hasMore: false,
                    },
                });
            }
            if (url.searchParams.get('source') === 'images') {
                return Response.json({ images: [] });
            }
            return new Response('not found', { status: 404 });
        }
        if (url.hostname === 'oauth2.googleapis.com') {
            return Response.json({ access_token: 'oauth-fresh', expires_in: 3600 });
        }
        return new Response(`unhandled ${url}`, { status: 500 });
    });
}

describe('isGoogleClientSearchUrl', () => {
    it('detects google web and image client routes', () => {
        expect(isGoogleClientSearchUrl(new URL('http://localhost/api/search?source=google'))).toBe(true);
        expect(
            isGoogleClientSearchUrl(
                new URL('http://localhost/api/search?source=images&imageSource=google')
            )
        ).toBe(true);
        expect(isGoogleClientSearchUrl(new URL('http://localhost/api/search?source=images'))).toBe(
            true
        );
        expect(isGoogleClientSearchUrl(new URL('http://localhost/api/search?source=brave'))).toBe(
            false
        );
        expect(isGoogleClientSearchUrl(new URL('http://localhost/api/ai'))).toBe(false);
    });
});

describe('handleGoogleSearchRequest', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        localStorage.clear();
        clearGoogleClientCaches();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        localStorage.clear();
        clearGoogleClientCaches();
    });

    it('returns empty google payload when CX / service account unset', async () => {
        fetchMock.mockImplementation(googleCseFetchMock(() => {
            throw new Error('should not call CSE');
        }));

        const res = await handleGoogleSearchRequest(
            new Request('http://localhost/api/search?q=cats&source=google&page=1')
        );
        expect(res.ok).toBe(true);
        expect(await res.json()).toEqual({
            page: 1,
            google: { results: [], hasMore: false, totalResults: '0' },
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('builds CSE URL params and maps items with stored OAuth token', async () => {
        seedGoogleConfig();
        fetchMock.mockImplementation(
            googleCseFetchMock((url) => {
                expect(url.searchParams.get('cx')).toBe('cx-test');
                expect(url.searchParams.get('q')).toBe('cats');
                expect(url.searchParams.get('num')).toBe('10');
                expect(url.searchParams.get('start')).toBe('1');
                expect(url.searchParams.get('fields')).toContain('items(title,link');
                return Response.json({
                    items: [
                        {
                            title: 'Cat',
                            link: 'https://example.com/cat',
                            displayLink: 'example.com',
                            snippet: 'meow',
                        },
                    ],
                    searchInformation: { totalResults: '42' },
                    spelling: { correctedQuery: 'cats', htmlCorrectedQuery: '<b>cats</b>' },
                });
            })
        );

        const res = await handleGoogleSearchRequest(
            new Request('http://localhost/api/search?q=cats&source=google&page=1')
        );
        const body = await res.json();
        expect(body.page).toBe(1);
        expect(body.google.results).toEqual([
            {
                title: 'Cat',
                url: 'https://example.com/cat',
                displayUrl: 'example.com',
                snippet: 'meow',
                source: 'google',
            },
        ]);
        expect(body.google.totalResults).toBe('42');
        expect(body.google.correctedQuery).toBe('cats');
        expect(body.google.htmlCorrectedQuery).toBe('<b>cats</b>');

        const cseCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('googleapis.com'));
        expect(cseCall).toBeTruthy();
        expect((cseCall![1] as RequestInit).headers).toMatchObject({
            Authorization: 'Bearer test-access-token',
        });
    });

    it('uses page for start index', async () => {
        seedGoogleConfig();
        fetchMock.mockImplementation(
            googleCseFetchMock((url) => {
                expect(url.searchParams.get('start')).toBe('11');
                return Response.json({ items: [], searchInformation: { totalResults: '0' } });
            })
        );

        await handleGoogleSearchRequest(
            new Request('http://localhost/api/search?q=cats&source=google&page=2')
        );
    });

    it('returns 400 when q missing; 405 for non-GET', async () => {
        const missing = await handleGoogleSearchRequest(
            new Request('http://localhost/api/search?source=google')
        );
        expect(missing.status).toBe(400);

        const badMethod = await handleGoogleSearchRequest(
            new Request('http://localhost/api/search?q=x&source=google', { method: 'POST' })
        );
        expect(badMethod.status).toBe(405);
    });

    it('returns empty images when Google unset', async () => {
        fetchMock.mockImplementation(googleCseFetchMock(() => {
            throw new Error('no CSE');
        }));
        // No credentials → fetchGoogleImages returns []; imageSource=google then tries Brave edge
        fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
            if (url.pathname === '/api/search' && url.searchParams.get('imageSource') === 'brave') {
                return Response.json({ images: [{ thumbnail: 't', full: 'https://b.example/i' }] });
            }
            return new Response('nope', { status: 404 });
        });

        const res = await handleGoogleSearchRequest(
            new Request(
                'http://localhost/api/search?q=cats&source=images&imageSource=google&page=1'
            )
        );
        const body = await res.json();
        expect(body.images).toEqual([{ thumbnail: 't', full: 'https://b.example/i' }]);
    });
});

describe('createCachedGoogleSearchGet', () => {
    beforeEach(() => {
        localStorage.clear();
        clearGoogleClientCaches();
        vi.useFakeTimers({ now: new Date('2026-01-15T12:00:00Z').getTime() });
    });

    afterEach(async () => {
        await invalidateGoogleSearchCache();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        localStorage.clear();
        clearGoogleClientCaches();
    });

    it('cache miss stores JSON ok response; hit returns clone without re-calling handler', async () => {
        installCacheStorageStub();
        const handler = vi.fn(async () =>
            Response.json({ page: 1, google: { results: [], hasMore: false, totalResults: '0' } })
        );
        const cachedGet = createCachedGoogleSearchGet(handler);
        const path = '/api/search?q=cats&source=google&page=1';

        const first = await cachedGet(path);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(first.headers.get(EXPIRES_HEADER)).toBeTruthy();
        expect(await first.json()).toMatchObject({ page: 1 });

        const second = await cachedGet(path);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(await second.json()).toMatchObject({ page: 1 });
    });

    it('expired entry is treated as miss and deleted', async () => {
        installCacheStorageStub();
        const handler = vi.fn(async () => Response.json({ n: 1 }));
        const cachedGet = createCachedGoogleSearchGet(handler);
        const path = '/api/search?q=cats&source=google&page=1';

        await cachedGet(path);
        expect(handler).toHaveBeenCalledTimes(1);

        // TTL is 6h
        vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);

        handler.mockImplementation(async () => Response.json({ n: 2 }));
        const afterExpiry = await cachedGet(path);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(await afterExpiry.json()).toEqual({ n: 2 });
    });

    it('does not cache non-ok or non-json responses', async () => {
        installCacheStorageStub();
        const handler = vi.fn(async () => new Response('plain', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
        const cachedGet = createCachedGoogleSearchGet(handler);
        const path = '/api/search?q=cats&source=google&page=1';

        await cachedGet(path);
        await cachedGet(path);
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it('non-Google URLs bypass Cache Storage and call handler directly', async () => {
        installCacheStorageStub();
        const handler = vi.fn(async () => Response.json({ ok: true }));
        const cachedGet = createCachedGoogleSearchGet(handler);

        await cachedGet('/api/search?q=cats&source=brave&page=1');
        await cachedGet('/api/search?q=cats&source=brave&page=1');
        expect(handler).toHaveBeenCalledTimes(2);
        expect(await caches.has(CACHE_NAME)).toBe(false);
    });

    it('works when caches API missing (no throw, no persist)', async () => {
        // no caches stub
        const handler = vi.fn(async () => Response.json({ ok: true }));
        const cachedGet = createCachedGoogleSearchGet(handler);
        const path = '/api/search?q=cats&source=google&page=1';

        const a = await cachedGet(path);
        const b = await cachedGet(path);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(await a.json()).toEqual({ ok: true });
        expect(await b.json()).toEqual({ ok: true });
    });
});

describe('invalidate / clear helpers', () => {
    afterEach(async () => {
        vi.unstubAllGlobals();
        localStorage.clear();
        clearGoogleClientCaches();
    });

    it('invalidateGoogleSearchCache deletes named cache', async () => {
        const storage = installCacheStorageStub();
        await storage.open(CACHE_NAME);
        expect(await storage.has(CACHE_NAME)).toBe(true);
        await invalidateGoogleSearchCache();
        expect(await storage.has(CACHE_NAME)).toBe(false);
    });

    it('clearGoogleClientCaches clears stored OAuth token', () => {
        setStoredGoogleAccessToken('tok', 3600);
        expect(localStorage.getItem(LS_KEYS.GOOGLE_OAUTH_TOKEN)).toBeTruthy();
        clearGoogleClientCaches();
        expect(localStorage.getItem(LS_KEYS.GOOGLE_OAUTH_TOKEN)).toBeNull();
        clearStoredGoogleAccessToken();
    });

    it('invalidateGoogleSearchCache no-ops when caches undefined', async () => {
        await expect(invalidateGoogleSearchCache()).resolves.toBeUndefined();
    });
});
