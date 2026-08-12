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
import type { EarlyFetchKey } from './types';

const redirect = vi.mocked(redirectForBang);

/** Mirrors script.ts takeEarlyFetchPromise consumption (not exported from early-client-fetch). */
function takeEarlyFetchPromise(key: EarlyFetchKey, query: string): Promise<Response> | null {
    const early = window.__earlyFetch;
    if (!early || early.query !== query) return null;
    const promise = early[key];
    if (!promise) return null;
    delete early[key];
    if (
        !early.aggregate &&
        !early.google &&
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
        redirect.mockReset();
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
    });

    it('always registers aggregate + google + combined images + infobox', () => {
        window.history.replaceState({}, '', '/?q=hello+world');
        expect(() => bootstrapEarlyFetch()).not.toThrow();

        const early = window.__earlyFetch;
        expect(early).toBeTruthy();
        expect(early!.query).toBe('hello world');
        expect(early!.aggregate).toBeInstanceOf(Promise);
        expect(early!.google).toBeInstanceOf(Promise);
        expect(early!.infobox).toBeInstanceOf(Promise);
        expect(early!.images).toBeInstanceOf(Promise);
        expect(early!.utility).toBeUndefined();

        const paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths).toEqual(
            expect.arrayContaining([
                '/api/search?q=hello%20world&page=1',
                '/api/search?q=hello%20world&page=1&source=google',
                expect.stringContaining('source=infobox'),
                '/api/search?q=hello%20world&source=images&page=1',
            ])
        );
        expect(paths.some((p) => p.includes('imageSource='))).toBe(false);
        expect(paths.some((p) => p.includes('source=brave'))).toBe(false);
        expect(paths.some((p) => p.includes('source=utility'))).toBe(false);
        expect(paths.some((p) => p === '/api/search?q=hello%20world&page=1')).toBe(true);
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
        const paths = searchApiFetch.mock.calls.map((c) => String(c[0]));
        expect(paths).toEqual(
            expect.arrayContaining([
                expect.stringContaining('source=utility&kind=currency'),
            ])
        );
        const utilityPath = paths.find((p) => p.includes('source=utility'));
        expect(utilityPath).toContain('amount=100');
        expect(utilityPath).toContain('from=USD');
        expect(utilityPath).toContain('to=EUR');
    });

    it('registers utility early fetch for translate intent', () => {
        window.history.replaceState({}, '', '/?q=translate+hello+to+french');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch?.utility).toBeInstanceOf(Promise);
        const utilityPath = searchApiFetch.mock.calls
            .map((c) => String(c[0]))
            .find((p) => p.includes('source=utility'));
        expect(utilityPath).toContain('kind=translate');
        expect(utilityPath).toContain('text=hello');
        expect(utilityPath).toContain('to=fr');
    });

    it('registers utility early fetch for timezone intent', () => {
        window.history.replaceState({}, '', '/?q=time+in+japan');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch?.utility).toBeInstanceOf(Promise);
        const utilityPath = searchApiFetch.mock.calls
            .map((c) => String(c[0]))
            .find((p) => p.includes('source=utility'));
        expect(utilityPath).toContain('kind=timezone');
        expect(utilityPath).toContain('country=jp');
    });

    it('skips utility network for empty language keyword', () => {
        window.history.replaceState({}, '', '/?q=language');
        bootstrapEarlyFetch();
        expect(window.__earlyFetch?.utility).toBeUndefined();
        expect(
            searchApiFetch.mock.calls.map((c) => String(c[0])).some((p) => p.includes('source=utility'))
        ).toBe(false);
    });

    it('skips utility network for empty currency keyword', () => {
        window.history.replaceState({}, '', '/?q=currency');
        bootstrapEarlyFetch();
        expect(window.__earlyFetch?.utility).toBeUndefined();
        expect(
            searchApiFetch.mock.calls.map((c) => String(c[0])).some((p) => p.includes('source=utility'))
        ).toBe(false);
    });

    it('registers utility early fetch for empty timezone keyword (locale default)', () => {
        window.history.replaceState({}, '', '/?q=timezone');
        bootstrapEarlyFetch();

        expect(window.__earlyFetch?.utility).toBeInstanceOf(Promise);
        const utilityPath = searchApiFetch.mock.calls
            .map((c) => String(c[0]))
            .find((p) => p.includes('source=utility'));
        expect(utilityPath).toContain('kind=timezone');
        expect(utilityPath).toContain('country=us');
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

        void takeEarlyFetchPromise('google', 'cats');
        void takeEarlyFetchPromise('images', 'cats');
        void takeEarlyFetchPromise('infobox', 'cats');
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
