import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchApiFetch = vi.fn();

vi.mock('./search-fetch', () => ({
    searchApiFetch: (...args: unknown[]) => searchApiFetch(...args),
}));

vi.mock('./api-keys', () => ({
    hasGoogleSearchConfigured: vi.fn(() => false),
    hasTavilySearchConfigured: vi.fn(() => false),
}));

vi.mock('./tavily-search', () => ({
    primeTavilyConnection: vi.fn(),
}));

vi.mock('./query-bangs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./query-bangs')>();
    return {
        ...actual,
        redirectForBang: vi.fn(),
    };
});

import { hasGoogleSearchConfigured, hasTavilySearchConfigured } from './api-keys';
import { bootstrapEarlyFetch } from './early-client-fetch';
import { redirectForBang } from './query-bangs';
import { primeTavilyConnection } from './tavily-search';

const hasGoogle = vi.mocked(hasGoogleSearchConfigured);
const hasTavily = vi.mocked(hasTavilySearchConfigured);
const redirect = vi.mocked(redirectForBang);
const primeTavily = vi.mocked(primeTavilyConnection);

type EarlyKey = 'brave' | 'google' | 'tavily' | 'marginalia' | 'wiby' | 'images' | 'infobox';

/** Mirrors script.ts takeEarlyFetchPromise consumption (not exported from early-client-fetch). */
function takeEarlyFetchPromise(key: EarlyKey, query: string): Promise<Response> | null {
    const early = window.__earlyFetch;
    if (!early || early.query !== query) return null;
    const promise = early[key];
    if (!promise) return null;
    delete early[key];
    if (
        !early.brave &&
        !early.google &&
        !early.tavily &&
        !early.marginalia &&
        !early.wiby &&
        !early.images &&
        !early.infobox
    ) {
        window.__earlyFetch = undefined;
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
        hasTavily.mockReturnValue(false);
        redirect.mockReset();
        primeTavily.mockReset();
        window.__earlyFetch = undefined;
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        window.__earlyFetch = undefined;
        window.history.replaceState({}, '', '/');
    });

    it('no-ops without ?q=', () => {
        expect(() => bootstrapEarlyFetch()).not.toThrow();
        expect(window.__earlyFetch).toBeUndefined();
        expect(searchApiFetch).not.toHaveBeenCalled();
        expect(primeTavily).not.toHaveBeenCalled();
    });

    it('primes Tavily connection on homepage when key configured', () => {
        hasTavily.mockReturnValue(true);
        bootstrapEarlyFetch();
        expect(primeTavily).toHaveBeenCalledTimes(1);
        expect(window.__earlyFetch).toBeUndefined();
        expect(searchApiFetch).not.toHaveBeenCalled();
    });

    it('registers early promises for ?q= without throwing', () => {
        window.history.replaceState({}, '', '/?q=hello+world');
        expect(() => bootstrapEarlyFetch()).not.toThrow();

        const early = window.__earlyFetch;
        expect(early).toBeTruthy();
        expect(early!.query).toBe('hello world');
        expect(early!.brave).toBeInstanceOf(Promise);
        expect(early!.marginalia).toBeInstanceOf(Promise);
        expect(early!.wiby).toBeInstanceOf(Promise);
        expect(early!.infobox).toBeInstanceOf(Promise);
        expect(early!.google).toBeUndefined();
        expect(early!.tavily).toBeUndefined();
        expect(early!.images).toBeUndefined();

        const paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths).toEqual(
            expect.arrayContaining([
                expect.stringContaining('source=brave'),
                expect.stringContaining('source=marginalia'),
                expect.stringContaining('source=wiby'),
                expect.stringContaining('source=infobox'),
            ])
        );
        expect(paths.some((p) => p.includes('source=google'))).toBe(false);
        expect(paths.some((p) => p.includes('source=tavily'))).toBe(false);
    });

    it('adds google + images early fetches when Google configured', () => {
        hasGoogle.mockReturnValue(true);
        window.history.replaceState({}, '', '/?q=cats');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch!.google).toBeInstanceOf(Promise);
        expect(window.__earlyFetch!.images).toBeInstanceOf(Promise);
        const paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths.some((p) => p.includes('source=google'))).toBe(true);
        expect(paths.some((p) => p.includes('imageSource=google'))).toBe(true);
    });

    it('adds tavily early fetch when Tavily configured', () => {
        hasTavily.mockReturnValue(true);
        window.history.replaceState({}, '', '/?q=cats');
        bootstrapEarlyFetch();

        expect(primeTavily).toHaveBeenCalledTimes(1);
        expect(window.__earlyFetch!.tavily).toBeInstanceOf(Promise);
        const paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths.some((p) => p.includes('source=tavily'))).toBe(true);
    });

    it('bang redirect does not register __earlyFetch', () => {
        window.history.replaceState({}, '', '/?q=!g+cats');
        bootstrapEarlyFetch();
        expect(redirect).toHaveBeenCalledWith('!g cats');
        expect(window.__earlyFetch).toBeUndefined();
        expect(searchApiFetch).not.toHaveBeenCalled();
    });

    it('takeEarlyFetch-style consumption returns promise once then clears', async () => {
        window.history.replaceState({}, '', '/?q=cats');
        bootstrapEarlyFetch();

        const first = takeEarlyFetchPromise('brave', 'cats');
        expect(first).toBeInstanceOf(Promise);
        const res = await first!;
        expect(await res.json()).toMatchObject({ path: expect.stringContaining('source=brave') });

        expect(takeEarlyFetchPromise('brave', 'cats')).toBeNull();
        expect(takeEarlyFetchPromise('brave', 'other')).toBeNull();

        // drain remaining keys
        for (const key of ['marginalia', 'wiby', 'infobox'] as const) {
            takeEarlyFetchPromise(key, 'cats');
        }
        expect(window.__earlyFetch).toBeUndefined();
    });
});
