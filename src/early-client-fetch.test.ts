import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchApiFetch = vi.fn();

vi.mock('./search-fetch', () => ({
    searchApiFetch: (...args: unknown[]) => searchApiFetch(...args),
}));

vi.mock('./api-keys', () => ({
    hasGoogleSearchConfigured: vi.fn(() => false),
}));

vi.mock('./query-bangs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./query-bangs')>();
    return {
        ...actual,
        redirectForBang: vi.fn(),
    };
});

import { hasGoogleSearchConfigured } from './api-keys';
import { bootstrapEarlyFetch } from './early-client-fetch';
import { redirectForBang } from './query-bangs';

const hasGoogle = vi.mocked(hasGoogleSearchConfigured);
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
        hasGoogle.mockReturnValue(false);
        redirect.mockReset();
        delete window.__earlyFetch;
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        delete window.__earlyFetch;
        window.history.replaceState({}, '', '/');
    });

    it('no-ops without ?q=', () => {
        expect(() => bootstrapEarlyFetch()).not.toThrow();
        expect(window.__earlyFetch).toBeUndefined();
        expect(searchApiFetch).not.toHaveBeenCalled();
    });

    it('registers aggregate + infobox + brave images early promises for ?q= without Google', () => {
        window.history.replaceState({}, '', '/?q=hello+world');
        expect(() => bootstrapEarlyFetch()).not.toThrow();

        const early = window.__earlyFetch;
        expect(early).toBeTruthy();
        expect(early!.query).toBe('hello world');
        expect(early!.aggregate).toBeInstanceOf(Promise);
        expect(early!.infobox).toBeInstanceOf(Promise);
        expect(early!.images).toBeInstanceOf(Promise);
        expect(early!.google).toBeUndefined();

        const paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths).toEqual(
            expect.arrayContaining([
                '/api/search?q=hello%20world&page=1',
                expect.stringContaining('source=infobox'),
                '/api/search?q=hello%20world&source=images&imageSource=brave&page=1',
            ])
        );
        expect(paths.some((p) => p.includes('source=brave'))).toBe(false);
        expect(paths.some((p) => p.includes('source=marginalia'))).toBe(false);
        expect(paths.some((p) => p.includes('source=wiby'))).toBe(false);
        expect(paths.some((p) => p.includes('source=tavily'))).toBe(false);
        expect(paths.some((p) => p.includes('source=google'))).toBe(false);
        // Aggregate path must not include a source= param
        expect(paths.some((p) => p === '/api/search?q=hello%20world&page=1')).toBe(true);
    });

    it('adds google + combined images early fetches when Google configured', () => {
        hasGoogle.mockReturnValue(true);
        window.history.replaceState({}, '', '/?q=cats');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch!.google).toBeInstanceOf(Promise);
        expect(window.__earlyFetch!.images).toBeInstanceOf(Promise);
        expect(window.__earlyFetch!.aggregate).toBeInstanceOf(Promise);
        const paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths.some((p) => p.includes('source=google'))).toBe(true);
        expect(paths).toContain('/api/search?q=cats&source=images&page=1');
        expect(paths.some((p) => p.includes('imageSource=google'))).toBe(false);
        expect(paths.some((p) => p.includes('imageSource=brave'))).toBe(false);
    });

    it('bang redirect does not register __earlyFetch', () => {
        window.history.replaceState({}, '', '/?q=!g+cats');
        bootstrapEarlyFetch();
        expect(redirect).toHaveBeenCalledWith('!g cats');
        expect(window.__earlyFetch).toBeUndefined();
        expect(searchApiFetch).not.toHaveBeenCalled();
    });

    it('takeEarlyFetch-style consumption returns aggregate promise once then clears', async () => {
        window.history.replaceState({}, '', '/?q=cats');
        bootstrapEarlyFetch();

        const first = takeEarlyFetchPromise('aggregate', 'cats');
        expect(first).toBeInstanceOf(Promise);
        const res = await first!;
        expect(await res.json()).toMatchObject({ path: '/api/search?q=cats&page=1' });

        expect(takeEarlyFetchPromise('aggregate', 'cats')).toBeNull();
        expect(takeEarlyFetchPromise('aggregate', 'other')).toBeNull();

        void takeEarlyFetchPromise('images', 'cats');
        void takeEarlyFetchPromise('infobox', 'cats');
        expect(window.__earlyFetch).toBeUndefined();
    });
});
