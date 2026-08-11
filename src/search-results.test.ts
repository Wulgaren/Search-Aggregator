import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSearchResultsComponent } from './search-results';
import type { SearchApiResponse, SearchDeps, SearchResult, SearchResultsElements, SourcePayload } from './types';

vi.mock('./query-bangs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./query-bangs')>();
    return {
        ...actual,
        redirectToGoogleSearch: vi.fn(),
    };
});

import { redirectToGoogleSearch } from './query-bangs';

class StubIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }
}

function makeResult(partial: Partial<SearchResult> & Pick<SearchResult, 'url' | 'title'>): SearchResult {
    return {
        snippet: 'A snippet',
        displayUrl: partial.url.replace(/^https?:\/\//, ''),
        ...partial,
    };
}

function sourcePayload(partial: Partial<SourcePayload> = {}): SourcePayload {
    return {
        hasMore: false,
        results: [],
        ...partial,
    };
}

function jsonResponse(body: SearchApiResponse, ok = true, status = ok ? 200 : 500): Response {
    return {
        ok,
        status,
        json: async () => body,
    } as Response;
}

function makeElements(): SearchResultsElements {
    return {
        commercialResults: document.createElement('div'),
        noncommercialResults: document.createElement('div'),
        mergedResults: document.createElement('div'),
        commercialCount: document.createElement('span'),
        noncommercialCount: document.createElement('span'),
    };
}

function makeDeps(overrides: Partial<SearchDeps> = {}): SearchDeps {
    return {
        apiFetch: vi.fn(async () => jsonResponse({})),
        takeEarlyFetch: vi.fn(async () => null),
        isMergedView: vi.fn(() => false),
        hasGoogleSearchConfigured: vi.fn(() => true),
        hasTavilySearchConfigured: vi.fn(() => false),
        openApiSettingsDialog: vi.fn(),
        onGoogleCorrection: vi.fn(),
        ...overrides,
    };
}

function apiFetchBySource(
    handlers: Partial<
        Record<'brave' | 'google' | 'tavily' | 'marginalia' | 'wiby', () => Response | Promise<Response>>
    >
) {
    return vi.fn(async (path: string) => {
        const source = new URL(path, 'https://example.test').searchParams.get('source') as
            | 'brave'
            | 'google'
            | 'tavily'
            | 'marginalia'
            | 'wiby'
            | null;
        const handler = source ? handlers[source] : undefined;
        if (!handler) return jsonResponse({});
        return handler();
    });
}

describe('createSearchResultsComponent', () => {
    let elements: SearchResultsElements;
    let deps: SearchDeps;

    beforeEach(() => {
        vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
        elements = makeElements();
        deps = makeDeps();
        document.body.replaceChildren(
            elements.commercialResults,
            elements.noncommercialResults,
            elements.mergedResults,
            elements.commercialCount,
            elements.noncommercialCount
        );
        vi.mocked(redirectToGoogleSearch).mockClear();
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.replaceChildren();
        delete window.scrollObservers;
        delete window.sentinels;
    });

    it('startSearch shows skeleton items in all result containers', () => {
        const never = new Promise<Response>(() => {});
        deps.apiFetch = vi.fn(() => never);
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);

        component.startSearch('cats');

        expect(elements.commercialResults.querySelectorAll('.skeleton-item')).toHaveLength(5);
        expect(elements.noncommercialResults.querySelectorAll('.skeleton-item')).toHaveLength(5);
        expect(elements.mergedResults.querySelectorAll('.skeleton-item')).toHaveLength(5);
        expect(component.getCurrentQuery()).toBe('cats');
    });

    it('startSearch fetches brave, marginalia, and wiby via apiFetch when no early fetch', async () => {
        deps.hasGoogleSearchConfigured = vi.fn(() => false);
        const apiFetch = apiFetchBySource({
            brave: () =>
                jsonResponse({
                    brave: sourcePayload({
                        results: [makeResult({ title: 'Brave Hit', url: 'https://brave.example/a', source: 'brave' })],
                    }),
                }),
            marginalia: () =>
                jsonResponse({
                    marginalia: sourcePayload({
                        results: [makeResult({ title: 'Marg Hit', url: 'https://marg.example/a', source: 'marginalia' })],
                    }),
                }),
            wiby: () =>
                jsonResponse({
                    wiby: sourcePayload({
                        results: [makeResult({ title: 'Wiby Hit', url: 'https://wiby.example/a', source: 'wiby' })],
                    }),
                }),
        });
        deps.apiFetch = apiFetch;
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('cats');
        await vi.waitFor(() => {
            expect(elements.commercialResults.querySelector('.result-item')).toBeTruthy();
            expect(elements.noncommercialResults.querySelectorAll('.result-item').length).toBeGreaterThan(0);
        });

        const paths = apiFetch.mock.calls.map(([path]) => path as string);
        expect(paths.some((p) => p.includes('source=brave'))).toBe(true);
        expect(paths.some((p) => p.includes('source=marginalia'))).toBe(true);
        expect(paths.some((p) => p.includes('source=wiby'))).toBe(true);
        expect(paths.some((p) => p.includes('source=google'))).toBe(false);
        expect(elements.commercialResults.textContent).toContain('Brave Hit');
        expect(elements.noncommercialResults.textContent).toMatch(/Marg Hit|Wiby Hit/);
    });

    it('fetchTavily merges Tavily results into the commercial column', async () => {
        deps.hasGoogleSearchConfigured = vi.fn(() => false);
        const apiFetch = apiFetchBySource({
            brave: () =>
                jsonResponse({
                    brave: sourcePayload({
                        results: [makeResult({ title: 'Brave Hit', url: 'https://brave.example/a', source: 'brave' })],
                    }),
                }),
            tavily: () =>
                jsonResponse({
                    tavily: sourcePayload({
                        results: [
                            makeResult({ title: 'Tavily Hit', url: 'https://tavily.example/a', source: 'tavily' }),
                        ],
                    }),
                }),
            marginalia: () => jsonResponse({ marginalia: sourcePayload() }),
            wiby: () => jsonResponse({ wiby: sourcePayload() }),
        });
        deps.apiFetch = apiFetch;
        deps.hasTavilySearchConfigured = vi.fn(() => true);
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('cats');
        component.fetchTavily('cats');
        await vi.waitFor(() => {
            expect(elements.commercialResults.textContent).toContain('Tavily Hit');
            expect(elements.commercialResults.textContent).toContain('Brave Hit');
        });
        expect(elements.commercialResults.textContent).toContain('Tavily');
    });

    it('uses takeEarlyFetch for page-1 brave when present', async () => {
        deps.hasGoogleSearchConfigured = vi.fn(() => false);
        const early = jsonResponse({
            brave: sourcePayload({
                results: [makeResult({ title: 'Early Brave', url: 'https://brave.example/early', source: 'brave' })],
            }),
        });
        deps.takeEarlyFetch = vi.fn(async (key) => (key === 'brave' ? early : null));
        deps.apiFetch = apiFetchBySource({
            marginalia: () => jsonResponse({ marginalia: sourcePayload() }),
            wiby: () => jsonResponse({ wiby: sourcePayload() }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('early');
        await vi.waitFor(() => {
            expect(elements.commercialResults.textContent).toContain('Early Brave');
        });

        expect(deps.takeEarlyFetch).toHaveBeenCalledWith('brave', 'early');
        const braveApiCalls = vi
            .mocked(deps.apiFetch)
            .mock.calls.filter(([path]) => String(path).includes('source=brave'));
        expect(braveApiCalls).toHaveLength(0);
    });

    it('paints Google first then waits for rest gate before Brave', async () => {
        let resolveBrave!: (value: Response) => void;
        const bravePromise = new Promise<Response>((resolve) => {
            resolveBrave = resolve;
        });
        deps.apiFetch = apiFetchBySource({
            brave: () => bravePromise,
            google: () =>
                jsonResponse({
                    google: sourcePayload({
                        results: [makeResult({ title: 'Google Hit', url: 'https://google.example/a', source: 'google' })],
                    }),
                }),
            marginalia: () => jsonResponse({ marginalia: sourcePayload() }),
            wiby: () => jsonResponse({ wiby: sourcePayload() }),
        });
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('gate');
        component.fetchGoogle('gate');

        await vi.waitFor(() => {
            expect(elements.commercialResults.textContent).toContain('Google Hit');
        });
        expect(elements.commercialResults.querySelectorAll('.skeleton-item').length).toBeGreaterThan(0);
        expect(elements.commercialResults.textContent).not.toContain('Brave Hit');
        expect(elements.noncommercialResults.querySelectorAll('.skeleton-item').length).toBeGreaterThan(0);

        resolveBrave(
            jsonResponse({
                brave: sourcePayload({
                    results: [makeResult({ title: 'Brave Hit', url: 'https://brave.example/a', source: 'brave' })],
                }),
            })
        );

        await vi.waitFor(() => {
            expect(elements.commercialResults.textContent).toContain('Brave Hit');
        });
        expect(elements.commercialResults.querySelectorAll('.skeleton-item')).toHaveLength(0);
        const titles = [...elements.commercialResults.querySelectorAll('.result-title')].map((el) => el.textContent);
        expect(titles[0]).toContain('Google Hit');
        expect(titles[1]).toContain('Brave Hit');
    });

    it('fetchGoogle uses apiFetch/takeEarlyFetch for google source', async () => {
        deps.apiFetch = apiFetchBySource({
            brave: () => jsonResponse({ brave: sourcePayload() }),
            marginalia: () => jsonResponse({ marginalia: sourcePayload() }),
            wiby: () => jsonResponse({ wiby: sourcePayload() }),
            google: () =>
                jsonResponse({
                    google: sourcePayload({
                        results: [makeResult({ title: 'Google Hit', url: 'https://google.example/a', source: 'google' })],
                    }),
                }),
        });
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('cats');
        component.fetchGoogle('cats');
        await vi.waitFor(() => {
            expect(elements.commercialResults.textContent).toContain('Google Hit');
        });

        expect(deps.takeEarlyFetch).toHaveBeenCalledWith('google', 'cats');
        expect(
            vi.mocked(deps.apiFetch).mock.calls.some(([path]) => String(path).includes('source=google'))
        ).toBe(true);
    });

    it('shows commercial error-state when brave and google both fail', async () => {
        deps.apiFetch = apiFetchBySource({
            brave: () => jsonResponse({ brave: sourcePayload({ error: 'brave down', hasMore: false }) }),
            google: () => jsonResponse({ google: sourcePayload({ error: 'google down', hasMore: false }) }),
            marginalia: () => jsonResponse({ marginalia: sourcePayload() }),
            wiby: () => jsonResponse({ wiby: sourcePayload() }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('fail');
        component.fetchGoogle('fail');
        await vi.waitFor(() => {
            expect(elements.commercialResults.querySelector('.error-state')).toBeTruthy();
        });
        expect(elements.commercialResults.textContent).toContain('Something went wrong');
    });

    it('shows commercial empty-state when sources return no results', async () => {
        deps.apiFetch = apiFetchBySource({
            brave: () => jsonResponse({ brave: sourcePayload() }),
            google: () => jsonResponse({ google: sourcePayload() }),
            marginalia: () => jsonResponse({ marginalia: sourcePayload() }),
            wiby: () => jsonResponse({ wiby: sourcePayload() }),
        });
        const component = createSearchResultsComponent(elements, deps);

        component.startSearch('empty');
        component.fetchGoogle('empty');
        await vi.waitFor(() => {
            expect(elements.commercialResults.querySelector('.empty-state')).toBeTruthy();
        });
        expect(elements.commercialResults.textContent).toContain('No results found');
    });

    it('shows noncommercial error-state when marginalia and wiby both fail', async () => {
        deps.apiFetch = apiFetchBySource({
            brave: () => jsonResponse({ brave: sourcePayload() }),
            marginalia: () => jsonResponse({ marginalia: sourcePayload({ error: 'marg fail', hasMore: false }) }),
            wiby: () => jsonResponse({ wiby: sourcePayload({ error: 'wiby fail', hasMore: false }) }),
        });
        const component = createSearchResultsComponent(elements, deps);

        component.startSearch('nc-fail');
        await vi.waitFor(() => {
            expect(elements.noncommercialResults.querySelector('.error-state')).toBeTruthy();
        });
        expect(elements.noncommercialResults.textContent).toContain('Something went wrong');
    });

    it('shows noncommercial empty-state when both return no results', async () => {
        deps.apiFetch = apiFetchBySource({
            brave: () => jsonResponse({ brave: sourcePayload() }),
            marginalia: () => jsonResponse({ marginalia: sourcePayload() }),
            wiby: () => jsonResponse({ wiby: sourcePayload() }),
        });
        const component = createSearchResultsComponent(elements, deps);

        component.startSearch('nc-empty');
        await vi.waitFor(() => {
            expect(elements.noncommercialResults.querySelector('.empty-state')).toBeTruthy();
        });
        expect(elements.noncommercialResults.textContent).toContain('No results found');
    });

    it('calls onGoogleCorrection when google returns correctedQuery', async () => {
        const onGoogleCorrection = vi.fn();
        deps.onGoogleCorrection = onGoogleCorrection;
        deps.apiFetch = apiFetchBySource({
            brave: () => jsonResponse({ brave: sourcePayload() }),
            marginalia: () => jsonResponse({ marginalia: sourcePayload() }),
            wiby: () => jsonResponse({ wiby: sourcePayload() }),
            google: () =>
                jsonResponse({
                    google: sourcePayload({
                        correctedQuery: 'corrected cats',
                        results: [makeResult({ title: 'G', url: 'https://g.example/1', source: 'google' })],
                    }),
                }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('cats');
        component.fetchGoogle('cats');
        await vi.waitFor(() => {
            expect(onGoogleCorrection).toHaveBeenCalledWith('cats', 'corrected cats');
        });
    });

    it('reset clears query and restores placeholder empty-states', async () => {
        deps.hasGoogleSearchConfigured = vi.fn(() => false);
        deps.apiFetch = apiFetchBySource({
            brave: () =>
                jsonResponse({
                    brave: sourcePayload({
                        results: [makeResult({ title: 'Keep', url: 'https://brave.example/k', source: 'brave' })],
                    }),
                }),
            marginalia: () => jsonResponse({ marginalia: sourcePayload() }),
            wiby: () => jsonResponse({ wiby: sourcePayload() }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('keep');
        await vi.waitFor(() => {
            expect(elements.commercialResults.textContent).toContain('Keep');
        });
        elements.commercialCount.textContent = '1 results';
        elements.noncommercialCount.textContent = '0 results';

        component.reset();

        expect(component.getCurrentQuery()).toBe('');
        expect(elements.commercialResults.querySelector('.empty-state')?.textContent).toContain(
            'Commercial results will appear here'
        );
        expect(elements.noncommercialResults.querySelector('.empty-state')?.textContent).toContain(
            'Non-commercial results will appear here'
        );
        expect(elements.mergedResults.querySelector('.empty-state')?.textContent).toContain(
            'Search results will appear here'
        );
        expect(elements.commercialCount.textContent).toBe('');
        expect(elements.noncommercialCount.textContent).toBe('');
    });

    it('renders merged results when isMergedView is true', async () => {
        deps.isMergedView = vi.fn(() => true);
        deps.apiFetch = apiFetchBySource({
            brave: () =>
                jsonResponse({
                    brave: sourcePayload({
                        results: [makeResult({ title: 'Brave M', url: 'https://brave.example/m', source: 'brave' })],
                    }),
                }),
            google: () =>
                jsonResponse({
                    google: sourcePayload({
                        results: [makeResult({ title: 'Google M', url: 'https://google.example/m', source: 'google' })],
                    }),
                }),
            marginalia: () =>
                jsonResponse({
                    marginalia: sourcePayload({
                        results: [makeResult({ title: 'Marg M', url: 'https://marg.example/m', source: 'marginalia' })],
                    }),
                }),
            wiby: () => jsonResponse({ wiby: sourcePayload() }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('merge');
        component.fetchGoogle('merge');
        await vi.waitFor(() => {
            expect(elements.mergedResults.querySelectorAll('.result-item').length).toBeGreaterThanOrEqual(2);
        });
        expect(elements.mergedResults.textContent).toMatch(/Brave M|Google M|Marg M/);
    });

    it('network failure on commercial sources yields error-state after google also fails', async () => {
        deps.apiFetch = vi.fn(async (path: string) => {
            const source = new URL(path, 'https://example.test').searchParams.get('source');
            if (source === 'brave' || source === 'google') {
                throw new Error('network down');
            }
            return jsonResponse({
                marginalia: sourcePayload(),
                wiby: sourcePayload(),
            });
        });
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);

        component.startSearch('net');
        component.fetchGoogle('net');
        await vi.waitFor(() => {
            expect(elements.commercialResults.querySelector('.error-state')).toBeTruthy();
        });
    });
});
