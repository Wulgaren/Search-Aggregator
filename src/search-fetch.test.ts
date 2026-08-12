import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    it('routes Google web /api/search GET through edge fetch', async () => {
        const res = await searchApiFetch('/api/search?q=cats&source=google&page=1');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/search?q=cats&source=google');
        expect(await res.text()).toBe('edge');
    });

    it('routes Tavily /api/search GET through edge fetch', async () => {
        const res = await searchApiFetch('/api/search?q=cats&source=tavily&page=1');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/search?q=cats&source=tavily');
        expect(await res.text()).toBe('edge');
    });

    it('routes combined images /api/search GET through edge fetch', async () => {
        const res = await searchApiFetch('/api/search?q=cats&source=images&page=1');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/search?q=cats&source=images');
        expect(await res.text()).toBe('edge');
    });

    it('passes abort signal to edge fetch', async () => {
        const controller = new AbortController();
        await searchApiFetch('/api/search?q=cats&source=brave&page=1', { signal: controller.signal });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
    });

    it('non-GET /api/search passes init to fetch', async () => {
        await searchApiFetch('/api/search?q=cats&source=google', { method: 'POST', body: '{}' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0]!;
        expect(init).toMatchObject({ method: 'POST' });
    });

    it('non-/api/search paths use fetch with init', async () => {
        await searchApiFetch('/api/ai', { method: 'POST', body: '{}' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/ai');
        expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
    });
});
