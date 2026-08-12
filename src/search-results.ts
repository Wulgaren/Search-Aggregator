import type {
    MergedItem,
    SearchApiResponse,
    SearchDeps,
    SearchResult,
    SearchResultsElements,
    SourcePayload,
    SourceState,
} from './types';
import { redirectToGoogleSearch } from './query-bangs';
import { asRecord, isRecord, readArray, readBoolean, readString } from './unknown';

type Page1Source = 'brave' | 'google' | 'tavily' | 'marginalia' | 'wiby';

function isAbortError(error: unknown): boolean {
    return isRecord(error) && readString(error, 'name') === 'AbortError';
}

export function createSearchResultsComponent(elements: SearchResultsElements, deps: SearchDeps) {
    let currentQuery = '';
    let searchSessionId = 0;
    let sessionAbort: AbortController | null = null;
    let braveState: SourceState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    let googleState: SourceState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    let tavilyState: SourceState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    let marginaliaState: SourceState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    let wibyState: SourceState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    let mergedState = { loading: false };
    let renderedCommercialUrls = new Set<string>();
    let renderedNoncommercialUrls = new Set<string>();
    let renderedMergedUrls = new Set<string>();
    let googleFallbackRedirected = false;
    let page1Settled: Record<Page1Source, boolean> = createPage1Settled(deps);

    function resetPage1Settled() {
        page1Settled = createPage1Settled(deps);
    }

    function abortActiveSession() {
        if (sessionAbort) {
            sessionAbort.abort();
            sessionAbort = null;
        }
    }

    function beginSession(): AbortSignal {
        abortActiveSession();
        sessionAbort = new AbortController();
        return sessionAbort.signal;
    }

    function restGateReady() {
        return page1Settled.brave && page1Settled.tavily && page1Settled.marginalia && page1Settled.wiby;
    }

    function reset() {
        abortActiveSession();
        searchSessionId += 1;
        currentQuery = '';
        braveState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        googleState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        tavilyState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        marginaliaState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        wibyState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        mergedState = { loading: false };
        renderedCommercialUrls = new Set();
        renderedNoncommercialUrls = new Set();
        renderedMergedUrls = new Set();
        googleFallbackRedirected = false;
        resetPage1Settled();
        elements.commercialResults.innerHTML = `<div class="empty-state"><p>Commercial results will appear here</p></div>`;
        elements.noncommercialResults.innerHTML = `<div class="empty-state"><p>Non-commercial results will appear here</p></div>`;
        elements.mergedResults.innerHTML = `<div class="empty-state"><p>Search results will appear here</p></div>`;
        elements.commercialCount.textContent = '';
        elements.noncommercialCount.textContent = '';
    }

    function initInfiniteScroll() {
        const observerOptions: IntersectionObserverInit = { root: null, rootMargin: '100px', threshold: 0 };
        const commercialSentinel = document.createElement('div');
        commercialSentinel.className = 'scroll-sentinel';
        const noncommercialSentinel = document.createElement('div');
        noncommercialSentinel.className = 'scroll-sentinel';
        const mergedSentinel = document.createElement('div');
        mergedSentinel.className = 'scroll-sentinel';

        const commercialObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting && currentQuery && !deps.isMergedView()) void loadMoreCommercial();
            });
        }, observerOptions);
        const noncommercialObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (
                    entry.isIntersecting &&
                    !marginaliaState.loading &&
                    !wibyState.loading &&
                    (marginaliaState.hasMore || wibyState.hasMore) &&
                    currentQuery &&
                    !deps.isMergedView()
                ) {
                    void loadMoreNoncommercial();
                }
            });
        }, observerOptions);
        const mergedObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting && !mergedState.loading && currentQuery && deps.isMergedView()) {
                    void loadMoreMergedResults();
                }
            });
        }, observerOptions);
        window.scrollObservers = { commercialObserver, noncommercialObserver, mergedObserver };
        window.sentinels = { commercialSentinel, noncommercialSentinel, mergedSentinel };
    }

    type EdgeSource = 'brave' | 'tavily' | 'marginalia' | 'wiby';
    const EDGE_SOURCES: EdgeSource[] = ['brave', 'tavily', 'marginalia', 'wiby'];

    function applySourcePayload(
        source: EdgeSource | 'google',
        sourceData: SourcePayload | undefined,
        page: number,
        query: string
    ) {
        const state = getState(source);
        if (sourceData?.error) {
            state.hasMore = false;
            state.error = sourceData.error;
        } else if (sourceData) {
            state.hasMore = sourceData.hasMore;
            state.results = [...state.results, ...sourceData.results];
            state.error = null;
            if (source === 'google' && page === 1 && sourceData.correctedQuery && sourceData.correctedQuery !== query) {
                deps.onGoogleCorrection?.(query, sourceData.correctedQuery);
            }
        }
    }

    function markEdgeLoading(sources: EdgeSource[], loading: boolean) {
        for (const source of sources) {
            getState(source).loading = loading;
        }
    }

    function failEdgeSources(sources: EdgeSource[], errMsg: string) {
        for (const source of sources) {
            const state = getState(source);
            state.hasMore = false;
            state.error = errMsg;
        }
    }

    /** One edge aggregate: brave+marginalia+wiby+tavily (no `source` query param). */
    async function fetchEdgeAggregate(
        query: string,
        page: number,
        sessionId: number,
        signal: AbortSignal,
        applySources: EdgeSource[]
    ) {
        if (sessionId !== searchSessionId || query !== currentQuery) return;
        if (applySources.length === 0) return;
        markEdgeLoading(applySources, true);
        try {
            let response: Response;
            const fetchInit = { signal };
            const path = `/api/search?q=${encodeURIComponent(query)}&page=${page}`;
            if (page === 1) {
                const early = await deps.takeEarlyFetch('aggregate', query);
                response = early ?? (await deps.apiFetch(path, fetchInit));
            } else {
                response = await deps.apiFetch(path, fetchInit);
            }
            if (!response.ok) throw new Error(`Search failed: ${response.status}`);
            const raw: unknown = await response.json();
            const data = parseSearchApiResponse(raw);
            if (sessionId !== searchSessionId || query !== currentQuery) return;
            for (const source of applySources) {
                applySourcePayload(source, data[source], page, query);
            }
        } catch (error) {
            if (isAbortError(error)) return;
            const errMsg = error instanceof Error ? error.message : String(error);
            failEdgeSources(applySources, errMsg);
        } finally {
            if (sessionId === searchSessionId && query === currentQuery) {
                markEdgeLoading(applySources, false);
            }
        }

        if (sessionId !== searchSessionId || query !== currentQuery) return;
        if (page === 1) {
            for (const source of EDGE_SOURCES) {
                page1Settled[source] = true;
            }
            maybeRedirectToGoogleFallback(query, sessionId, page);
            updatePage1Views();
            return;
        }
        renderCommercialResults();
        if (!deps.isMergedView()) renderNoncommercialResults();
        if (deps.isMergedView()) renderMergedResults();
    }

    async function fetchSource(
        source: 'google',
        query: string,
        page: number,
        sessionId: number,
        signal: AbortSignal
    ) {
        if (sessionId !== searchSessionId || query !== currentQuery) return;
        const state = getState(source);
        state.loading = true;
        try {
            let response: Response;
            const fetchInit = { signal };
            if (page === 1) {
                const early = await deps.takeEarlyFetch(source, query);
                response =
                    early ??
                    (await deps.apiFetch(
                        `/api/search?q=${encodeURIComponent(query)}&page=${page}&source=${source}`,
                        fetchInit
                    ));
            } else {
                response = await deps.apiFetch(
                    `/api/search?q=${encodeURIComponent(query)}&page=${page}&source=${source}`,
                    fetchInit
                );
            }
            if (!response.ok) throw new Error(`Search failed: ${response.status}`);
            const raw: unknown = await response.json();
            const data = parseSearchApiResponse(raw);
            if (sessionId !== searchSessionId || query !== currentQuery) return;
            applySourcePayload(source, data[source], page, query);
            applyBraveFallback(data, page, sessionId, query);
        } catch (error) {
            if (isAbortError(error)) return;
            const errMsg = error instanceof Error ? error.message : String(error);
            state.hasMore = false;
            state.error = errMsg;
        } finally {
            if (sessionId === searchSessionId && query === currentQuery) state.loading = false;
        }

        if (sessionId !== searchSessionId || query !== currentQuery) return;
        if (page === 1) {
            maybeRedirectToGoogleFallback(query, sessionId, page);
            page1Settled[source] = true;
            updatePage1Views();
            return;
        }
        renderCommercialResults();
        if (!deps.isMergedView() && (marginaliaState.results.length > 0 || wibyState.results.length > 0))
            renderNoncommercialResults();
        if (deps.isMergedView()) {
            renderMergedResults();
        }
    }

    function startSearch(query: string) {
        currentQuery = query;
        searchSessionId += 1;
        const sessionId = searchSessionId;
        const signal = beginSession();
        braveState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        googleState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        tavilyState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        marginaliaState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        wibyState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        mergedState = { loading: false };
        renderedCommercialUrls = new Set();
        renderedNoncommercialUrls = new Set();
        renderedMergedUrls = new Set();
        googleFallbackRedirected = false;
        resetPage1Settled();
        showLoading(elements.commercialResults);
        showLoading(elements.noncommercialResults);
        showLoading(elements.mergedResults);
        elements.commercialCount.textContent = '';
        elements.noncommercialCount.textContent = '';
        void fetchEdgeAggregate(query, 1, sessionId, signal, EDGE_SOURCES);
    }

    function updatePage1Views() {
        if (deps.isMergedView()) {
            updateMergedPage1();
            return;
        }
        updateCommercialPage1();
        updateNoncommercialPage1();
    }

    function updateCommercialPage1() {
        if (!page1Settled.google) return;
        if (!restGateReady()) {
            renderCommercialGooglePartial();
            return;
        }
        renderCommercialResults();
    }

    function updateNoncommercialPage1() {
        if (!restGateReady()) return;
        renderNoncommercialResults();
    }

    function updateMergedPage1() {
        if (!page1Settled.google) return;
        if (!restGateReady()) {
            renderMergedGooglePartial();
            return;
        }
        renderMergedResults();
    }

    function renderCommercialGooglePartial() {
        const googleResults = deduplicateResults(googleState.results);
        if (googleResults.length === 0) {
            showLoading(elements.commercialResults);
            elements.commercialCount.textContent = '';
            return;
        }
        elements.commercialResults.innerHTML =
            googleResults
                .map((result, index) => renderStandardResultArticle(result, index, 'google', 'Google'))
                .join('') + generateSkeletonHTML(3);
        applyNoAnimateToRenderedItems(elements.commercialResults, renderedCommercialUrls);
        attachPrefetchListeners(elements.commercialResults);
        updateCount(elements.commercialCount, googleResults.length, true);
    }

    function renderMergedGooglePartial() {
        const allResults: MergedItem[] = [];
        const seen = new Set<string>();
        for (const result of googleState.results) {
            maybePushMerged('commercial', result, seen, allResults);
        }
        if (allResults.length === 0) {
            showLoading(elements.mergedResults);
            return;
        }
        elements.mergedResults.innerHTML =
            allResults
                .map((item, index) =>
                    renderStandardResultArticle(item.result, index, 'commercial', 'Google', 'result-source')
                )
                .join('') + generateSkeletonHTML(3);
        applyNoAnimateToRenderedItems(elements.mergedResults, renderedMergedUrls);
        attachPrefetchListeners(elements.mergedResults);
    }

    function applyBraveFallback(data: SearchApiResponse, page: number, sessionId: number, query: string) {
        const braveData = data.brave;
        if (!braveData || braveData.error || braveData.results.length === 0) return;
        if (sessionId !== searchSessionId || query !== currentQuery) return;
        if (braveState.results.length > 0 || braveState.loading) return;
        braveState.hasMore = braveData.hasMore;
        braveState.results =
            page === 1 ? braveData.results : deduplicateResults([...braveState.results, ...braveData.results]);
        braveState.error = null;
    }

    function maybeRedirectToGoogleFallback(query: string, sessionId: number, page: number): boolean {
        if (page !== 1 || googleFallbackRedirected) return false;
        if (sessionId !== searchSessionId || query !== currentQuery) return false;
        if (braveState.loading || googleState.loading || tavilyState.loading) return false;
        if (braveState.results.length > 0 || googleState.results.length > 0 || tavilyState.results.length > 0)
            return false;

        // Redirect only when Google + Brave + Tavily all hard-failed (error in state).
        // Missing Google/Tavily env is quiet empty (no error) and must not redirect alone.
        const braveFailed = Boolean(braveState.error);
        const googleFailed = Boolean(googleState.error);
        const tavilyFailed = Boolean(tavilyState.error);
        if (!braveFailed || !googleFailed || !tavilyFailed) return false;

        googleFallbackRedirected = true;
        redirectToGoogleSearch(query);
        return true;
    }

    function fetchGoogle(query: string) {
        if (currentQuery === query && sessionAbort)
            void fetchSource('google', query, 1, searchSessionId, sessionAbort.signal);
    }

    function forceRenderMergedIfNeeded() {
        if (!deps.isMergedView() || !currentQuery) return;
        if (!page1Settled.google) return;
        if (!restGateReady()) {
            renderMergedGooglePartial();
            return;
        }
        renderMergedResults();
    }

    function getCurrentQuery() {
        return currentQuery;
    }

    function edgeSourcesNeedingMore(): EdgeSource[] {
        return EDGE_SOURCES.filter((source) => {
            const state = getState(source);
            return state.hasMore && !state.loading;
        });
    }

    /** Columns scroll together: one aggregate for all edge sources that still have more. */
    async function loadMoreEdgeSources(signal: AbortSignal) {
        const needing = edgeSourcesNeedingMore();
        if (needing.length === 0) return;
        const page = Math.max(...needing.map((s) => getState(s).page)) + 1;
        for (const source of needing) {
            getState(source).page = page;
        }
        await fetchEdgeAggregate(currentQuery, page, searchSessionId, signal, needing);
    }

    async function loadMoreCommercial() {
        const googleNeedsMore = googleState.hasMore && !googleState.loading;
        const edgeNeedsMore = edgeSourcesNeedingMore().length > 0;
        if (!edgeNeedsMore && !googleNeedsMore) return;
        if (!sessionAbort) return;
        const signal = sessionAbort.signal;
        showLoadingMore(elements.commercialResults);
        const promises: Promise<void>[] = [];
        if (edgeNeedsMore) {
            promises.push(loadMoreEdgeSources(signal));
        }
        if (googleNeedsMore) {
            googleState.page += 1;
            promises.push(fetchSource('google', currentQuery, googleState.page, searchSessionId, signal));
        }
        await Promise.all(promises);
        removeLoadingMore(elements.commercialResults);
    }

    async function loadMoreNoncommercial() {
        if (marginaliaState.loading || wibyState.loading) return;
        if (!marginaliaState.hasMore && !wibyState.hasMore) return;
        if (!sessionAbort) return;
        const signal = sessionAbort.signal;
        showLoadingMore(elements.noncommercialResults);
        await loadMoreEdgeSources(signal);
        removeLoadingMore(elements.noncommercialResults);
    }

    async function loadMoreMergedResults() {
        const googleNeedsMore = googleState.hasMore && !googleState.loading;
        const edgeNeedsMore = edgeSourcesNeedingMore().length > 0;
        if (!edgeNeedsMore && !googleNeedsMore) return;
        if (!sessionAbort) return;
        const signal = sessionAbort.signal;
        mergedState.loading = true;
        showLoadingMore(elements.mergedResults);
        const promises: Promise<void>[] = [];
        if (edgeNeedsMore) {
            promises.push(loadMoreEdgeSources(signal));
        }
        if (googleNeedsMore) {
            googleState.page += 1;
            promises.push(fetchSource('google', currentQuery, googleState.page, searchSessionId, signal));
        }
        await Promise.all(promises);
        removeLoadingMore(elements.mergedResults);
        mergedState.loading = false;
    }

    function renderCommercialResults() {
        const interleaved = deduplicateResults([
            ...googleState.results,
            ...interleaveArrays(braveState.results, tavilyState.results),
        ]);
        const anyLoading = braveState.loading || googleState.loading || tavilyState.loading;
        if (interleaved.length === 0) {
            if (!anyLoading) {
                // Google failures stay quiet in the UI (error kept in state for redirect only).
                elements.commercialResults.innerHTML =
                    braveState.error && tavilyState.error
                        ? `<div class="error-state"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`
                        : `<div class="empty-state"><p>No results found</p></div>`;
            }
            return;
        }
        elements.commercialResults.innerHTML = interleaved
            .map((result, index) => {
                const dataSource = result.source || 'brave';
                const label =
                    dataSource === 'google' ? 'Google' : dataSource === 'tavily' ? 'Tavily' : 'Brave';
                return renderStandardResultArticle(result, index, dataSource, label);
            })
            .join('');
        applyNoAnimateToRenderedItems(elements.commercialResults, renderedCommercialUrls);
        attachPrefetchListeners(elements.commercialResults);
        const totalResults =
            braveState.results.length + googleState.results.length + tavilyState.results.length;
        const hasMore = braveState.hasMore || googleState.hasMore || tavilyState.hasMore;
        updateCount(elements.commercialCount, totalResults, hasMore);
        if (hasMore) attachSentinel(elements.commercialResults, 'commercial');
    }

    function renderNoncommercialResults() {
        const combinedRaw = deduplicateResults(interleaveArrays(marginaliaState.results, wibyState.results));
        const commercialUrls = new Set<string>();
        for (const result of googleState.results) commercialUrls.add(getDedupeKey(result.url));
        for (const result of braveState.results) commercialUrls.add(getDedupeKey(result.url));
        for (const result of tavilyState.results) commercialUrls.add(getDedupeKey(result.url));
        const results = combinedRaw.filter((result) => !commercialUrls.has(getDedupeKey(result.url)));
        const anyNcLoading = marginaliaState.loading || wibyState.loading;
        const rawCount = marginaliaState.results.length + wibyState.results.length;
        if (results.length === 0) {
            if (anyNcLoading) return;
            const noData = marginaliaState.results.length === 0 && wibyState.results.length === 0;
            const bothFailed = Boolean(marginaliaState.error && wibyState.error && noData);
            const anyFailed = Boolean(marginaliaState.error || wibyState.error);
            elements.noncommercialResults.innerHTML = bothFailed
                ? `<div class="error-state"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`
                : rawCount > 0
                  ? `<div class="empty-state"><p>All results match commercial results</p></div>`
                  : anyFailed
                    ? `<div class="error-state"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`
                    : `<div class="empty-state"><p>No results found</p></div>`;
            elements.noncommercialCount.textContent = '';
            return;
        }
        elements.noncommercialResults.innerHTML = results
            .map((result, index) => {
                const dataSource = result.source === 'wiby' ? 'wiby' : 'marginalia';
                const label = result.source === 'wiby' ? 'Wiby' : 'Marginalia';
                return renderStandardResultArticle(result, index, dataSource, label);
            })
            .join('');
        applyNoAnimateToRenderedItems(elements.noncommercialResults, renderedNoncommercialUrls);
        attachPrefetchListeners(elements.noncommercialResults);
        const ncHasMore = marginaliaState.hasMore || wibyState.hasMore;
        updateCount(elements.noncommercialCount, results.length, ncHasMore);
        if (ncHasMore) attachSentinel(elements.noncommercialResults, 'noncommercial');
    }

    function renderMergedResults() {
        const allResults: MergedItem[] = [];
        const seen = new Set<string>();
        for (const result of googleState.results) {
            maybePushMerged('commercial', result, seen, allResults);
        }
        const rest = interleaveArrays(
            braveState.results,
            tavilyState.results,
            marginaliaState.results,
            wibyState.results
        );
        for (const result of rest) {
            const type =
                result.source === 'marginalia' || result.source === 'wiby' ? 'noncommercial' : 'commercial';
            maybePushMerged(type, result, seen, allResults);
        }
        const anyLoading =
            braveState.loading ||
            googleState.loading ||
            tavilyState.loading ||
            marginaliaState.loading ||
            wibyState.loading;
        const allErrors = Boolean(
            braveState.error &&
                tavilyState.error &&
                marginaliaState.error &&
                wibyState.error
        );
        if (allResults.length === 0) {
            if (!anyLoading) {
                elements.mergedResults.innerHTML = allErrors
                    ? `<div class="error-state"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`
                    : `<div class="empty-state"><p>No results found</p></div>`;
            }
            return;
        }
        elements.mergedResults.innerHTML = allResults
            .map((item, index) => {
                const sourceLabel =
                    item.type === 'commercial'
                        ? item.result.source === 'google'
                            ? 'Google'
                            : item.result.source === 'tavily'
                              ? 'Tavily'
                              : 'Brave'
                        : item.result.source === 'wiby'
                          ? 'Wiby'
                          : 'Marginalia';
                return renderStandardResultArticle(
                    item.result,
                    index,
                    item.type === 'commercial' ? 'commercial' : 'noncommercial',
                    sourceLabel,
                    'result-source'
                );
            })
            .join('');
        applyNoAnimateToRenderedItems(elements.mergedResults, renderedMergedUrls);
        attachPrefetchListeners(elements.mergedResults);
        if (
            braveState.hasMore ||
            googleState.hasMore ||
            tavilyState.hasMore ||
            marginaliaState.hasMore ||
            wibyState.hasMore
        )
            attachSentinel(elements.mergedResults, 'merged');
    }

    function maybePushMerged(type: 'commercial' | 'noncommercial', result: SearchResult, seen: Set<string>, allResults: MergedItem[]) {
        const key = getDedupeKey(result.url);
        if (seen.has(key)) return;
        seen.add(key);
        allResults.push({ type, result, urlKey: key });
    }

    function getState(source: 'brave' | 'google' | 'tavily' | 'marginalia' | 'wiby') {
        if (source === 'brave') return braveState;
        if (source === 'google') return googleState;
        if (source === 'tavily') return tavilyState;
        if (source === 'wiby') return wibyState;
        return marginaliaState;
    }

    return {
        reset,
        initInfiniteScroll,
        startSearch,
        fetchGoogle,
        forceRenderMergedIfNeeded,
        getCurrentQuery,
    };
}

function interleaveArrays(...arrays: SearchResult[][]): SearchResult[] {
    const result: SearchResult[] = [];
    const maxLen = Math.max(0, ...arrays.map((arr) => arr.length));
    for (let i = 0; i < maxLen; i++) {
        for (const arr of arrays) {
            const item = arr[i];
            if (item !== undefined) result.push(item);
        }
    }
    return result;
}

function deduplicateResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return results.filter((result) => {
        try {
            const url = new URL(result.url);
            const key = url.hostname + url.pathname.replace(/\/$/, '');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        } catch {
            return true;
        }
    });
}

function getDedupeKey(url: string) {
    try {
        const parsed = new URL(url);
        return parsed.hostname + parsed.pathname.replace(/\/$/, '');
    } catch {
        return url;
    }
}

function getDomain(url: string) {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

function getFaviconUrl(url: string) {
    try {
        return `https://www.google.com/s2/favicons?sz=32&domain=${new URL(url).hostname}`;
    } catch {
        return '';
    }
}

function escapeHtml(text: string) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sanitizeSnippet(html: string) {
    if (!html) return '';
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const allowedTags = ['b', 'strong', 'i', 'em', 'br', 'span', 'mark'];
    function sanitizeNode(node: Node): void {
        for (const child of Array.from(node.childNodes)) {
            if (child instanceof Element) {
                const el = child;
                const tagName = el.tagName.toLowerCase();
                if (!allowedTags.includes(tagName)) {
                    const text = document.createTextNode(el.textContent || '');
                    node.replaceChild(text, child);
                } else {
                    for (const attr of Array.from(el.attributes)) {
                        if (attr.name !== 'class') el.removeAttribute(attr.name);
                    }
                    sanitizeNode(el);
                }
            }
        }
    }
    sanitizeNode(temp);
    return temp.innerHTML.replace(/\s*\.{3}\s*/g, '<span class="snippet-separator">···</span>');
}

function getResultEngine(result: SearchResult, dataSource: string): string {
    const s = result.source;
    if (s === 'google' || s === 'brave' || s === 'tavily' || s === 'marginalia' || s === 'wiby') return s;
    if (
        dataSource === 'google' ||
        dataSource === 'brave' ||
        dataSource === 'tavily' ||
        dataSource === 'marginalia' ||
        dataSource === 'wiby'
    )
        return dataSource;
    return 'brave';
}

function renderStandardResultArticle(
    result: SearchResult,
    index: number,
    dataSource: string,
    sourceLabel: string,
    sourceClassName = 'result-source-tag',
    animate = true
) {
    const faviconUrl = getFaviconUrl(result.url);
    const urlKey = getDedupeKey(result.url);
    const engine = getResultEngine(result, dataSource);
    const animateStyle = animate ? ` style="animation-delay: ${index * 0.02}s"` : '';
    const className = animate ? 'result-item' : 'result-item no-animate';
    return `
        <article class="${className}" data-source="${dataSource}" data-engine="${escapeHtml(engine)}" data-url-key="${escapeHtml(urlKey)}"${animateStyle}>
            <div class="result-url-row">
                <img class="result-favicon" src="${escapeHtml(faviconUrl)}" alt="" loading="lazy" onerror="this.classList.add('error')">
                <div class="result-url">${escapeHtml(result.displayUrl || getDomain(result.url))}</div>
                <div class="${sourceClassName}">${sourceLabel}</div>
            </div>
            <h3 class="result-title"><a href="${escapeHtml(result.url)}">${escapeHtml(result.title)}</a></h3>
            ${result.snippet ? `<p class="result-snippet">${sanitizeSnippet(result.snippet)}</p>` : ''}
        </article>
    `;
}

const prefetchedUrls = new Set<string>();
function prefetchLink(url: string) {
    if (prefetchedUrls.has(url)) return;
    prefetchedUrls.add(url);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    document.head.appendChild(link);
}

function attachPrefetchListeners(container: HTMLElement) {
    container.querySelectorAll('.result-title a').forEach((link) => {
        if (!(link instanceof HTMLAnchorElement)) return;
        const a = link;
        const url = a.href;
        a.addEventListener('mousedown', () => prefetchLink(url), { once: true });
        a.addEventListener('touchstart', () => setTimeout(() => prefetchLink(url), 0), { once: true, passive: true });
    });
}

function applyNoAnimateToRenderedItems(container: HTMLElement, renderedUrls: Set<string>) {
    container.querySelectorAll('.result-item').forEach((item) => {
        if (!(item instanceof HTMLElement)) return;
        const el = item;
        const urlKey = el.dataset['urlKey'];
        if (!urlKey) return;
        if (renderedUrls.has(urlKey)) el.classList.add('no-animate');
        else renderedUrls.add(urlKey);
    });
}

function attachSentinel(container: HTMLElement, source: 'commercial' | 'noncommercial' | 'merged') {
    const sentinelKey =
        source === 'commercial' ? 'commercialSentinel' : source === 'noncommercial' ? 'noncommercialSentinel' : 'mergedSentinel';
    const observerKey =
        source === 'commercial' ? 'commercialObserver' : source === 'noncommercial' ? 'noncommercialObserver' : 'mergedObserver';
    const sentinel = window.sentinels?.[sentinelKey];
    const observer = window.scrollObservers?.[observerKey];
    if (!sentinel || !observer) return;
    const existingSentinel = container.querySelector('.scroll-sentinel');
    if (existingSentinel) {
        observer.unobserve(existingSentinel);
        existingSentinel.remove();
    }
    const newSentinel = sentinel.cloneNode(false);
    if (!(newSentinel instanceof HTMLElement)) return;
    container.appendChild(newSentinel);
    observer.observe(newSentinel);
}

function showLoading(container: HTMLElement) {
    container.innerHTML = generateSkeletonHTML(5);
}

function generateSkeletonHTML(count = 5) {
    return Array(count)
        .fill(0)
        .map(
            () => `
        <article class="skeleton-item">
            <div class="skeleton-url-row"><div class="skeleton-favicon"></div><div class="skeleton-url"></div><div class="skeleton-tag"></div></div>
            <div class="skeleton-title"></div>
            <div class="skeleton-snippet"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
        </article>
    `
        )
        .join('');
}

function showLoadingMore(container: HTMLElement) {
    removeLoadingMore(container);
    const loadingEl = document.createElement('div');
    loadingEl.className = 'loading-more';
    loadingEl.innerHTML = `<div class="loading-spinner small"></div><span>Loading more...</span>`;
    container.appendChild(loadingEl);
}

function removeLoadingMore(container: HTMLElement) {
    const loadingEl = container.querySelector('.loading-more');
    if (loadingEl) loadingEl.remove();
}

function updateCount(element: HTMLElement, count: number, hasMore: boolean) {
    element.textContent = hasMore ? `${count}+ results` : `${count} results`;
}

function createPage1Settled(_deps?: SearchDeps): Record<Page1Source, boolean> {
    return {
        brave: false,
        google: false,
        // Always wait for aggregate's tavily section (empty when server has no key).
        tavily: false,
        marginalia: false,
        wiby: false,
    };
}

function parseSearchResult(value: unknown): SearchResult | null {
    const record = asRecord(value);
    if (!record) return null;
    const title = readString(record, 'title');
    const url = readString(record, 'url');
    if (!title || !url) return null;
    const result: SearchResult = { title, url };
    const displayUrl = readString(record, 'displayUrl');
    if (displayUrl !== undefined) result.displayUrl = displayUrl;
    const snippet = readString(record, 'snippet');
    if (snippet !== undefined) result.snippet = snippet;
    const source = readString(record, 'source');
    if (source !== undefined) result.source = source;
    return result;
}

function parseSourcePayload(value: unknown): SourcePayload | undefined {
    if (!isRecord(value)) return undefined;
    const error = readString(value, 'error');
    const resultsRaw = readArray(value, 'results');
    if (!resultsRaw) {
        // Error-only payloads (results omitted) still count as a settled source section.
        if (error === undefined) return undefined;
        return { results: [], hasMore: false, error };
    }
    const results = resultsRaw.flatMap((r) => {
        const result = parseSearchResult(r);
        return result ? [result] : [];
    });
    const payload: SourcePayload = {
        hasMore: readBoolean(value, 'hasMore') ?? false,
        results,
    };
    if (error !== undefined) payload.error = error;
    const correctedQuery = readString(value, 'correctedQuery');
    if (correctedQuery !== undefined) payload.correctedQuery = correctedQuery;
    const htmlCorrectedQuery = readString(value, 'htmlCorrectedQuery');
    if (htmlCorrectedQuery !== undefined) payload.htmlCorrectedQuery = htmlCorrectedQuery;
    return payload;
}

const SEARCH_API_KEYS: Array<keyof SearchApiResponse> = ['brave', 'google', 'tavily', 'marginalia', 'wiby'];

function parseSearchApiResponse(value: unknown): SearchApiResponse {
    if (!isRecord(value)) return {};
    const out: SearchApiResponse = {};
    for (const key of SEARCH_API_KEYS) {
        const payload = parseSourcePayload(value[key]);
        if (payload) out[key] = payload;
    }
    return out;
}
