import type {
    MergedItem,
    SearchApiResponse,
    SearchDeps,
    SearchResult,
    SearchResultsElements,
    SourceState,
} from './types';
import { redirectToGoogleSearch } from './query-bangs';

export function createSearchResultsComponent(elements: SearchResultsElements, deps: SearchDeps) {
    let currentQuery = '';
    let searchSessionId = 0;
    let braveState: SourceState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    let googleState: SourceState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    let marginaliaState: SourceState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    let wibyState: SourceState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    let mergedState = { loading: false };
    let suppressMergedAnimations = false;
    let renderedCommercialUrls = new Set<string>();
    let renderedNoncommercialUrls = new Set<string>();
    let renderedMergedUrls = new Set<string>();
    let googleFallbackRedirected = false;

    function reset() {
        searchSessionId += 1;
        currentQuery = '';
        braveState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        googleState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        marginaliaState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        wibyState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        mergedState = { loading: false };
        renderedCommercialUrls = new Set();
        renderedNoncommercialUrls = new Set();
        renderedMergedUrls = new Set();
        googleFallbackRedirected = false;
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

    function renderMergedResultsPreservingPosition() {
        const shouldPreservePosition = deps.isMergedView() && window.scrollY > 0;
        const reusingPendingAnchor = shouldPreservePosition && deps.hasPendingStoredPosition();
        if (shouldPreservePosition && !reusingPendingAnchor) {
            deps.storeElementPositionBeforeContent({ allowFallbackAnchor: true });
        }
        suppressMergedAnimations = shouldPreservePosition;
        renderMergedResults();
        suppressMergedAnimations = false;
        if (shouldPreservePosition) {
            requestAnimationFrame(() => {
                deps.maintainMousePosition();
            });
        }
    }

    async function fetchSource(source: 'brave' | 'google' | 'marginalia' | 'wiby', query: string, page: number, sessionId: number) {
        if (sessionId !== searchSessionId || query !== currentQuery) return;
        const state = getState(source);
        state.loading = true;
        try {
            let response: Response;
            if (page === 1) {
                const early = await deps.takeEarlyFetch(source, query);
                response = early ?? (await deps.apiFetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}&source=${source}`));
            } else {
                response = await deps.apiFetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}&source=${source}`);
            }
            if (!response.ok) throw new Error(`Search failed: ${response.status}`);
            const data = (await response.json()) as SearchApiResponse;
            if (sessionId !== searchSessionId || query !== currentQuery) return;
            const sourceData = data[source];
            if (sourceData?.error) {
                state.hasMore = false;
                state.error = sourceData.error;
                if (source === 'google' && shouldOpenGoogleSettings(String(sourceData.error))) {
                    if (!maybeRedirectToGoogleFallback(query, sessionId, page)) {
                        deps.openApiSettingsDialog(String(sourceData.error));
                    }
                }
            } else if (sourceData) {
                state.hasMore = sourceData.hasMore;
                state.results = [...state.results, ...sourceData.results];
                state.error = null;
                if (source === 'google' && page === 1 && sourceData.correctedQuery && sourceData.correctedQuery !== query) {
                    deps.onGoogleCorrection?.(query, sourceData.correctedQuery);
                }
            }
            if (source === 'google') applyBraveFallback(data, page, sessionId, query);
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            state.hasMore = false;
            state.error = errMsg;
            if (source === 'google' && shouldOpenGoogleSettings(errMsg)) {
                if (!maybeRedirectToGoogleFallback(query, sessionId, page)) {
                    deps.openApiSettingsDialog(errMsg);
                }
            }
        } finally {
            if (sessionId === searchSessionId && query === currentQuery) state.loading = false;
        }

        if (sessionId !== searchSessionId || query !== currentQuery) return;
        if ((source === 'brave' || source === 'google') && page === 1) {
            maybeRedirectToGoogleFallback(query, sessionId, page);
        }
        if (source === 'marginalia' || source === 'wiby') renderNoncommercialResults();
        else {
            renderCommercialResults();
            if (!deps.isMergedView() && (marginaliaState.results.length > 0 || wibyState.results.length > 0))
                renderNoncommercialResults();
        }
        if (deps.isMergedView()) {
            renderMergedResultsPreservingPosition();
        }
    }

    function startSearch(query: string) {
        currentQuery = query;
        searchSessionId += 1;
        const sessionId = searchSessionId;
        braveState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        googleState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        marginaliaState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        wibyState = { page: 1, hasMore: true, loading: false, results: [], error: null };
        mergedState = { loading: false };
        renderedCommercialUrls = new Set();
        renderedNoncommercialUrls = new Set();
        renderedMergedUrls = new Set();
        googleFallbackRedirected = false;
        showLoading(elements.commercialResults);
        showLoading(elements.noncommercialResults);
        showLoading(elements.mergedResults);
        elements.commercialCount.textContent = '';
        elements.noncommercialCount.textContent = '';
        void fetchSource('brave', query, 1, sessionId);
        void fetchSource('marginalia', query, 1, sessionId);
        void fetchSource('wiby', query, 1, sessionId);
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
        if (braveState.loading || googleState.loading) return false;
        if (braveState.results.length > 0 || googleState.results.length > 0) return false;

        const googleConfigured = deps.hasGoogleSearchConfigured();
        const braveFailed = Boolean(braveState.error);
        const googleFailed = googleConfigured ? Boolean(googleState.error) : true;
        if (!braveFailed || !googleFailed) return false;

        googleFallbackRedirected = true;
        redirectToGoogleSearch(query);
        return true;
    }

    function fetchGoogle(query: string) {
        if (currentQuery === query) void fetchSource('google', query, 1, searchSessionId);
    }

    function forceRenderMergedIfNeeded() {
        if (deps.isMergedView() && currentQuery) renderMergedResults();
    }

    function getCurrentQuery() {
        return currentQuery;
    }

    async function loadMoreCommercial() {
        const braveNeedsMore = braveState.hasMore && !braveState.loading;
        const googleNeedsMore = googleState.hasMore && !googleState.loading;
        if (!braveNeedsMore && !googleNeedsMore) return;
        deps.storeElementPositionBeforeContent();
        showLoadingMore(elements.commercialResults);
        const promises: Promise<void>[] = [];
        if (braveNeedsMore) {
            braveState.page += 1;
            promises.push(fetchSource('brave', currentQuery, braveState.page, searchSessionId));
        }
        if (googleNeedsMore) {
            googleState.page += 1;
            promises.push(fetchSource('google', currentQuery, googleState.page, searchSessionId));
        }
        await Promise.all(promises);
        removeLoadingMore(elements.commercialResults);
        requestAnimationFrame(() => deps.maintainMousePosition());
    }

    async function loadMoreNoncommercial() {
        if (marginaliaState.loading || wibyState.loading) return;
        if (!marginaliaState.hasMore && !wibyState.hasMore) return;
        deps.storeElementPositionBeforeContent();
        showLoadingMore(elements.noncommercialResults);
        const promises: Promise<void>[] = [];
        if (marginaliaState.hasMore && !marginaliaState.loading) {
            marginaliaState.page += 1;
            promises.push(fetchSource('marginalia', currentQuery, marginaliaState.page, searchSessionId));
        }
        if (wibyState.hasMore && !wibyState.loading) {
            wibyState.page += 1;
            promises.push(fetchSource('wiby', currentQuery, wibyState.page, searchSessionId));
        }
        await Promise.all(promises);
        removeLoadingMore(elements.noncommercialResults);
        requestAnimationFrame(() => deps.maintainMousePosition());
    }

    async function loadMoreMergedResults() {
        const braveNeedsMore = braveState.hasMore && !braveState.loading;
        const googleNeedsMore = googleState.hasMore && !googleState.loading;
        const marginaliaNeedsMore = marginaliaState.hasMore && !marginaliaState.loading;
        const wibyNeedsMore = wibyState.hasMore && !wibyState.loading;
        if (!braveNeedsMore && !googleNeedsMore && !marginaliaNeedsMore && !wibyNeedsMore) return;
        mergedState.loading = true;
        deps.storeElementPositionBeforeContent({ allowFallbackAnchor: true });
        showLoadingMore(elements.mergedResults);
        const promises: Promise<void>[] = [];
        if (braveNeedsMore) {
            braveState.page += 1;
            promises.push(fetchSource('brave', currentQuery, braveState.page, searchSessionId));
        }
        if (googleNeedsMore) {
            googleState.page += 1;
            promises.push(fetchSource('google', currentQuery, googleState.page, searchSessionId));
        }
        if (marginaliaNeedsMore) {
            marginaliaState.page += 1;
            promises.push(fetchSource('marginalia', currentQuery, marginaliaState.page, searchSessionId));
        }
        if (wibyNeedsMore) {
            wibyState.page += 1;
            promises.push(fetchSource('wiby', currentQuery, wibyState.page, searchSessionId));
        }
        await Promise.all(promises);
        removeLoadingMore(elements.mergedResults);
        mergedState.loading = false;
        requestAnimationFrame(() => {
            deps.maintainMousePosition();
        });
    }

    function renderCommercialResults() {
        const interleaved = deduplicateResults(interleaveArrays(googleState.results, braveState.results));
        const anyLoading = braveState.loading || googleState.loading;
        if (interleaved.length === 0) {
            if (!anyLoading) {
                elements.commercialResults.innerHTML =
                    googleState.error && braveState.error
                        ? `<div class="error-state"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`
                        : `<div class="empty-state"><p>No results found</p></div>`;
            }
            return;
        }
        elements.commercialResults.innerHTML = interleaved
            .map((result, index) => {
                const dataSource = result.source || 'brave';
                return renderStandardResultArticle(result, index, dataSource, dataSource === 'google' ? 'Google' : 'Brave');
            })
            .join('');
        applyNoAnimateToRenderedItems(elements.commercialResults, renderedCommercialUrls);
        attachPrefetchListeners(elements.commercialResults);
        const totalResults = braveState.results.length + googleState.results.length;
        updateCount(elements.commercialCount, totalResults, braveState.hasMore || googleState.hasMore);
        if (braveState.hasMore || googleState.hasMore) attachSentinel(elements.commercialResults, 'commercial');
    }

    function renderNoncommercialResults() {
        const combinedRaw = deduplicateResults(interleaveArrays(marginaliaState.results, wibyState.results));
        const commercialUrls = new Set<string>();
        for (const result of googleState.results) commercialUrls.add(getDedupeKey(result.url));
        for (const result of braveState.results) commercialUrls.add(getDedupeKey(result.url));
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
        const combinedNc = deduplicateResults(interleaveArrays(marginaliaState.results, wibyState.results));
        const allResults: MergedItem[] = [];
        const seen = new Set<string>();
        const maxLen = Math.max(googleState.results.length, braveState.results.length, combinedNc.length);
        for (let i = 0; i < maxLen; i++) {
            if (i < googleState.results.length) maybePushMerged('commercial', googleState.results[i], seen, allResults);
            if (i < combinedNc.length) maybePushMerged('noncommercial', combinedNc[i], seen, allResults);
            if (i < braveState.results.length) maybePushMerged('commercial', braveState.results[i], seen, allResults);
        }
        const anyLoading = braveState.loading || googleState.loading || marginaliaState.loading || wibyState.loading;
        const allErrors = Boolean(googleState.error && marginaliaState.error && braveState.error && wibyState.error);
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
                            : 'Brave'
                        : item.result.source === 'wiby'
                          ? 'Wiby'
                          : 'Marginalia';
                return renderStandardResultArticle(
                    item.result,
                    index,
                    item.type === 'commercial' ? 'commercial' : 'noncommercial',
                    sourceLabel,
                    'result-source',
                    !suppressMergedAnimations
                );
            })
            .join('');
        applyNoAnimateToRenderedItems(elements.mergedResults, renderedMergedUrls);
        attachPrefetchListeners(elements.mergedResults);
        if (braveState.hasMore || googleState.hasMore || marginaliaState.hasMore || wibyState.hasMore)
            attachSentinel(elements.mergedResults, 'merged');
    }

    function maybePushMerged(type: 'commercial' | 'noncommercial', result: SearchResult, seen: Set<string>, allResults: MergedItem[]) {
        const key = getDedupeKey(result.url);
        if (seen.has(key)) return;
        seen.add(key);
        allResults.push({ type, result, urlKey: key });
    }

    function getState(source: 'brave' | 'google' | 'marginalia' | 'wiby') {
        if (source === 'brave') return braveState;
        if (source === 'google') return googleState;
        if (source === 'wiby') return wibyState;
        return marginaliaState;
    }

    return { reset, initInfiniteScroll, startSearch, fetchGoogle, forceRenderMergedIfNeeded, getCurrentQuery };
}

function isPermanentGoogleApiError(message: string): boolean {
    if (!message || typeof message !== 'string') return false;
    const m = message.toLowerCase();
    if (m.includes('does not have the access to custom search')) return true;
    if (m.includes('custom search json api')) return true;
    if (m.includes('quota exceeded') || m.includes('daily limit')) return true;
    if (m.includes('billing') && m.includes('enable')) return true;
    return false;
}

function shouldOpenGoogleSettings(message: string): boolean {
    return isAuthLikeApiError(message) && !isPermanentGoogleApiError(message);
}

function isAuthLikeApiError(message: string): boolean {
    if (!message || typeof message !== 'string') return false;
    const m = message.toLowerCase();
    if (m.includes('401') || m.includes('403')) return true;
    if (m.includes('unauthorized') || m.includes('forbidden')) return true;
    if (m.includes('not configured')) return true;
    if (m.includes('invalid') && (m.includes('key') || m.includes('token') || m.includes('credential'))) return true;
    if (m.includes('token exchange failed')) return true;
    if (m.includes('api key')) return true;
    if (m.includes('authentication')) return true;
    return false;
}

function interleaveArrays(arr1: SearchResult[], arr2: SearchResult[]): SearchResult[] {
    const result: SearchResult[] = [];
    const maxLen = Math.max(arr1.length, arr2.length);
    for (let i = 0; i < maxLen; i++) {
        if (i < arr1.length) result.push(arr1[i]);
        if (i < arr2.length) result.push(arr2[i]);
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
            if (child.nodeType === Node.ELEMENT_NODE) {
                const el = child as Element;
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
    if (s === 'google' || s === 'brave' || s === 'marginalia' || s === 'wiby') return s;
    if (dataSource === 'google' || dataSource === 'brave' || dataSource === 'marginalia' || dataSource === 'wiby') return dataSource;
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
        const a = link as HTMLAnchorElement;
        const url = a.href;
        a.addEventListener('mousedown', () => prefetchLink(url), { once: true });
        a.addEventListener('touchstart', () => setTimeout(() => prefetchLink(url), 0), { once: true, passive: true });
    });
}

function applyNoAnimateToRenderedItems(container: HTMLElement, renderedUrls: Set<string>) {
    container.querySelectorAll('.result-item').forEach((item) => {
        const el = item as HTMLElement;
        const urlKey = el.dataset.urlKey;
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
    const sentinel = window.sentinels![sentinelKey];
    const observer = window.scrollObservers![observerKey];
    const existingSentinel = container.querySelector('.scroll-sentinel');
    if (existingSentinel) {
        observer.unobserve(existingSentinel);
        existingSentinel.remove();
    }
    const newSentinel = sentinel.cloneNode(false) as HTMLElement;
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
