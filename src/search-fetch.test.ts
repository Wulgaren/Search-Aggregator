import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./google-search', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./google-search')>();
    return {
        ...actual,
        createCachedGoogleSearchGet: (handler: (request: Request) => Promise<Response>) => {
            return async (path: string) => {
                const url = new URL(path, window.location.origin);
                if (!actual.isGoogleClientSearchUrl(url)) {
                    return handler(new Request(url.toString()));
                }
                return new Response(JSON.stringify({ via: 'cached-google', path }), {
                    headers: { 'Content-Type': 'application/json' },
                });
            };
        },
    };
});

import { searchApiFetch } from './search-fetch';

describe('searchApiFetch', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(new Response('edge', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('routes Google web /api/search GET through cached client handler (not edge fetch)', async () => {
        const res = await searchApiFetch('/api/search?q=cats&source=google&page=1');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await res.json()).toEqual({
            via: 'cached-google',
            path: '/api/search?q=cats&source=google&page=1',
        });
    });

    it('routes images+google /api/search GET through cached client handler', async () => {
        const res = await searchApiFetch(
            '/api/search?q=cats&source=images&imageSource=google&page=1'
        );
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await res.json()).toMatchObject({ via: 'cached-google' });
    });

    it('routes images without imageSource through cached client handler', async () => {
        const res = await searchApiFetch('/api/search?q=cats&source=images&page=1');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await res.json()).toMatchObject({ via: 'cached-google' });
    });

    it('misses cache path: non-Google /api/search GET uses window fetch', async () => {
        const res = await searchApiFetch('/api/search?q=cats&source=brave&page=1');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/search?q=cats&source=brave');
        expect(await res.text()).toBe('edge');
    });

    it('non-cacheable: non-GET /api/search passes init to fetch', async () => {
        await searchApiFetch('/api/search?q=cats&source=google', { method: 'POST', body: '{}' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0]!;
        expect(init).toMatchObject({ method: 'POST' });
    });

    it('non-cacheable: non-/api/search paths use fetch with init', async () => {
        await searchApiFetch('/api/ai', { method: 'POST', body: '{}' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/ai');
        expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
    });
});
