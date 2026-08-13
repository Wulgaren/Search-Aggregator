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
import type { EarlyFetchKey } from './types';

const hasGoogle = vi.mocked(hasGoogleSearchConfigured);
const hasTavily = vi.mocked(hasTavilySearchConfigured);
const redirect = vi.mocked(redirectForBang);
const primeTavily = vi.mocked(primeTavilyConnection);

/** Mirrors script.ts takeEarlyFetchPromise consumption (not exported from early-client-fetch). */
function takeEarlyFetchPromise(key: EarlyFetchKey, query: string): Promise<Response> | null {
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
        !early.infobox &&
        !early.utility
    ) {
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
        hasTavily.mockReturnValue(false);
        redirect.mockReset();
        primeTavily.mockReset();
        delete window.__earlyFetch;
        window.history.replaceState({}, '', '/');
        Object.defineProperty(window.navigator, 'language', {
            configurable: true,
            get: () => 'en-US',
        });
    });

    afterEach(() => {
        delete window.__earlyFetch;
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
        expect(early!.utility).toBeUndefined();

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
        expect(paths.some((p) => p.includes('source=utility'))).toBe(false);
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

    it('skips utility early fetch for non-intent queries', () => {
        window.history.replaceState({}, '', '/?q=cats');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch?.utility).toBeUndefined();
        const paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths.some((p) => p.includes('source=utility'))).toBe(false);
        expect(paths).toHaveLength(4);
    });

    it('registers utility early fetch for currency intent', () => {
        window.history.replaceState({}, '', '/?q=100+usd+to+eur');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch?.utility).toBeInstanceOf(Promise);
        expect(window.__earlyFetch?.brave).toBeUndefined();
        expect(window.__earlyFetch?.marginalia).toBeUndefined();
        expect(window.__earlyFetch?.infobox).toBeUndefined();
        const paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths).toHaveLength(1);
        expect(paths[0]).toContain('source=utility&kind=currency');
        expect(paths[0]).toContain('amount=100');
        expect(paths[0]).toContain('from=USD');
        expect(paths[0]).toContain('to=EUR');
    });

    it('registers utility early fetch for translate intent', () => {
        window.history.replaceState({}, '', '/?q=translate+hello+to+french');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch?.utility).toBeInstanceOf(Promise);
        expect(window.__earlyFetch?.brave).toBeUndefined();
        const utilityPath = searchApiFetch.mock.calls
            .map((c) => String(c[0]))
            .find((p) => p.includes('source=utility'));
        expect(utilityPath).toContain('kind=translate');
        expect(utilityPath).toContain('text=hello');
        expect(utilityPath).toContain('to=fr');
        expect(searchApiFetch).toHaveBeenCalledTimes(1);
    });

    it('registers utility early fetch for TEXT in LANG translate', () => {
        window.history.replaceState({}, '', '/?q=prawns+in+polish');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch?.utility).toBeInstanceOf(Promise);
        const utilityPath = searchApiFetch.mock.calls
            .map((c) => String(c[0]))
            .find((p) => p.includes('source=utility'));
        expect(utilityPath).toContain('kind=translate');
        expect(utilityPath).toContain('text=prawns');
        expect(utilityPath).toContain('to=pl');
        expect(utilityPath).toContain('from=en');
        expect(searchApiFetch).toHaveBeenCalledTimes(1);
    });

    it('registers utility early fetch for timezone intent', () => {
        window.history.replaceState({}, '', '/?q=time+in+japan');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch?.utility).toBeInstanceOf(Promise);
        expect(window.__earlyFetch?.brave).toBeUndefined();
        const utilityPath = searchApiFetch.mock.calls
            .map((c) => String(c[0]))
            .find((p) => p.includes('source=utility'));
        expect(utilityPath).toContain('kind=timezone');
        expect(utilityPath).toContain('country=jp');
        expect(searchApiFetch).toHaveBeenCalledTimes(1);
    });

    it('skips utility network for empty language keyword', () => {
        window.history.replaceState({}, '', '/?q=language');
        bootstrapEarlyFetch();
        expect(window.__earlyFetch?.query).toBe('language');
        expect(window.__earlyFetch?.utility).toBeUndefined();
        expect(window.__earlyFetch?.brave).toBeUndefined();
        expect(searchApiFetch).not.toHaveBeenCalled();
    });

    it('skips utility network for empty currency keyword', () => {
        window.history.replaceState({}, '', '/?q=currency');
        bootstrapEarlyFetch();
        expect(window.__earlyFetch?.query).toBe('currency');
        expect(window.__earlyFetch?.utility).toBeUndefined();
        expect(searchApiFetch).not.toHaveBeenCalled();
    });

    it('registers utility early fetch for empty timezone keyword (locale default)', () => {
        window.history.replaceState({}, '', '/?q=timezone');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch?.utility).toBeInstanceOf(Promise);
        expect(window.__earlyFetch?.brave).toBeUndefined();
        const utilityPath = searchApiFetch.mock.calls
            .map((c) => String(c[0]))
            .find((p) => p.includes('source=utility'));
        expect(utilityPath).toContain('kind=timezone');
        expect(utilityPath).toContain('country=us');
        expect(searchApiFetch).toHaveBeenCalledTimes(1);
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
            void takeEarlyFetchPromise(key, 'cats');
        }
        expect(window.__earlyFetch).toBeUndefined();
    });

    it('takeEarlyFetch-style consumption returns utility promise once', async () => {
        window.history.replaceState({}, '', '/?q=100+usd+to+eur');
        bootstrapEarlyFetch();

        const first = takeEarlyFetchPromise('utility', '100 usd to eur');
        expect(first).toBeInstanceOf(Promise);
        const res = await first!;
        const body = await res.json();
        expect(body.path).toContain('source=utility&kind=currency');

        expect(takeEarlyFetchPromise('utility', '100 usd to eur')).toBeNull();
    });
});
