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

function aggregateBody(partial: SearchApiResponse = {}): SearchApiResponse {
    return {
        brave: sourcePayload(),
        marginalia: sourcePayload(),
        wiby: sourcePayload(),
        tavily: sourcePayload(),
        ...partial,
    };
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
        onGoogleCorrection: vi.fn(),
        ...overrides,
    };
}

function apiFetchByRoute(handlers: {
    aggregate?: () => Response | Promise<Response>;
    google?: () => Response | Promise<Response>;
}) {
    return vi.fn(async (path: string) => {
        const source = new URL(path, 'https://example.test').searchParams.get('source');
        if (!source) {
            if (handlers.aggregate) return handlers.aggregate();
            return jsonResponse(aggregateBody());
        }
        if (source === 'google' && handlers.google) return handlers.google();
        return jsonResponse({});
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

    it('startSearch fetches one aggregate (no source) when no early fetch', async () => {
        const apiFetch = apiFetchByRoute({
            aggregate: () =>
                jsonResponse(
                    aggregateBody({
                        brave: sourcePayload({
                            results: [
                                makeResult({ title: 'Brave Hit', url: 'https://brave.example/a', source: 'brave' }),
                            ],
                        }),
                        marginalia: sourcePayload({
                            results: [
                                makeResult({ title: 'Marg Hit', url: 'https://marg.example/a', source: 'marginalia' }),
                            ],
                        }),
                        wiby: sourcePayload({
                            results: [
                                makeResult({ title: 'Wiby Hit', url: 'https://wiby.example/a', source: 'wiby' }),
                            ],
                        }),
                    })
                ),
            google: () => jsonResponse({ google: sourcePayload() }),
        });
        deps.apiFetch = apiFetch;
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('cats');
        component.fetchGoogle('cats');
        await vi.waitFor(() => {
            expect(elements.commercialResults.querySelector('.result-item')).toBeTruthy();
            expect(elements.noncommercialResults.querySelectorAll('.result-item').length).toBeGreaterThan(0);
        });

        const paths = apiFetch.mock.calls.map(([path]) => path as string);
        expect(paths).toContain('/api/search?q=cats&page=1');
        expect(paths.some((p) => p.includes('source=google'))).toBe(true);
        expect(elements.commercialResults.textContent).toContain('Brave Hit');
        expect(elements.noncommercialResults.textContent).toMatch(/Marg Hit|Wiby Hit/);
    });

    it('includes Tavily from aggregate in the commercial column', async () => {
        const apiFetch = apiFetchByRoute({
            aggregate: () =>
                jsonResponse(
                    aggregateBody({
                        brave: sourcePayload({
                            results: [
                                makeResult({ title: 'Brave Hit', url: 'https://brave.example/a', source: 'brave' }),
                            ],
                        }),
                        tavily: sourcePayload({
                            results: [
                                makeResult({
                                    title: 'Tavily Hit',
                                    url: 'https://tavily.example/a',
                                    source: 'tavily',
                                }),
                            ],
                        }),
                    })
                ),
            google: () => jsonResponse({ google: sourcePayload() }),
        });
        deps.apiFetch = apiFetch;
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('cats');
        component.fetchGoogle('cats');
        await vi.waitFor(() => {
            expect(elements.commercialResults.textContent).toContain('Tavily Hit');
            expect(elements.commercialResults.textContent).toContain('Brave Hit');
        });
        expect(elements.commercialResults.textContent).toContain('Tavily');
    });

    it('uses takeEarlyFetch aggregate for page-1 when present', async () => {
        const early = jsonResponse(
            aggregateBody({
                brave: sourcePayload({
                    results: [
                        makeResult({ title: 'Early Brave', url: 'https://brave.example/early', source: 'brave' }),
                    ],
                }),
            })
        );
        deps.takeEarlyFetch = vi.fn(async (key) => {
            if (key === 'aggregate') return early;
            if (key === 'google') return jsonResponse({ google: sourcePayload() });
            return null;
        });
        deps.apiFetch = apiFetchByRoute({});
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('early');
        component.fetchGoogle('early');
        await vi.waitFor(() => {
            expect(elements.commercialResults.textContent).toContain('Early Brave');
        });

        expect(deps.takeEarlyFetch).toHaveBeenCalledWith('aggregate', 'early');
        expect(vi.mocked(deps.apiFetch).mock.calls).toHaveLength(0);
    });

    it('paints Google first then waits for aggregate rest gate before Brave', async () => {
        let resolveAggregate!: (value: Response) => void;
        const aggregatePromise = new Promise<Response>((resolve) => {
            resolveAggregate = resolve;
        });
        deps.apiFetch = apiFetchByRoute({
            aggregate: () => aggregatePromise,
            google: () =>
                jsonResponse({
                    google: sourcePayload({
                        results: [
                            makeResult({ title: 'Google Hit', url: 'https://google.example/a', source: 'google' }),
                        ],
                    }),
                }),
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

        resolveAggregate(
            jsonResponse(
                aggregateBody({
                    brave: sourcePayload({
                        results: [
                            makeResult({ title: 'Brave Hit', url: 'https://brave.example/a', source: 'brave' }),
                        ],
                    }),
                })
            )
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
        deps.apiFetch = apiFetchByRoute({
            aggregate: () => jsonResponse(aggregateBody()),
            google: () =>
                jsonResponse({
                    google: sourcePayload({
                        results: [
                            makeResult({ title: 'Google Hit', url: 'https://google.example/a', source: 'google' }),
                        ],
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
        expect(deps.takeEarlyFetch).toHaveBeenCalledWith('aggregate', 'cats');
        expect(
            vi.mocked(deps.apiFetch).mock.calls.some(([path]) => String(path).includes('source=google'))
        ).toBe(true);
    });

    it('keeps Google error in state but shows empty (no Google error text) when only Google fails', async () => {
        deps.apiFetch = apiFetchByRoute({
            aggregate: () => jsonResponse(aggregateBody()),
            google: () => jsonResponse({ google: sourcePayload({ error: 'CSE quota exceeded', hasMore: false }) }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('fail');
        component.fetchGoogle('fail');
        await vi.waitFor(() => {
            expect(elements.commercialResults.querySelector('.empty-state')).toBeTruthy();
        });
        expect(elements.commercialResults.textContent).toContain('No results found');
        expect(elements.commercialResults.textContent).not.toContain('CSE quota');
        expect(redirectToGoogleSearch).not.toHaveBeenCalled();
    });

    it('shows commercial error-state when brave and tavily both fail (Google quiet)', async () => {
        deps.apiFetch = apiFetchByRoute({
            aggregate: () =>
                jsonResponse(
                    aggregateBody({
                        brave: sourcePayload({ error: 'brave down', hasMore: false }),
                        tavily: sourcePayload({ error: 'tavily down', hasMore: false }),
                    })
                ),
            google: () => jsonResponse({ google: sourcePayload({ error: 'google down', hasMore: false }) }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('fail');
        component.fetchGoogle('fail');
        await vi.waitFor(() => {
            expect(elements.commercialResults.querySelector('.error-state')).toBeTruthy();
        });
        expect(elements.commercialResults.textContent).toContain('Something went wrong');
        expect(elements.commercialResults.textContent).not.toContain('google down');
    });

    it('redirects to google.com only when google, brave, and tavily all hard-fail', async () => {
        deps.apiFetch = apiFetchByRoute({
            aggregate: () =>
                jsonResponse(
                    aggregateBody({
                        brave: sourcePayload({ error: 'brave down', hasMore: false }),
                        tavily: sourcePayload({ error: 'tavily down', hasMore: false }),
                    })
                ),
            google: () => jsonResponse({ google: sourcePayload({ error: 'google down', hasMore: false }) }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('all-fail');
        component.fetchGoogle('all-fail');
        await vi.waitFor(() => {
            expect(redirectToGoogleSearch).toHaveBeenCalledWith('all-fail');
        });
    });

    it('does not redirect when Google is quiet-empty (no error) even if Brave fails', async () => {
        deps.apiFetch = apiFetchByRoute({
            aggregate: () =>
                jsonResponse(
                    aggregateBody({
                        brave: sourcePayload({ error: 'brave down', hasMore: false }),
                        tavily: sourcePayload({ error: 'tavily down', hasMore: false }),
                    })
                ),
            google: () => jsonResponse({ google: sourcePayload() }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('quiet-google');
        component.fetchGoogle('quiet-google');
        await vi.waitFor(() => {
            expect(elements.commercialResults.querySelector('.error-state, .empty-state')).toBeTruthy();
        });
        expect(redirectToGoogleSearch).not.toHaveBeenCalled();
    });

    it('treats error-only source payloads (no results key) as errors', async () => {
        deps.apiFetch = apiFetchByRoute({
            aggregate: () =>
                ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        brave: { error: 'brave down' },
                        marginalia: sourcePayload(),
                        wiby: sourcePayload(),
                        tavily: { error: 'tavily down' },
                    }),
                }) as Response,
            google: () => jsonResponse({ google: sourcePayload({ error: 'google down', hasMore: false }) }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('err-only');
        component.fetchGoogle('err-only');
        await vi.waitFor(() => {
            expect(elements.commercialResults.querySelector('.error-state')).toBeTruthy();
        });
        expect(elements.commercialResults.textContent).toContain('Something went wrong');
        expect(redirectToGoogleSearch).toHaveBeenCalledWith('err-only');
    });

    it('shows commercial empty-state when sources return no results', async () => {
        deps.apiFetch = apiFetchByRoute({
            aggregate: () => jsonResponse(aggregateBody()),
            google: () => jsonResponse({ google: sourcePayload() }),
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
        deps.apiFetch = apiFetchByRoute({
            aggregate: () =>
                jsonResponse(
                    aggregateBody({
                        marginalia: sourcePayload({ error: 'marg fail', hasMore: false }),
                        wiby: sourcePayload({ error: 'wiby fail', hasMore: false }),
                    })
                ),
            google: () => jsonResponse({ google: sourcePayload() }),
        });
        const component = createSearchResultsComponent(elements, deps);

        component.startSearch('nc-fail');
        component.fetchGoogle('nc-fail');
        await vi.waitFor(() => {
            expect(elements.noncommercialResults.querySelector('.error-state')).toBeTruthy();
        });
        expect(elements.noncommercialResults.textContent).toContain('Something went wrong');
    });

    it('shows noncommercial empty-state when both return no results', async () => {
        deps.apiFetch = apiFetchByRoute({
            aggregate: () => jsonResponse(aggregateBody()),
            google: () => jsonResponse({ google: sourcePayload() }),
        });
        const component = createSearchResultsComponent(elements, deps);

        component.startSearch('nc-empty');
        component.fetchGoogle('nc-empty');
        await vi.waitFor(() => {
            expect(elements.noncommercialResults.querySelector('.empty-state')).toBeTruthy();
        });
        expect(elements.noncommercialResults.textContent).toContain('No results found');
    });

    it('calls onGoogleCorrection when google returns correctedQuery', async () => {
        const onGoogleCorrection = vi.fn();
        deps.onGoogleCorrection = onGoogleCorrection;
        deps.apiFetch = apiFetchByRoute({
            aggregate: () => jsonResponse(aggregateBody()),
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

    it('aborts in-flight page-1 fetches when a new search starts', async () => {
        const abortErrors: AbortSignal[] = [];
        deps.apiFetch = vi.fn((_path: string, init?: RequestInit) => {
            const signal = init?.signal;
            if (signal) abortErrors.push(signal);
            return new Promise<Response>((_resolve, reject) => {
                if (signal?.aborted) {
                    reject(new DOMException('Aborted', 'AbortError'));
                    return;
                }
                signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            });
        });
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);

        component.startSearch('first');
        component.startSearch('second');

        await vi.waitFor(() => {
            expect(abortErrors.some((signal) => signal.aborted)).toBe(true);
        });
    });

    it('reset clears query and restores placeholder empty-states', async () => {
        deps.apiFetch = apiFetchByRoute({
            aggregate: () =>
                jsonResponse(
                    aggregateBody({
                        brave: sourcePayload({
                            results: [
                                makeResult({ title: 'Keep', url: 'https://brave.example/k', source: 'brave' }),
                            ],
                        }),
                    })
                ),
            google: () => jsonResponse({ google: sourcePayload() }),
        });
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('keep');
        component.fetchGoogle('keep');
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
        deps.apiFetch = apiFetchByRoute({
            aggregate: () =>
                jsonResponse(
                    aggregateBody({
                        brave: sourcePayload({
                            results: [
                                makeResult({ title: 'Brave M', url: 'https://brave.example/m', source: 'brave' }),
                            ],
                        }),
                        marginalia: sourcePayload({
                            results: [
                                makeResult({
                                    title: 'Marg M',
                                    url: 'https://marg.example/m',
                                    source: 'marginalia',
                                }),
                            ],
                        }),
                    })
                ),
            google: () =>
                jsonResponse({
                    google: sourcePayload({
                        results: [
                            makeResult({ title: 'Google M', url: 'https://google.example/m', source: 'google' }),
                        ],
                    }),
                }),
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

    it('network failure on brave+tavily yields commercial error-state; Google fail stays quiet', async () => {
        deps.apiFetch = vi.fn(async (path: string) => {
            const source = new URL(path, 'https://example.test').searchParams.get('source');
            if (!source) {
                throw new Error('network down');
            }
            if (source === 'google') {
                throw new Error('google network down');
            }
            return jsonResponse(aggregateBody());
        });
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);

        component.startSearch('net');
        component.fetchGoogle('net');
        await vi.waitFor(() => {
            expect(elements.commercialResults.querySelector('.error-state')).toBeTruthy();
        });
        expect(elements.commercialResults.textContent).not.toContain('google network');
        expect(redirectToGoogleSearch).toHaveBeenCalledWith('net');
    });

    it('load-more commercial uses one aggregate request for edge sources', async () => {
        const observerCallbacks: IntersectionObserverCallback[] = [];
        class CapturingIO {
            constructor(cb: IntersectionObserverCallback) {
                observerCallbacks.push(cb);
            }
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords(): IntersectionObserverEntry[] {
                return [];
            }
        }
        vi.stubGlobal('IntersectionObserver', CapturingIO);

        const pages: string[] = [];
        deps.apiFetch = vi.fn(async (path: string) => {
            const url = new URL(path, 'https://example.test');
            const source = url.searchParams.get('source');
            if (source === 'google') {
                return jsonResponse({ google: sourcePayload() });
            }
            expect(source).toBeNull();
            const page = url.searchParams.get('page') ?? '1';
            pages.push(page);
            if (page === '1') {
                return jsonResponse(
                    aggregateBody({
                        brave: sourcePayload({
                            hasMore: true,
                            results: [
                                makeResult({ title: 'Brave 1', url: 'https://brave.example/1', source: 'brave' }),
                            ],
                        }),
                        marginalia: sourcePayload({
                            hasMore: true,
                            results: [
                                makeResult({
                                    title: 'Marg 1',
                                    url: 'https://marg.example/1',
                                    source: 'marginalia',
                                }),
                            ],
                        }),
                    })
                );
            }
            return jsonResponse(
                aggregateBody({
                    brave: sourcePayload({
                        hasMore: false,
                        results: [
                            makeResult({ title: 'Brave 2', url: 'https://brave.example/2', source: 'brave' }),
                        ],
                    }),
                    marginalia: sourcePayload({
                        hasMore: false,
                        results: [
                            makeResult({ title: 'Marg 2', url: 'https://marg.example/2', source: 'marginalia' }),
                        ],
                    }),
                })
            );
        });
        deps.takeEarlyFetch = vi.fn(async () => null);
        const component = createSearchResultsComponent(elements, deps);
        component.initInfiniteScroll();

        component.startSearch('more');
        component.fetchGoogle('more');
        await vi.waitFor(() => {
            expect(elements.commercialResults.textContent).toContain('Brave 1');
        });
        expect(pages).toEqual(['1']);
        expect(observerCallbacks.length).toBeGreaterThanOrEqual(1);

        const commercialCb = observerCallbacks[0];
        expect(commercialCb).toBeTruthy();
        commercialCb!(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
        );

        await vi.waitFor(() => {
            expect(elements.commercialResults.textContent).toContain('Brave 2');
        });
        expect(pages).toEqual(['1', '2']);
        expect(elements.noncommercialResults.textContent).toContain('Marg 2');
    });
});
