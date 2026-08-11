import { apiSettings, hasGoogleSearchConfigured, hasTavilySearchConfigured } from './api-keys';
import { resolveQueryForBangHandling, redirectForBang } from './query-bangs';
import { searchApiFetch as apiFetch } from './search-fetch';
import type { EarlyFetchKey } from './types';
import { createAIComponent } from './ai';
import { createImagesComponent } from './images';
import { createInfoboxComponent } from './infobox';
import { createSearchResultsComponent } from './search-results';

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el as T;
}

function shouldAutoOpenAIForQuery(query: string): boolean {
    return query.trim().endsWith('?');
}

function maybeClearEarlyFetch(): void {
    const early = window.__earlyFetch;
    if (!early) return;
    if (
        early.brave ||
        early.google ||
        early.tavily ||
        early.marginalia ||
        early.wiby ||
        early.images ||
        early.infobox
    )
        return;
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

const searchForm = byId<HTMLFormElement>('search-form');
const searchInput = byId<HTMLInputElement>('search-input');
const spellBanner = byId('spell-banner');
let bypassGoogleCorrectionForQuery: string | null = null;

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
        hasGoogleSearchConfigured,
        hasTavilySearchConfigured,
        openApiSettingsDialog: apiSettings.openApiSettingsDialog,
        onGoogleCorrection: handleGoogleCorrection,
    }
);

function scrollToPageTop() {
    window.scrollTo({ top: 0, behavior: 'auto' });
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
    { apiFetch, takeEarlyFetch: (k, q) => takeEarlyFetch(k, q), escapeHtml }
);

const infobox = createInfoboxComponent(
    {
        infoboxBtn: byId<HTMLButtonElement>('infobox-btn'),
        infobox: byId('infobox'),
        infoboxImage: byId<HTMLImageElement>('infobox-image'),
        infoboxTitle: byId('infobox-title'),
        infoboxDescription: byId('infobox-description'),
        infoboxCast: byId('infobox-cast'),
        infoboxLinks: byId('infobox-links'),
        infoboxSource: byId<HTMLAnchorElement>('infobox-source'),
    },
    {
        apiFetch,
        takeEarlyFetch: (k, q) => takeEarlyFetch(k, q),
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
    if (hasGoogleSearchConfigured()) searchResults.fetchGoogle(query);
    if (hasTavilySearchConfigured()) searchResults.fetchTavily(query);
    void infobox.fetchInfobox(query);
    void images.fetchImages(query, 1);
    if (shouldAutoOpenAIForQuery(query)) {
        void ai.fetchAIAnswer(query, { toggleWhenLoading: false });
    }
}

function renderSpellBanner(original: string, corrected: string | null) {
    if (!corrected || corrected === original) {
        spellBanner.hidden = true;
        spellBanner.textContent = '';
        return;
    }
    spellBanner.hidden = false;
    spellBanner.innerHTML = '';

    const showing = document.createElement('div');
    showing.className = 'spell-banner-line spell-banner-showing';
    showing.append('Showing results for ');
    const correctedStrong = document.createElement('strong');
    correctedStrong.textContent = corrected;
    showing.appendChild(correctedStrong);

    const instead = document.createElement('div');
    instead.className = 'spell-banner-line spell-banner-instead';
    instead.append('Search instead for ');
    const originalLink = document.createElement('a');
    originalLink.href = '#';
    originalLink.className = 'spell-banner-revert';
    originalLink.dataset.searchInstead = original;
    originalLink.textContent = original;
    instead.appendChild(originalLink);

    spellBanner.append(showing, instead);
}

function handleGoogleCorrection(query: string, correctedQuery: string) {
    if (!correctedQuery || correctedQuery === query) return;
    if (bypassGoogleCorrectionForQuery === query) {
        bypassGoogleCorrectionForQuery = null;
        return;
    }

    renderSpellBanner(query, correctedQuery);
    if (searchResults.getCurrentQuery() === correctedQuery) return;
    scrollToPageTop();
    performSearch(correctedQuery);
}

function restoreSearchState(options?: { scrollToTop?: boolean }) {
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
        const resolved = resolveQueryForBangHandling(query);
        if (resolved.kind === 'redirect') {
            redirectForBang(resolved.q);
            return;
        }
        const q = resolved.q;
        if (q !== query) {
            const url = new URL(window.location.href);
            url.searchParams.set('q', q);
            window.history.replaceState({}, '', url);
        }
        if (!q.trim()) {
            setInputValue('', true);
            document.title = 'Search';
            renderSpellBanner('', null);
            searchResults.reset();
            images.reset();
            infobox.reset();
            ai.reset();
            return;
        }
        setInputValue(q, false);
        renderSpellBanner('', null);
        document.title = `${q} - Search`;
        if (!searchResults.getCurrentQuery() || searchResults.getCurrentQuery() !== q) {
            if (options?.scrollToTop) scrollToPageTop();
            performSearch(q);
        }
    } else {
        setInputValue('', true);
        document.title = 'Search';
        renderSpellBanner('', null);
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
    ai.setupEvents(() => searchInput.value);
    infobox.setupEvents();
    images.setupEvents(() => searchResults.getCurrentQuery());
    restoreSearchState({ scrollToTop: true });
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

spellBanner.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const link = target?.closest('[data-search-instead]') as HTMLAnchorElement | null;
    if (!link) return;

    e.preventDefault();
    const query = link.dataset.searchInstead;
    if (!query) return;

    bypassGoogleCorrectionForQuery = query;
    searchInput.value = query;
    renderSpellBanner('', null);
    const url = new URL(window.location.href);
    url.searchParams.set('q', query);
    window.history.pushState({}, '', url);
    restoreSearchState({ scrollToTop: true });
});

searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = searchInput.value.trim();
    if (!raw) return;
    const resolved = resolveQueryForBangHandling(raw);
    if (resolved.kind === 'redirect') {
        redirectForBang(resolved.q);
        return;
    }
    const query = resolved.q;
    if (!query.trim()) {
        const url = new URL(window.location.href);
        url.searchParams.delete('q');
        window.history.pushState({}, '', url);
        restoreSearchState();
        return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('q', query);
    window.history.pushState({}, '', url);
    restoreSearchState({ scrollToTop: true });
});

window.addEventListener('popstate', () => restoreSearchState());
window.addEventListener('pageshow', (e) => {
    if (e.persisted) restoreSearchState();
});
