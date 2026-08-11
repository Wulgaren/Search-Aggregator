import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-keys', () => ({
    getApiSecret: vi.fn(),
}));

import { getApiSecret } from './api-keys';
import {
    handleTavilySearchRequest,
    isTavilyClientSearchUrl,
    primeTavilyConnection,
} from './tavily-search';

const getSecret = vi.mocked(getApiSecret);

describe('isTavilyClientSearchUrl', () => {
    it('matches only source=tavily on /api/search', () => {
        expect(
            isTavilyClientSearchUrl(new URL('https://example.test/api/search?q=a&source=tavily'))
        ).toBe(true);
        expect(
            isTavilyClientSearchUrl(new URL('https://example.test/api/search?q=a&source=brave'))
        ).toBe(false);
        expect(isTavilyClientSearchUrl(new URL('https://example.test/api/ai'))).toBe(false);
    });
});

describe('primeTavilyConnection', () => {
    beforeEach(() => {
        document.head.querySelectorAll('link[data-tavily-preconnect]').forEach((el) => el.remove());
    });

    afterEach(() => {
        document.head.querySelectorAll('link[data-tavily-preconnect]').forEach((el) => el.remove());
    });

    it('injects dns-prefetch and preconnect once', () => {
        primeTavilyConnection();
        primeTavilyConnection();
        const links = [...document.head.querySelectorAll('link[data-tavily-preconnect]')];
        expect(links).toHaveLength(2);
        expect(links.map((l) => (l as HTMLLinkElement).rel).sort()).toEqual([
            'dns-prefetch',
            'preconnect',
        ]);
        expect(links.every((l) => (l as HTMLLinkElement).href === 'https://api.tavily.com/')).toBe(
            true
        );
    });
});

describe('handleTavilySearchRequest', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        getSecret.mockReset();
        getSecret.mockReturnValue('tvly-test-key');
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns empty payload when API key missing', async () => {
        getSecret.mockReturnValue('');
        const res = await handleTavilySearchRequest(
            new Request('https://example.test/api/search?q=cats&source=tavily&page=1')
        );
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await res.json()).toEqual({
            page: 1,
            tavily: { results: [], hasMore: false, totalResults: '0' },
        });
    });

    it('POSTs basic search to Tavily and maps results', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    results: [
                        {
                            title: 'Cat Facts',
                            url: 'https://example.com/cats',
                            content: 'Cats are soft.',
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );

        const res = await handleTavilySearchRequest(
            new Request('https://example.test/api/search?q=cats&source=tavily&page=1')
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe('https://api.tavily.com/search');
        expect(init).toMatchObject({
            method: 'POST',
            headers: expect.objectContaining({
                Authorization: 'Bearer tvly-test-key',
            }),
        });
        const body = JSON.parse(String(init!.body));
        expect(body).toMatchObject({
            query: 'cats',
            search_depth: 'fast',
            include_answer: false,
            max_results: 10,
        });

        expect(await res.json()).toEqual({
            page: 1,
            tavily: {
                results: [
                    {
                        title: 'Cat Facts',
                        url: 'https://example.com/cats',
                        displayUrl: 'example.com',
                        snippet: 'Cats are soft.',
                        source: 'tavily',
                    },
                ],
                hasMore: false,
                totalResults: '1',
            },
        });
    });

    it('page > 1 returns empty without calling Tavily', async () => {
        const res = await handleTavilySearchRequest(
            new Request('https://example.test/api/search?q=cats&source=tavily&page=2')
        );
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await res.json()).toEqual({
            page: 2,
            tavily: { results: [], hasMore: false, totalResults: '0' },
        });
    });

    it('surfaces API errors on the tavily payload', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ detail: { error: 'Invalid API key' } }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        const res = await handleTavilySearchRequest(
            new Request('https://example.test/api/search?q=cats&source=tavily&page=1')
        );
        expect(res.ok).toBe(true);
        expect(await res.json()).toEqual({
            page: 1,
            tavily: { error: 'Invalid API key', results: [], hasMore: false },
        });
    });
});
