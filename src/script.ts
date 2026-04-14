import { apiSettings, getApiSecret } from './api-keys';
import {
    createCachedGoogleSearchGet,
    handleGoogleSearchRequest,
    isGoogleClientSearchUrl,
} from './google-search';
import type { EarlyFetchKey, ElementPositionBeforeContent, MousePosition } from './types';
import { createAIComponent } from './ai';
import { createImagesComponent } from './images';
import { createInfoboxComponent } from './infobox';
import { createSearchResultsComponent } from './search-results';

const cachedGoogleSearchGet = createCachedGoogleSearchGet((request) => handleGoogleSearchRequest(request));

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el as T;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = new URL(path, window.location.origin);
    const mock = await getMockResponse(url);
    if (mock) return mock;
    if (url.pathname === '/api/search' && (!init?.method || init.method === 'GET')) {
        if (isGoogleClientSearchUrl(url)) return cachedGoogleSearchGet(url.pathname + url.search);
        return fetch(url.toString());
    }
    return fetch(url.toString(), init);
}

async function getMockResponse(url: URL): Promise<Response | null> {
    if (url.pathname !== '/api/search') return null;
    const query = url.searchParams.get('q') ?? '';
    if (query !== 'mock-scroll') return null;

    const source = url.searchParams.get('source') ?? '';
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const imageSource = url.searchParams.get('imageSource') ?? '';
    const json = (payload: unknown) =>
        new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const makeWebResult = (kind: string, idx: number) => ({
        title: `${kind} mock result ${idx}`,
        url: `https://example.com/${kind.toLowerCase()}/${idx}`,
        displayUrl: `example.com/${kind.toLowerCase()}/${idx}`,
        snippet: `Mock ${kind.toLowerCase()} snippet ${idx} for scroll restoration testing.`,
        source: kind,
    });

    const range = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);

    if (source === 'brave') {
        const perPage = 12;
        const start = (page - 1) * perPage + 1;
        return json({
            brave: {
                hasMore: page < 4,
                results: range(start, perPage).map((i) => makeWebResult('Brave', i)),
            },
        });
    }

    if (source === 'google') {
        const perPage = 12;
        const start = (page - 1) * perPage + 1;
        return json({
            google: {
                hasMore: page < 3,
                results: range(start, perPage).map((i) => makeWebResult('Google', i)),
            },
        });
    }

    if (source === 'marginalia') {
        const perPage = 12;
        const start = (page - 1) * perPage + 1;
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 650 + page * 150);
        });
        return json({
            marginalia: {
                hasMore: page < 4,
                results: range(start, perPage).map((i) => makeWebResult('Marginalia', i)),
            },
        });
    }

    if (source === 'infobox') {
        return json({
            infobox: {
                title: 'Mock Scroll Topic',
                description: 'Local mock infobox for debugging scroll anchor restore behavior.',
                image: '',
                imageFull: '',
                links: [
                    { name: 'Mock Source', url: 'https://example.com/mock-scroll', icon: 'M' },
                    { name: 'Debug Notes', url: 'https://example.com/mock-scroll/debug', icon: 'D' },
                ],
                url: 'https://example.com/mock-scroll',
            },
        });
    }

    if (source === 'images') {
        const perPage = 16;
        const start = (page - 1) * perPage + 1;
        return json({
            hasMore: page < 3,
            images: range(start, perPage).map((i) => ({
                thumbnail: `https://picsum.photos/seed/${imageSource || 'mix'}-${i}/320/200`,
                full: `https://picsum.photos/seed/${imageSource || 'mix'}-${i}/1200/800`,
                title: `Mock image ${i}`,
                sourceUrl: `https://example.com/image/${i}`,
                width: 1200,
                height: 800,
                source: imageSource || 'mixed',
            })),
        });
    }

    return json({});
}

function detectBang(query: string) {
    return /^![\w]+(?:\s|$)|\s![\w]+$/.test(query);
}

function handleBangRedirect(query: string) {
    window.location.href = `https://unduck.link?q=${encodeURIComponent(query)}`;
}

function maybeClearEarlyFetch(): void {
    const early = window.__earlyFetch;
    if (!early) return;
    if (early.brave || early.google || early.marginalia || early.images || early.infobox) return;
    window.__earlyFetch = undefined;
}

function takeEarlyFetchPromise(key: EarlyFetchKey, query: string): Promise<Response> | null {
    const early = window.__earlyFetch;
    if (!early || early.query !== query) return null;
    const promise = early[key];
    if (!promise) return null;
    delete early[key];
    maybeClearEarlyFetch();
    return promise;
}

async function takeEarlyFetch(key: EarlyFetchKey, query: string): Promise<Response | null> {
    const promise = takeEarlyFetchPromise(key, query);
    return promise ? await promise : null;
}

(function startEarlyClientFetch() {
    const q = new URLSearchParams(window.location.search).get('q');
    if (!q) return;
    if (detectBang(q)) {
        handleBangRedirect(q);
        return;
    }
    const base = `/api/search?q=${encodeURIComponent(q)}&page=1&source=`;
    const hasGoogle = Boolean(getApiSecret('GOOGLE_SERVICE_ACCOUNT')) && Boolean(getApiSecret('GOOGLE_CX'));
    const enc = encodeURIComponent(q);
    const imgGoogle = `/api/search?q=${enc}&source=images&imageSource=google&page=1`;
    const imgGooglePromise = hasGoogle ? apiFetch(imgGoogle) : null;
    window.__earlyFetch = {
        query: q,
        brave: apiFetch(base + 'brave'),
        ...(hasGoogle && imgGooglePromise ? { google: apiFetch(base + 'google'), images: imgGooglePromise } : {}),
        marginalia: apiFetch(base + 'marginalia'),
        infobox: apiFetch(`/api/search?q=${enc}&source=infobox`),
    };
})();

const searchForm = byId<HTMLFormElement>('search-form');
const searchInput = byId<HTMLInputElement>('search-input');
const resultsContainer = byId('results');

const searchResults = createSearchResultsComponent(
    {
        commercialResults: byId('commercial-results'),
        noncommercialResults: byId('noncommercial-results'),
        mergedResults: byId('merged-results'),
        commercialCount: byId('commercial-count'),
        noncommercialCount: byId('noncommercial-count'),
    },
    {
        apiFetch,
        takeEarlyFetch: (key, query) => takeEarlyFetch(key, query),
        isMergedView: () => window.innerWidth <= 900,
        openApiSettingsDialog: apiSettings.openApiSettingsDialog,
        storeElementPositionBeforeContent,
        maintainMousePosition,
    }
);

let mousePosition: MousePosition = { x: null, y: null, isInsideResults: false };
let elementPositionBeforeContent: ElementPositionBeforeContent | null = null;

function setupMouseTracking() {
    const updateTrackedPoint = (clientX: number, clientY: number) => {
        const rect = resultsContainer.getBoundingClientRect();
        const isInside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
        mousePosition = { x: isInside ? clientX : null, y: isInside ? clientY : null, isInsideResults: isInside };
    };

    document.addEventListener('mousemove', (e) => {
        updateTrackedPoint(e.clientX, e.clientY);
    });

    document.addEventListener(
        'touchstart',
        (e) => {
            const t = e.touches[0] ?? e.changedTouches[0];
            if (!t) return;
            updateTrackedPoint(t.clientX, t.clientY);
        },
        { passive: true }
    );

    document.addEventListener(
        'touchmove',
        (e) => {
            const t = e.touches[0] ?? e.changedTouches[0];
            if (!t) return;
            updateTrackedPoint(t.clientX, t.clientY);
        },
        { passive: true }
    );

    document.addEventListener(
        'touchend',
        (e) => {
            const t = e.changedTouches[0];
            if (!t) return;
            updateTrackedPoint(t.clientX, t.clientY);
        },
        { passive: true }
    );
}

function storeElementPositionBeforeContent() {
    const elementAtMouse =
        mousePosition.isInsideResults && mousePosition.x !== null && mousePosition.y !== null
            ? document.elementFromPoint(mousePosition.x, mousePosition.y)
            : null;
    if (!elementAtMouse) {
        elementPositionBeforeContent = null;
        // #region agent log
        fetch('http://127.0.0.1:7589/ingest/3a4c1100-2d5a-4039-8531-2ecb3e82e8f2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '41bf7a' },
            body: JSON.stringify({
                sessionId: '41bf7a',
                location: 'script.ts:storeElementPositionBeforeContent',
                message: 'store anchor',
                data: { hypothesisId: 'A', outcome: 'no-elementAtMouse', inside: mousePosition.isInsideResults },
                timestamp: Date.now(),
            }),
        }).catch(() => {});
        // #endregion
        return;
    }
    // Prefer preserving the whole result card (mobile/touch users often aren't "hovering" the `a` itself).
    const resultItem = elementAtMouse.closest('.result-item[data-url-key]') as HTMLElement | null;
    if (resultItem) {
        elementPositionBeforeContent = {
            element: resultItem,
            viewportTop: resultItem.getBoundingClientRect().top,
            activeResultUrlKey: resultItem.dataset.urlKey,
        };
        // #region agent log
        fetch('http://127.0.0.1:7589/ingest/3a4c1100-2d5a-4039-8531-2ecb3e82e8f2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '41bf7a' },
            body: JSON.stringify({
                sessionId: '41bf7a',
                location: 'script.ts:storeElementPositionBeforeContent',
                message: 'store anchor',
                data: {
                    hypothesisId: 'A',
                    outcome: 'card',
                    viewportTop: elementPositionBeforeContent.viewportTop,
                    keyLen: (elementPositionBeforeContent.activeResultUrlKey ?? '').length,
                },
                timestamp: Date.now(),
            }),
        }).catch(() => {});
        // #endregion
        return;
    }

    elementPositionBeforeContent = { element: elementAtMouse, viewportTop: elementAtMouse.getBoundingClientRect().top };
    // #region agent log
    fetch('http://127.0.0.1:7589/ingest/3a4c1100-2d5a-4039-8531-2ecb3e82e8f2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '41bf7a' },
        body: JSON.stringify({
            sessionId: '41bf7a',
            location: 'script.ts:storeElementPositionBeforeContent',
            message: 'store anchor',
            data: { hypothesisId: 'A', outcome: 'raw-element', tag: elementAtMouse.nodeName },
            timestamp: Date.now(),
        }),
    }).catch(() => {});
    // #endregion
}

function maintainMousePosition() {
    if (!elementPositionBeforeContent) return;
    const storedElement = elementPositionBeforeContent.element;
    const activeResultUrlKey = elementPositionBeforeContent.activeResultUrlKey;
    const viewportTopStored = elementPositionBeforeContent.viewportTop;

    let targetElement: Element | null = null;
    if (storedElement && document.contains(storedElement)) targetElement = storedElement;

    // The stored element might have been replaced during re-render (e.g. infinite scroll).
    // If we have a stable result key, try to re-find the same card.
    let usedRefind = false;
    if (!targetElement && activeResultUrlKey) {
        usedRefind = true;
        const safeKey = CSS.escape(activeResultUrlKey);
        targetElement = document.querySelector(`.result-item[data-url-key="${safeKey}"]`) ?? null;
    }

    if (!targetElement) {
        // #region agent log
        fetch('http://127.0.0.1:7589/ingest/3a4c1100-2d5a-4039-8531-2ecb3e82e8f2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '41bf7a' },
            body: JSON.stringify({
                sessionId: '41bf7a',
                location: 'script.ts:maintainMousePosition',
                message: 'no target for restore',
                data: {
                    hypothesisId: 'B',
                    usedRefind,
                    hadStoredInDom: storedElement ? document.contains(storedElement) : false,
                    keyLen: (activeResultUrlKey ?? '').length,
                },
                timestamp: Date.now(),
            }),
        }).catch(() => {});
        // #endregion
        elementPositionBeforeContent = null;
        return;
    }

    const moved = targetElement.getBoundingClientRect().top - viewportTopStored;
    const scrollYBefore = window.scrollY;
    if (moved > 1) window.scrollTo({ top: scrollYBefore + moved, behavior: 'auto' });
    // #region agent log
    fetch('http://127.0.0.1:7589/ingest/3a4c1100-2d5a-4039-8531-2ecb3e82e8f2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '41bf7a' },
        body: JSON.stringify({
            sessionId: '41bf7a',
            location: 'script.ts:maintainMousePosition',
            message: 'restore applied',
            data: {
                hypothesisId: 'C',
                usedRefind,
                moved,
                thresholdPass: moved > 1,
                scrollYBefore,
                scrollYAfter: window.scrollY,
                targetTop: targetElement.getBoundingClientRect().top,
            },
            timestamp: Date.now(),
        }),
    }).catch(() => {});
    // #endregion
    elementPositionBeforeContent = null;
}

function escapeHtml(text: string) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const images = createImagesComponent(
    {
        imageSection: byId('image-section'),
        sliderTrack: byId('slider-track'),
        imagePreview: byId('image-preview'),
        previewImage: byId<HTMLImageElement>('preview-image'),
        previewInfo: byId('preview-info'),
        previewClose: byId<HTMLButtonElement>('preview-close'),
        previewOverlay: byId('preview-overlay'),
        previewPrev: byId<HTMLButtonElement>('preview-prev'),
        previewNext: byId<HTMLButtonElement>('preview-next'),
        previewCounter: byId('preview-counter'),
    },
    { apiFetch, takeEarlyFetch: (k, q) => takeEarlyFetch(k, q), escapeHtml, storeElementPositionBeforeContent, maintainMousePosition }
);

const infobox = createInfoboxComponent(
    {
        infobox: byId('infobox'),
        infoboxImage: byId<HTMLImageElement>('infobox-image'),
        infoboxTitle: byId('infobox-title'),
        infoboxDescription: byId('infobox-description'),
        infoboxLinks: byId('infobox-links'),
        infoboxSource: byId<HTMLAnchorElement>('infobox-source'),
    },
    {
        apiFetch,
        takeEarlyFetch: (k, q) => takeEarlyFetch(k, q),
        storeElementPositionBeforeContent,
        maintainMousePosition,
        openImagePreview: images.openImagePreview,
    }
);

const ai = createAIComponent(
    {
        aiBtn: byId<HTMLButtonElement>('ai-btn'),
        aiPanel: byId('ai-panel'),
        aiPanelClose: byId<HTMLButtonElement>('ai-panel-close'),
        aiLoading: byId('ai-loading'),
        aiAnswer: byId('ai-answer'),
        aiPanelFooter: byId('ai-panel-footer'),
        aiSources: byId('ai-sources'),
    },
    { apiFetch, escapeHtml }
);

function performSearch(query: string) {
    searchResults.startSearch(query);
    images.reset();
    infobox.reset();
    ai.reset();
    searchResults.fetchGoogle(query);
    void infobox.fetchInfobox(query);
    void images.fetchImages(query, 1);
}

function restoreSearchState() {
    const query = new URLSearchParams(window.location.search).get('q');
    const setInputValue = (value: string, focus: boolean) => {
        const doSet = () => {
            searchInput.value = value;
            if (focus && value) {
                searchInput.focus();
                const len = value.length;
                searchInput.setSelectionRange(len, len);
            } else searchInput.blur();
        };
        doSet();
        requestAnimationFrame(() => requestAnimationFrame(() => searchInput.value !== value && doSet()));
    };

    if (query) {
        if (detectBang(query)) {
            handleBangRedirect(query);
            return;
        }
        setInputValue(query, false);
        document.title = `${query} - Search`;
        if (!searchResults.getCurrentQuery() || searchResults.getCurrentQuery() !== query) performSearch(query);
    } else {
        setInputValue('', true);
        document.title = 'Search';
        searchResults.reset();
        images.reset();
        infobox.reset();
        ai.reset();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    apiSettings.setupApiSettingsPanel();
    apiSettings.maybeNotifyMissingCommercialKeys();
    searchResults.initInfiniteScroll();
    setupMouseTracking();
    ai.setupEvents(() => searchInput.value);
    images.setupEvents(() => searchResults.getCurrentQuery());
    restoreSearchState();
    let wasMerged = window.innerWidth <= 900;
    window.addEventListener('resize', () => {
        const nowMerged = window.innerWidth <= 900;
        if (wasMerged !== nowMerged && searchResults.getCurrentQuery()) {
            searchResults.forceRenderMergedIfNeeded();
            wasMerged = nowMerged;
        }
    });
});

document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
    }
});

searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    if (detectBang(query)) {
        handleBangRedirect(query);
        return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('q', query);
    window.history.pushState({}, '', url);
    restoreSearchState();
});

window.addEventListener('popstate', restoreSearchState);
window.addEventListener('pageshow', (e) => {
    if (e.persisted) restoreSearchState();
});
