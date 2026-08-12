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
