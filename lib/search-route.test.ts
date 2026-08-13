import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateEdgeRequest } from './search-route';
import searchHandler, { runtime as searchRuntime } from '../api/search';
import aiHandler, { runtime as aiRuntime } from '../api/ai';

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

    it('source=utility&kind=currency proxies Frankfurter (mocked)', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            expect(url).toContain('api.frankfurter.dev/v1/latest');
            return new Response(
                JSON.stringify({
                    amount: 100,
                    base: 'USD',
                    date: '2026-08-12',
                    rates: { EUR: 86.62 },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        });
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest(
                'https://example.com/api/search?q=100+usd+to+eur&source=utility&kind=currency&amount=100&from=USD&to=EUR'
            )
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json');
        await expect(readJson(res)).resolves.toEqual({
            ok: true,
            kind: 'currency',
            amount: 100,
            from: 'USD',
            to: 'EUR',
            converted: 86.62,
            rate: 0.8662,
        });
        expect(fetchMock).toHaveBeenCalled();
    });

    it('source=utility&kind=currency returns error + examples when provider fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('down', { status: 502 }))
        );

        const res = await aggregateEdgeRequest(
            jsonRequest(
                'https://example.com/api/search?q=100+usd+to+eur&source=utility&kind=currency&amount=100&from=USD&to=EUR'
            )
        );
        const body = await readJson(res);
        expect(body).toMatchObject({
            ok: false,
            kind: 'currency',
            examples: ['100 usd to eur', '5 eur to usd'],
        });
        expect(String((body as { error: string }).error)).toContain('502');
    });

    it('source=utility omits kind when kind param is missing or invalid', async () => {
        vi.stubGlobal('fetch', vi.fn());

        const missing = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=utility&source=utility')
        );
        await expect(readJson(missing)).resolves.toEqual({
            ok: false,
            error: 'not_implemented',
            examples: ['100 usd to eur', 'translate hello to french'],
        });

        const invalid = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=utility&source=utility&kind=crypto')
        );
        await expect(readJson(invalid)).resolves.toEqual({
            ok: false,
            error: 'not_implemented',
            examples: ['100 usd to eur', 'translate hello to french'],
        });
    });

    it('source=utility&kind=translate proxies MyMemory and returns success JSON', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            expect(url).toContain('api.mymemory.translated.net/get');
            expect(url).toContain('q=hello');
            return new Response(
                JSON.stringify({
                    responseData: { translatedText: 'bonjour', match: 1 },
                    responseStatus: 200,
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        });
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest(
                'https://example.com/api/search?q=hello&source=utility&kind=translate&text=hello&from=en&to=fr'
            )
        );
        expect(res.status).toBe(200);
        await expect(readJson(res)).resolves.toEqual({
            ok: true,
            kind: 'translate',
            text: 'hello',
            from: 'en',
            to: 'fr',
            translatedText: 'bonjour',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('source=utility&kind=translate maps MyMemory failure to error + examples', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('nope', { status: 503 }))
        );

        const res = await aggregateEdgeRequest(
            jsonRequest(
                'https://example.com/api/search?q=hello&source=utility&kind=translate&text=hello&from=en&to=fr'
            )
        );
        const body = await readJson(res);
        expect(body).toMatchObject({
            ok: false,
            kind: 'translate',
        });
        expect(body.error).toContain('503');
        expect(body.examples).toEqual([
            'translate hello to french',
            'how do you say goodbye in german',
        ]);
    });

    it('source=utility&kind=timezone returns local times without upstream fetch', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const res = await aggregateEdgeRequest(
            jsonRequest(
                'https://example.com/api/search?q=time+in+japan&source=utility&kind=timezone&country=jp'
            )
        );
        expect(res.status).toBe(200);
        const body = await readJson(res);
        expect(body).toMatchObject({
            ok: true,
            kind: 'timezone',
            country: 'jp',
        });
        expect(Array.isArray(body.zones)).toBe(true);
        expect(body.zones).toHaveLength(1);
        expect(body.zones[0]).toMatchObject({
            id: 'Asia/Tokyo',
            label: 'Japan',
        });
        expect(typeof body.zones[0].localTime).toBe('string');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('source=utility&kind=timezone returns multi-zone rows for us', async () => {
        vi.stubGlobal('fetch', vi.fn());

        const res = await aggregateEdgeRequest(
            jsonRequest(
                'https://example.com/api/search?q=usa&source=utility&kind=timezone&country=us'
            )
        );
        const body = await readJson(res);
        expect(body.ok).toBe(true);
        expect(body.zones.length).toBeGreaterThanOrEqual(4);
    });

    it('source=utility&kind=timezone errors when country missing', async () => {
        vi.stubGlobal('fetch', vi.fn());

        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=timezone&source=utility&kind=timezone')
        );
        await expect(readJson(res)).resolves.toMatchObject({
            ok: false,
            kind: 'timezone',
            error: 'Country is required.',
            examples: ['time in japan', 'time in usa'],
        });
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

    it('source=images without imageSource → 400 (browser-handled)', async () => {
        const res = await aggregateEdgeRequest(
            jsonRequest('https://example.com/api/search?q=cats&source=images')
        );
        expect(res.status).toBe(400);
        await expect(readJson(res)).resolves.toEqual({
            error: 'Google and combined image search are handled in the browser',
        });
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
});

describe('api/search.ts and api/ai.ts thin handlers', () => {
    it('re-export aggregateEdgeRequest as default.fetch', () => {
        expect(searchHandler.fetch).toBe(aggregateEdgeRequest);
        expect(aiHandler.fetch).toBe(aggregateEdgeRequest);
        expect(searchRuntime).toBe('edge');
        expect(aiRuntime).toBe('edge');
    });
});
