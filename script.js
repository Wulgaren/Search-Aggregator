// DOM Elements
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const commercialResults = document.getElementById('commercial-results');
const noncommercialResults = document.getElementById('noncommercial-results');
const mergedResults = document.getElementById('merged-results');
const commercialCount = document.getElementById('commercial-count');
const noncommercialCount = document.getElementById('noncommercial-count');

// State - track each source separately
let currentQuery = '';
let braveState = { page: 1, hasMore: true, loading: false, results: [], error: null };
let googleState = { page: 1, hasMore: true, loading: false, results: [], error: null };
let marginaliaState = { page: 1, hasMore: true, loading: false, results: [], error: null };
let mergedState = { loading: false };

// Check if we're in mobile merged view
function isMergedView() {
    return window.innerWidth <= 700;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');
    if (query) {
        searchInput.value = query;
        performSearch(query);
    }
    setupInfiniteScroll();

    let wasMerged = isMergedView();
    window.addEventListener('resize', () => {
        const nowMerged = isMergedView();
        if (wasMerged !== nowMerged && currentQuery) {
            if (nowMerged) renderMergedResults();
            wasMerged = nowMerged;
        }
    });
});

// Keyboard shortcut: / to focus search
document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
    }
});

// Form submission
searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
        const url = new URL(window.location);
        url.searchParams.set('q', query);
        window.history.pushState({}, '', url);
        performSearch(query);
    }
});

// Handle browser back/forward
window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');
    if (query) {
        searchInput.value = query;
        performSearch(query);
    } else {
        searchInput.value = '';
        resetResults();
    }
});

function setupInfiniteScroll() {
    const observerOptions = { root: null, rootMargin: '100px', threshold: 0 };

    const commercialSentinel = document.createElement('div');
    commercialSentinel.className = 'scroll-sentinel';
    commercialSentinel.id = 'commercial-sentinel';

    const noncommercialSentinel = document.createElement('div');
    noncommercialSentinel.className = 'scroll-sentinel';
    noncommercialSentinel.id = 'noncommercial-sentinel';

    const mergedSentinel = document.createElement('div');
    mergedSentinel.className = 'scroll-sentinel';
    mergedSentinel.id = 'merged-sentinel';

    const commercialObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && currentQuery && !isMergedView()) {
                loadMoreCommercial();
            }
        });
    }, observerOptions);

    const noncommercialObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !marginaliaState.loading && marginaliaState.hasMore && currentQuery && !isMergedView()) {
                loadMoreMarginalia();
            }
        });
    }, observerOptions);

    const mergedObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !mergedState.loading && currentQuery && isMergedView()) {
                loadMoreMergedResults();
            }
        });
    }, observerOptions);

    window.scrollObservers = { commercialObserver, noncommercialObserver, mergedObserver };
    window.sentinels = { commercialSentinel, noncommercialSentinel, mergedSentinel };
}

async function performSearch(query) {
    // Reset all state
    currentQuery = query;
    braveState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    googleState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    marginaliaState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    mergedState = { loading: false };

    // Show loading states
    showLoading(commercialResults);
    showLoading(noncommercialResults);
    showLoading(mergedResults);
    commercialCount.textContent = '';
    noncommercialCount.textContent = '';

    // Fetch all sources independently - don't wait for all
    fetchSource('brave', query, 1);
    fetchSource('google', query, 1);
    fetchSource('marginalia', query, 1);
}

async function fetchSource(source, query, page) {
    const state = getState(source);
    state.loading = true;

    try {
        const response = await fetch(
            `/.netlify/functions/search?q=${encodeURIComponent(query)}&page=${page}&source=${source}`
        );

        if (!response.ok) throw new Error(`Search failed: ${response.status}`);

        const data = await response.json();
        const sourceData = data[source];

        if (sourceData?.error) {
            state.hasMore = false;
            state.error = sourceData.error;
            console.error(`Error from ${source}:`, sourceData.error);
        } else if (sourceData) {
            state.hasMore = sourceData.hasMore;
            state.results = [...state.results, ...sourceData.results];
            state.error = null;
        }

        // Always render when data arrives (even if one source has an error, others may have results)
        if (source === 'marginalia') {
            renderNoncommercialResults();
        } else {
            renderCommercialResults();
        }

        if (isMergedView()) {
            renderMergedResults();
        }
    } catch (error) {
        console.error(`Error fetching ${source}:`, error);
        state.hasMore = false;
        state.error = error.message;
        
        // Still render to show other source results and error state
        if (source === 'marginalia') {
            renderNoncommercialResults();
        } else {
            renderCommercialResults();
        }

        if (isMergedView()) {
            renderMergedResults();
        }
    } finally {
        state.loading = false;
    }
}

function getState(source) {
    if (source === 'brave') return braveState;
    if (source === 'google') return googleState;
    return marginaliaState;
}

function renderCommercialResults() {
    // Interleave Brave and Google results
    const interleaved = interleaveArrays(braveState.results, googleState.results);

    // Build error messages for sources that failed
    let errorHtml = '';
    if (braveState.error) {
        errorHtml += `<div class="source-error"><span class="error-source">Brave:</span> ${escapeHtml(braveState.error)}</div>`;
    }
    if (googleState.error) {
        errorHtml += `<div class="source-error"><span class="error-source">Google:</span> ${escapeHtml(googleState.error)}</div>`;
    }

    if (interleaved.length === 0 && !braveState.loading && !googleState.loading) {
        if (errorHtml) {
            commercialResults.innerHTML = `<div class="error-state">${errorHtml}</div>`;
        } else {
            commercialResults.innerHTML = `<div class="empty-state"><p>No results found</p></div>`;
        }
        return;
    }

    const html = interleaved.map((result, index) => {
        const source = result.source || 'brave';
        return `
        <article class="result-item" data-source="${source}" style="animation-delay: ${index * 0.02}s">
            <div class="result-source-tag">${source === 'brave' ? 'Brave' : 'Google'}</div>
            <div class="result-url">${escapeHtml(result.displayUrl || getDomain(result.url))}</div>
            <h3 class="result-title">
                <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener">${escapeHtml(result.title)}</a>
            </h3>
            ${result.snippet ? `<p class="result-snippet">${escapeHtml(result.snippet)}</p>` : ''}
        </article>
    `}).join('');

    // Show errors at the top if any source failed
    commercialResults.innerHTML = (errorHtml ? `<div class="error-state compact">${errorHtml}</div>` : '') + html;

    const totalResults = braveState.results.length + googleState.results.length;
    const hasMore = braveState.hasMore || googleState.hasMore;
    updateCount(commercialCount, totalResults, hasMore);

    if (hasMore) {
        attachSentinel(commercialResults, 'commercial');
    }
}

function renderNoncommercialResults() {
    const results = marginaliaState.results;

    if (results.length === 0 && !marginaliaState.loading) {
        if (marginaliaState.error) {
            noncommercialResults.innerHTML = `
                <div class="error-state">
                    <span class="error-icon">⚠</span>
                    <span class="error-message">Something went wrong</span>
                    <span class="error-detail">${escapeHtml(marginaliaState.error)}</span>
                </div>
            `;
        } else {
            noncommercialResults.innerHTML = `<div class="empty-state"><p>No results found</p></div>`;
        }
        return;
    }

    let errorHtml = '';
    if (marginaliaState.error) {
        errorHtml = `<div class="error-state compact"><div class="source-error"><span class="error-source">Marginalia:</span> ${escapeHtml(marginaliaState.error)}</div></div>`;
    }

    const html = results.map((result, index) => `
        <article class="result-item" style="animation-delay: ${index * 0.02}s">
            <div class="result-url">${escapeHtml(result.displayUrl || getDomain(result.url))}</div>
            <h3 class="result-title">
                <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener">${escapeHtml(result.title)}</a>
            </h3>
            ${result.snippet ? `<p class="result-snippet">${escapeHtml(result.snippet)}</p>` : ''}
        </article>
    `).join('');

    noncommercialResults.innerHTML = errorHtml + html;
    updateCount(noncommercialCount, results.length, marginaliaState.hasMore);

    if (marginaliaState.hasMore) {
        attachSentinel(noncommercialResults, 'noncommercial');
    }
}

function interleaveArrays(arr1, arr2) {
    const result = [];
    const maxLen = Math.max(arr1.length, arr2.length);

    for (let i = 0; i < maxLen; i++) {
        if (i < arr1.length) result.push(arr1[i]);
        if (i < arr2.length) result.push(arr2[i]);
    }

    return result;
}

async function loadMoreCommercial() {
    const braveNeedsMore = braveState.hasMore && !braveState.loading;
    const googleNeedsMore = googleState.hasMore && !googleState.loading;

    if (!braveNeedsMore && !googleNeedsMore) return;

    showLoadingMore(commercialResults);

    const promises = [];
    if (braveNeedsMore) {
        braveState.page += 1;
        promises.push(fetchSource('brave', currentQuery, braveState.page));
    }
    if (googleNeedsMore) {
        googleState.page += 1;
        promises.push(fetchSource('google', currentQuery, googleState.page));
    }

    await Promise.all(promises);
    removeLoadingMore(commercialResults);
}

async function loadMoreMarginalia() {
    if (marginaliaState.loading || !marginaliaState.hasMore) return;

    showLoadingMore(noncommercialResults);
    marginaliaState.page += 1;
    await fetchSource('marginalia', currentQuery, marginaliaState.page);
    removeLoadingMore(noncommercialResults);
}

async function loadMoreMergedResults() {
    const braveNeedsMore = braveState.hasMore && !braveState.loading;
    const googleNeedsMore = googleState.hasMore && !googleState.loading;
    const marginaliaNeedsMore = marginaliaState.hasMore && !marginaliaState.loading;

    if (!braveNeedsMore && !googleNeedsMore && !marginaliaNeedsMore) return;

    mergedState.loading = true;
    showLoadingMore(mergedResults);

    const promises = [];
    if (braveNeedsMore) {
        braveState.page += 1;
        promises.push(fetchSource('brave', currentQuery, braveState.page));
    }
    if (googleNeedsMore) {
        googleState.page += 1;
        promises.push(fetchSource('google', currentQuery, googleState.page));
    }
    if (marginaliaNeedsMore) {
        marginaliaState.page += 1;
        promises.push(fetchSource('marginalia', currentQuery, marginaliaState.page));
    }

    await Promise.all(promises);
    removeLoadingMore(mergedResults);
    mergedState.loading = false;
}

function renderMergedResults() {
    // Interleave commercial (Brave+Google interleaved) with Marginalia
    const commercial = interleaveArrays(braveState.results, googleState.results);
    const noncommercial = marginaliaState.results;

    const allResults = [];
    const maxLen = Math.max(commercial.length, noncommercial.length);

    for (let i = 0; i < maxLen; i++) {
        if (i < commercial.length) {
            allResults.push({ type: 'commercial', result: commercial[i] });
        }
        if (i < noncommercial.length) {
            allResults.push({ type: 'noncommercial', result: noncommercial[i] });
        }
    }

    if (allResults.length === 0) {
        mergedResults.innerHTML = `<div class="empty-state"><p>No results found</p></div>`;
        return;
    }

    const html = allResults.map((item, index) => {
        const sourceLabel = item.type === 'commercial'
            ? (item.result.source === 'brave' ? 'Brave' : 'Google')
            : 'Marginalia';
        const dataSource = item.type === 'commercial' ? 'commercial' : 'noncommercial';

        return `
            <article class="result-item" data-source="${dataSource}" style="animation-delay: ${index * 0.02}s">
                <div class="result-source">${sourceLabel}</div>
                <div class="result-url">${escapeHtml(item.result.displayUrl || getDomain(item.result.url))}</div>
                <h3 class="result-title">
                    <a href="${escapeHtml(item.result.url)}" target="_blank" rel="noopener">${escapeHtml(item.result.title)}</a>
                </h3>
                ${item.result.snippet ? `<p class="result-snippet">${escapeHtml(item.result.snippet)}</p>` : ''}
            </article>
        `;
    }).join('');

    mergedResults.innerHTML = html;

    const hasMore = braveState.hasMore || googleState.hasMore || marginaliaState.hasMore;
    if (hasMore) {
        attachSentinel(mergedResults, 'merged');
    }
}

function attachSentinel(container, source) {
    const sentinelKey = source === 'commercial' ? 'commercialSentinel' :
        source === 'noncommercial' ? 'noncommercialSentinel' : 'mergedSentinel';
    const observerKey = source === 'commercial' ? 'commercialObserver' :
        source === 'noncommercial' ? 'noncommercialObserver' : 'mergedObserver';

    const sentinel = window.sentinels[sentinelKey];
    const observer = window.scrollObservers[observerKey];

    const existingSentinel = container.querySelector('.scroll-sentinel');
    if (existingSentinel) {
        observer.unobserve(existingSentinel);
        existingSentinel.remove();
    }

    const newSentinel = sentinel.cloneNode();
    container.appendChild(newSentinel);
    observer.observe(newSentinel);
}

function showLoading(container) {
    container.innerHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <span class="loading-text">Searching...</span>
        </div>
    `;
}

function showLoadingMore(container) {
    removeLoadingMore(container);
    const loadingEl = document.createElement('div');
    loadingEl.className = 'loading-more';
    loadingEl.innerHTML = `<div class="loading-spinner small"></div><span>Loading more...</span>`;
    container.appendChild(loadingEl);
}

function removeLoadingMore(container) {
    const loadingEl = container.querySelector('.loading-more');
    if (loadingEl) loadingEl.remove();
}

function updateCount(element, count, hasMore) {
    element.textContent = hasMore ? `${count}+ results` : `${count} results`;
}

function showError(container, message) {
    container.innerHTML = `
        <div class="error-state">
            <span class="error-icon">⚠</span>
            <span class="error-message">Something went wrong</span>
            <span class="error-detail">${escapeHtml(message)}</span>
        </div>
    `;
}

function resetResults() {
    currentQuery = '';
    braveState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    googleState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    marginaliaState = { page: 1, hasMore: true, loading: false, results: [], error: null };
    mergedState = { loading: false };

    commercialResults.innerHTML = `<div class="empty-state"><p>Commercial results will appear here</p></div>`;
    noncommercialResults.innerHTML = `<div class="empty-state"><p>Non-commercial results will appear here</p></div>`;
    mergedResults.innerHTML = `<div class="empty-state"><p>Search results will appear here</p></div>`;
    commercialCount.textContent = '';
    noncommercialCount.textContent = '';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}
