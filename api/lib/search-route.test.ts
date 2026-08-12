import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateEdgeRequest } from './search-route';
import searchHandler, { runtime as searchRuntime } from '../search';
import aiHandler, { runtime as aiRuntime } from '../ai';

const originalEnv = { ...process.env };

function jsonRequest(url: string, init?: RequestInit): Request {
    return new Request(url, init);
}

async function readJson(res: Response) {
    return res.json();
}

describe('aggregateEdgeRequest', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        process.env = { ...originalEnv };
        delete process.env["BRAVE_API_KEY"];
        delete process.env["GROQ_API_KEY"];
        delete process.env["MARGINALIA_API_KEY"];
        delete process.env["TAVILY_API_KEY"];
        delete process.env["GOOGLE_CX"];
        delete process.env["GOOGLE_SERVICE_ACCOUNT"];
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.unstubAllGlobals();
    });

    it('returns 400 JSON when q is missing', async () => {
        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search')
        );
        expect(res.status).toBe(400);
        expect(res.headers.get('Content-Type')).toBe('application/json');
        await expect(readJson(res)).resolves.toEqual({
            error: 'Query parameter "q" is required',
        });
    });

    it('returns 400 JSON when q is blank', async () => {
        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=%20%20')
        );
        expect(res.status).toBe(400);
        await expect(readJson(res)).resolves.toEqual({
            error: 'Query parameter "q" is required',
        });
    });

    it('returns 405 for non-GET search requests', async () => {
        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=cats', { method: 'POST' })
        );
        expect(res.status).toBe(405);
        await expect(readJson(res)).resolves.toEqual({ error: 'Method not allowed' });
    });

    it('routes /api/ai and rejects non-POST', async () => {
        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/ai', { method: 'GET' })
        );
        expect(res.status).toBe(405);
        await expect(readJson(res)).resolves.toEqual({ error: 'Method not allowed' });
    });

    it('routes /api/ai: missing Groq key → 500', async () => {
        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: 'hello' }),
            })
        );
        expect(res.status).toBe(500);
        await expect(readJson(res)).resolves.toEqual({
            error: 'Groq API key not configured',
        });
    });

    it('routes /api/ai: invalid JSON body → 400', async () => {
        process.env["GROQ_API_KEY"] = 'test-key';
        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: 'not-json',
            })
        );
        expect(res.status).toBe(400);
        await expect(readJson(res)).resolves.toEqual({ error: 'Invalid JSON body' });
    });

    it('routes /api/ai: empty query → 400', async () => {
        process.env["GROQ_API_KEY"] = 'test-key';
        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: '  ' }),
            })
        );
        expect(res.status).toBe(400);
        await expect(readJson(res)).resolves.toEqual({ error: 'Query is required' });
    });

    it('routes /api/ai: streams when Groq fetch succeeds', async () => {
        process.env["GROQ_API_KEY"] = 'test-key';
        const sse = [
            'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
            'data: [DONE]\n\n',
        ].join('');
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(sse, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: 'hello' }),
            })
        );

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.groq.com/openai/v1/chat/completions',
            expect.objectContaining({ method: 'POST' })
        );

        const text = await res.text();
        expect(text).toContain('"content":"Hi"');
        expect(text).toContain('data: [DONE]');
    });

    it('source=infobox returns JSON with mocked Wikipedia open search empty', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify(['cats', [], [], []]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=cats&source=infobox')
        );
        expect(res.status).toBe(200);
        await expect(readJson(res)).resolves.toEqual({ infobox: null });
        expect(fetchMock).toHaveBeenCalled();
    });

    it('source=infobox returns shaped infobox when Wikipedia page is mocked', async () => {
        const extract =
            'A domestic animal kept as a companion. Cats have been valued by humans for millennia.';
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (url.includes('action=opensearch')) {
                return new Response(JSON.stringify(['cats', ['Cat'], [''], ['']]), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.includes('prop=extracts')) {
                return new Response(
                    JSON.stringify({
                        query: {
                            pages: {
                                '1': {
                                    title: 'Cat',
                                    extract,
                                    fullurl: 'https://en.wikipedia.org/wiki/Cat',
                                    thumbnail: {
                                        source: 'https://example.com/cat.jpg',
                                        width: 100,
                                        height: 80,
                                    },
                                },
                            },
                        },
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            if (url.includes('ppprop=wikibase_item')) {
                return new Response(
                    JSON.stringify({ query: { pages: { '1': { pageprops: {} } } } }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response('{}', { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=cats&source=infobox')
        );
        expect(res.status).toBe(200);
        const body = await readJson(res);
        expect(body.infobox).toMatchObject({
            title: 'Cat',
            description: extract,
            url: 'https://en.wikipedia.org/wiki/Cat',
            image: 'https://example.com/cat.jpg',
        });
    });

    it('source=google without env returns quiet empty google payload', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=cats&source=google')
        );
        expect(res.status).toBe(200);
        const body = await readJson(res);
        expect(body.google).toEqual({ results: [], hasMore: false, totalResults: '0' });
        expect(body.google.error).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('source=google with CSE failure returns google.error and empty results', async () => {
        process.env["GOOGLE_CX"] = 'test-cx';
        process.env["GOOGLE_SERVICE_ACCOUNT"] = await (async () => {
            const keyPair = await crypto.subtle.generateKey(
                {
                    name: 'RSASSA-PKCS1-v1_5',
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256',
                },
                true,
                ['sign', 'verify']
            );
            const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
            const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
            const wrapped = (b64.match(/.{1,64}/g) || [b64]).join('\n');
            return JSON.stringify({
                client_email: 'vitest@example.iam.gserviceaccount.com',
                private_key: `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`,
            });
        })();

        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const u =
                typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.href
                      : input.url;
            if (u.includes('oauth2.googleapis.com/token')) {
                return new Response(
                    JSON.stringify({ access_token: 'ya29.fail', expires_in: 3600 }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            if (u.includes('customsearch/v1')) {
                return new Response(
                    JSON.stringify({ error: { message: 'CSE quota exceeded' } }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            throw new Error(`unexpected ${u}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=cats&source=google')
        );
        expect(res.status).toBe(200);
        const body = await readJson(res);
        expect(body.google).toMatchObject({
            error: 'CSE quota exceeded',
            results: [],
            hasMore: false,
        });
    });

    it('source=images without imageSource interleaves Google then Brave and dedupes', async () => {
        process.env["BRAVE_API_KEY"] = 'brave-test';
        process.env["GOOGLE_CX"] = 'test-cx';
        process.env["GOOGLE_SERVICE_ACCOUNT"] = await (async () => {
            const keyPair = await crypto.subtle.generateKey(
                {
                    name: 'RSASSA-PKCS1-v1_5',
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256',
                },
                true,
                ['sign', 'verify']
            );
            const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
            const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
            const wrapped = (b64.match(/.{1,64}/g) || [b64]).join('\n');
            return JSON.stringify({
                client_email: `vitest-img-${Date.now()}@example.iam.gserviceaccount.com`,
                private_key: `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`,
            });
        })();

        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const u =
                typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.href
                      : input.url;
            if (u.includes('oauth2.googleapis.com/token')) {
                return new Response(
                    JSON.stringify({ access_token: 'ya29.img', expires_in: 3600 }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            if (u.includes('searchType=image')) {
                return new Response(
                    JSON.stringify({
                        items: [
                            {
                                title: 'G1',
                                link: 'https://cdn.example/g1.jpg',
                                image: {
                                    thumbnailLink: 'https://cdn.example/g1-t.jpg',
                                    contextLink: 'https://example.com/g1',
                                },
                            },
                            {
                                title: 'Dup shared',
                                link: 'https://cdn.example/shared.jpg',
                                image: {
                                    thumbnailLink: 'https://cdn.example/shared-t.jpg',
                                    contextLink: 'https://example.com/shared',
                                },
                            },
                        ],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            if (u.includes('api.search.brave.com/res/v1/images')) {
                return new Response(
                    JSON.stringify({
                        results: [
                            {
                                title: 'B1',
                                url: 'https://example.com/b1',
                                thumbnail: { src: 'https://cdn.example/b1-t.jpg' },
                                properties: { url: 'https://cdn.example/b1.jpg' },
                            },
                            {
                                title: 'Dup brave',
                                url: 'https://example.com/shared',
                                thumbnail: { src: 'https://cdn.example/shared-t2.jpg' },
                                properties: { url: 'https://cdn.example/shared.jpg' },
                            },
                        ],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            throw new Error(`unexpected ${u}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=cats&source=images')
        );
        expect(res.status).toBe(200);
        const body = await readJson(res);
        expect(body.hasMore).toBe(true);
        expect(body.images.map((img: { title: string; source: string }) => `${img.source}:${img.title}`)).toEqual([
            'google:G1',
            'brave:B1',
            'google:Dup shared',
        ]);
    });

    it('source=images without Google env is Brave-only quietly', async () => {
        process.env["BRAVE_API_KEY"] = 'brave-test';
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    results: [
                        {
                            title: 'Brave only',
                            url: 'https://example.com/page',
                            thumbnail: { src: 'https://example.com/thumb.jpg' },
                            properties: { url: 'https://example.com/full.jpg' },
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=cats&source=images')
        );
        expect(res.status).toBe(200);
        const body = await readJson(res);
        expect(body.images).toEqual([
            expect.objectContaining({ title: 'Brave only', source: 'brave' }),
        ]);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('api.search.brave.com/res/v1/images/search'),
            expect.anything()
        );
        expect(
            fetchMock.mock.calls.every((c) => {
                const u =
                    typeof c[0] === 'string'
                        ? c[0]
                        : c[0] instanceof URL
                          ? c[0].href
                          : c[0] instanceof Request
                            ? c[0].url
                            : '';
                return !u.includes('googleapis.com');
            })
        ).toBe(true);
    });

    it('source=images&imageSource=brave returns images with mocked Brave', async () => {
        process.env["BRAVE_API_KEY"] = 'brave-test';
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    results: [
                        {
                            title: 'Cat',
                            url: 'https://example.com/page',
                            thumbnail: { src: 'https://example.com/thumb.jpg' },
                            properties: {
                                url: 'https://example.com/full.jpg',
                                width: 200,
                                height: 150,
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest(
                'https://example.com/api/search?q=cats&source=images&imageSource=brave'
            )
        );
        expect(res.status).toBe(200);
        const body = await readJson(res);
        expect(body.hasMore).toBe(true);
        expect(body.images).toEqual([
            {
                thumbnail: 'https://example.com/thumb.jpg',
                full: 'https://example.com/full.jpg',
                title: 'Cat',
                sourceUrl: 'https://example.com/page',
                width: 200,
                height: 150,
                source: 'brave',
            },
        ]);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('api.search.brave.com/res/v1/images/search'),
            expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Subscription-Token': 'brave-test',
                }),
            })
        );
    });

    it('aggregate (no source) returns brave+marginalia+wiby+tavily', async () => {
        process.env["BRAVE_API_KEY"] = 'brave-test';
        process.env["TAVILY_API_KEY"] = 'tvly-test';
        const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const u =
                typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.href
                      : input.url;
            if (u.includes('api.search.brave.com')) {
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            web: {
                                results: [
                                    {
                                        title: 'Brave Cat',
                                        url: 'https://brave.example/cat',
                                        description: 'brave snip',
                                        meta_url: { hostname: 'brave.example' },
                                    },
                                ],
                                total: 1,
                            },
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } }
                    )
                );
            }
            if (u.includes('marginalia-search.com')) {
                return Promise.resolve(
                    new Response(JSON.stringify({ results: [], page: 1, pages: 1 }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    })
                );
            }
            if (u.includes('wiby.me')) {
                return Promise.resolve(
                    new Response(JSON.stringify([]), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    })
                );
            }
            if (u.includes('api.tavily.com')) {
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            results: [
                                {
                                    title: 'Tavily Cat',
                                    url: 'https://tavily.example/cat',
                                    content: 'meow',
                                },
                            ],
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } }
                    )
                );
            }
            return Promise.reject(new Error(`unexpected fetch ${u}`));
        });
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=cats&page=1')
        );
        expect(res.status).toBe(200);
        const body = await readJson(res);
        expect(body.brave).toMatchObject({
            results: [expect.objectContaining({ title: 'Brave Cat', source: 'brave' })],
        });
        expect(body.marginalia).toMatchObject({ results: [], hasMore: false });
        expect(body.wiby).toMatchObject({ results: [] });
        expect(body.tavily).toMatchObject({
            results: [
                expect.objectContaining({
                    title: 'Tavily Cat',
                    url: 'https://tavily.example/cat',
                    source: 'tavily',
                }),
            ],
            hasMore: false,
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.tavily.com/search',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer tvly-test',
                }),
            })
        );
    });

    it('source=tavily with no TAVILY_API_KEY returns empty tavily section', async () => {
        delete process.env["TAVILY_API_KEY"];
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=cats&source=tavily')
        );
        expect(res.status).toBe(200);
        const body = await readJson(res);
        expect(body.tavily).toEqual({ results: [], hasMore: false, totalResults: '0' });
        expect(body.brave).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('api/search.ts and api/ai.ts thin handlers', () => {
    it('re-export aggregateEdgeRequest as default.fetch', () => {
        expect(searchHandler.fetch).toBe(aggregateEdgeRequest);
        expect(aiHandler.fetch).toBe(aggregateEdgeRequest);
        expect(searchRuntime).toBe('edge');
        expect(aiRuntime).toBe('edge');
    });
});
