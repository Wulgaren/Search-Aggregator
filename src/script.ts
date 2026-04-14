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
    if (url.pathname === '/api/search' && (!init?.method || init.method === 'GET')) {
        if (isGoogleClientSearchUrl(url)) return cachedGoogleSearchGet(url.pathname + url.search);
        return fetch(url.toString());
    }
    return fetch(url.toString(), init);
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
const mergedResultsContainer = byId('merged-results');

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
        hasPendingStoredPosition: () => elementPositionBeforeContent !== null,
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

function getActiveResultsRoot() {
    return window.innerWidth <= 900 ? mergedResultsContainer : resultsContainer;
}

function storeResultAnchor(resultItem: HTMLElement) {
    elementPositionBeforeContent = {
        element: resultItem,
        viewportTop: resultItem.getBoundingClientRect().top,
        activeResultUrlKey: resultItem.dataset.urlKey,
    };
}

function storeElementPositionBeforeContent(options?: { allowFallbackAnchor?: boolean }) {
    const allowFallbackAnchor = options?.allowFallbackAnchor ?? false;
    const elementAtMouse =
        mousePosition.isInsideResults && mousePosition.x !== null && mousePosition.y !== null
            ? document.elementFromPoint(mousePosition.x, mousePosition.y)
            : null;
    const resultItem = elementAtMouse?.closest('.result-item[data-url-key]') as HTMLElement | null;
    const activeResultsRoot = getActiveResultsRoot();
    const firstFullyVisibleResult = Array.from(activeResultsRoot.querySelectorAll('.result-item[data-url-key]')).find((item) => {
        const rect = (item as HTMLElement).getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
    }) as HTMLElement | undefined;
    const resultsRect = activeResultsRoot.getBoundingClientRect();
    const sampleX = Math.min(Math.max(resultsRect.left + 24, window.innerWidth / 2), resultsRect.right - 24);
    const sampleY = Math.min(Math.max(resultsRect.top + 24, window.innerHeight * 0.4), resultsRect.bottom - 24);
    const sampleResult = document
        .elementFromPoint(sampleX, sampleY)
        ?.closest('.result-item[data-url-key]') as HTMLElement | null;
    const topVisibleResult = Array.from(activeResultsRoot.querySelectorAll('.result-item[data-url-key]')).find((item) => {
        const rect = (item as HTMLElement).getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
    }) as HTMLElement | undefined;
    if (resultItem) {
        storeResultAnchor(resultItem);
        return;
    }

    const fallbackResult = allowFallbackAnchor ? sampleResult ?? firstFullyVisibleResult ?? topVisibleResult ?? null : null;
    if (fallbackResult) {
        storeResultAnchor(fallbackResult);
        return;
    }

    if (!elementAtMouse) {
        elementPositionBeforeContent = null;
        return;
    }

    elementPositionBeforeContent = { element: elementAtMouse, viewportTop: elementAtMouse.getBoundingClientRect().top };
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
        targetElement = getActiveResultsRoot().querySelector(`.result-item[data-url-key="${safeKey}"]`) ?? null;
    }

    if (!targetElement) {
        elementPositionBeforeContent = null;
        return;
    }

    const moved = targetElement.getBoundingClientRect().top - viewportTopStored;
    const scrollYBefore = window.scrollY;
    if (Math.abs(moved) > 1) window.scrollTo({ top: scrollYBefore + moved, behavior: 'auto' });
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
            if (nowMerged) searchResults.forceRenderMergedIfNeeded();
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
