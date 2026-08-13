import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchApiFetch = vi.fn();

vi.mock('./search-fetch', () => ({
    searchApiFetch: (...args: unknown[]) => searchApiFetch(...args),
}));

vi.mock('./query-bangs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./query-bangs')>();
    return {
        ...actual,
        redirectForBang: vi.fn(),
    };
});

import { bootstrapEarlyFetch } from './early-client-fetch';
import { redirectForBang } from './query-bangs';

const redirect = vi.mocked(redirectForBang);

type EarlyKey = 'aggregate' | 'google' | 'images' | 'infobox';

/** Mirrors script.ts takeEarlyFetchPromise consumption (not exported from early-client-fetch). */
function takeEarlyFetchPromise(key: EarlyKey, query: string): Promise<Response> | null {
    const early = window.__earlyFetch;
    if (!early || early.query !== query) return null;
    const promise = early[key];
    if (!promise) return null;
    delete early[key];
    if (!early.aggregate && !early.google && !early.images && !early.infobox) {
        delete window.__earlyFetch;
    }
    return promise;
}

describe('bootstrapEarlyFetch', () => {
    beforeEach(() => {
        searchApiFetch.mockReset();
        searchApiFetch.mockImplementation(async (path: string) =>
            new Response(JSON.stringify({ path }), {
                headers: { 'Content-Type': 'application/json' },
            })
        );
        redirect.mockReset();
        delete window.__earlyFetch;
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        vi.useRealTimers();
        delete window.__earlyFetch;
        window.history.replaceState({}, '', '/');
    });

    it('no-ops without ?q=', () => {
        expect(() => bootstrapEarlyFetch()).not.toThrow();
        expect(window.__earlyFetch).toBeUndefined();
        expect(searchApiFetch).not.toHaveBeenCalled();
    });

    it('always registers aggregate + google + combined images + infobox', async () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/?q=hello+world');
        expect(() => bootstrapEarlyFetch()).not.toThrow();

        const early = window.__earlyFetch;
        expect(early).toBeTruthy();
        expect(early!.query).toBe('hello world');
        expect(early!.aggregate).toBeInstanceOf(Promise);
        expect(early!.google).toBeInstanceOf(Promise);
        expect(early!.infobox).toBeInstanceOf(Promise);
        expect(early!.images).toBeInstanceOf(Promise);

        let paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths).toEqual(
            expect.arrayContaining([
                '/api/search?q=hello%20world&page=1',
                '/api/search?q=hello%20world&page=1&source=google',
                expect.stringContaining('source=infobox'),
            ])
        );
        expect(paths.some((p) => p.includes('source=images'))).toBe(false);

        await vi.advanceTimersByTimeAsync(1000);
        paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths).toContain('/api/search?q=hello%20world&source=images&page=1');
        expect(paths.some((p) => p.includes('imageSource='))).toBe(false);
        expect(paths.some((p) => p.includes('source=brave'))).toBe(false);
        expect(paths.some((p) => p === '/api/search?q=hello%20world&page=1')).toBe(true);
        vi.useRealTimers();
    });

    it('bang redirect does not register __earlyFetch', () => {
        window.history.replaceState({}, '', '/?q=!g+cats');
        bootstrapEarlyFetch();
        expect(redirect).toHaveBeenCalledWith('!g cats');
        expect(window.__earlyFetch).toBeUndefined();
        expect(searchApiFetch).not.toHaveBeenCalled();
    });

    it('takeEarlyFetch-style consumption returns aggregate promise once then clears', async () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/?q=cats');
        bootstrapEarlyFetch();

        const first = takeEarlyFetchPromise('aggregate', 'cats');
        expect(first).toBeInstanceOf(Promise);
        const res = await first!;
        expect(await res.json()).toMatchObject({ path: '/api/search?q=cats&page=1' });

        expect(takeEarlyFetchPromise('aggregate', 'cats')).toBeNull();
        expect(takeEarlyFetchPromise('aggregate', 'other')).toBeNull();

        void takeEarlyFetchPromise('google', 'cats');
        const imagesPromise = takeEarlyFetchPromise('images', 'cats');
        void takeEarlyFetchPromise('infobox', 'cats');
        expect(window.__earlyFetch).toBeUndefined();

        await vi.advanceTimersByTimeAsync(1000);
        expect(imagesPromise).toBeInstanceOf(Promise);
        await imagesPromise;
        vi.useRealTimers();
    });

    it('delays images early fetch by 1000ms', async () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/?q=delay');
        bootstrapEarlyFetch();

        expect(searchApiFetch.mock.calls.some((c) => String(c[0]).includes('source=images'))).toBe(false);

        await vi.advanceTimersByTimeAsync(999);
        expect(searchApiFetch.mock.calls.some((c) => String(c[0]).includes('source=images'))).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(searchApiFetch.mock.calls.some((c) => String(c[0]).includes('source=images'))).toBe(true);
        vi.useRealTimers();
    });
});
