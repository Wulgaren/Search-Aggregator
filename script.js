// DOM Elements
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const commercialResults = document.getElementById('commercial-results');
const noncommercialResults = document.getElementById('noncommercial-results');
const mergedResults = document.getElementById('merged-results');
const commercialCount = document.getElementById('commercial-count');
const noncommercialCount = document.getElementById('noncommercial-count');

// State
let currentQuery = '';
let commercialState = { page: 1, hasMore: true, loading: false, totalResults: 0, results: [] };
let noncommercialState = { page: 1, hasMore: true, loading: false, totalResults: 0, results: [] };
let mergedState = { loading: false };

// Check if we're in mobile merged view
function isMergedView() {
    return window.innerWidth <= 700;
}

// Prefetch on mousedown - fires ~100ms before click completes
function setupPrefetching() {
    document.getElementById('results').addEventListener('mousedown', (e) => {
        const link = e.target.closest('.result-title a');
        if (link?.href && e.button === 0) { // Left click only
            const prefetch = document.createElement('link');
            prefetch.rel = 'prefetch';
            prefetch.href = link.href;
            document.head.appendChild(prefetch);
        }
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check for query in URL
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');
    if (query) {
        searchInput.value = query;
        performSearch(query);
    }

    // Set up scroll listeners for infinite scroll
    setupInfiniteScroll();

    // Set up link prefetching on hover
    setupPrefetching();

    // Re-render on resize if crossing the breakpoint
    let wasMerged = isMergedView();
    window.addEventListener('resize', () => {
        const nowMerged = isMergedView();
        if (wasMerged !== nowMerged && currentQuery) {
            if (nowMerged) {
                renderMergedResults();
            }
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
        // Update URL without reload
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
    const observerOptions = {
        root: null,
        rootMargin: '100px',
        threshold: 0
    };

    // Create sentinel elements
    const commercialSentinel = document.createElement('div');
    commercialSentinel.className = 'scroll-sentinel';
    commercialSentinel.id = 'commercial-sentinel';

    const noncommercialSentinel = document.createElement('div');
    noncommercialSentinel.className = 'scroll-sentinel';
    noncommercialSentinel.id = 'noncommercial-sentinel';

    const mergedSentinel = document.createElement('div');
    mergedSentinel.className = 'scroll-sentinel';
    mergedSentinel.id = 'merged-sentinel';

    // Observer for commercial results
    const commercialObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !commercialState.loading && commercialState.hasMore && currentQuery && !isMergedView()) {
                loadMoreResults('commercial');
            }
        });
    }, observerOptions);

    // Observer for noncommercial results
    const noncommercialObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !noncommercialState.loading && noncommercialState.hasMore && currentQuery && !isMergedView()) {
                loadMoreResults('noncommercial');
            }
        });
    }, observerOptions);

    // Observer for merged results
    const mergedObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !mergedState.loading && currentQuery && isMergedView()) {
                loadMoreMergedResults();
            }
        });
    }, observerOptions);

    // Store observers and sentinels globally
    window.scrollObservers = { commercialObserver, noncommercialObserver, mergedObserver };
    window.sentinels = { commercialSentinel, noncommercialSentinel, mergedSentinel };
}

async function performSearch(query) {
    // Reset state for new search
    currentQuery = query;
    commercialState = { page: 1, hasMore: true, loading: false, totalResults: 0, results: [] };
    noncommercialState = { page: 1, hasMore: true, loading: false, totalResults: 0, results: [] };
    mergedState = { loading: false };

    // Show loading states
    showLoading(commercialResults);
    showLoading(noncommercialResults);
    showLoading(mergedResults);
    commercialCount.textContent = '';
    noncommercialCount.textContent = '';

    try {
        const response = await fetch(`/.netlify/functions/search?q=${encodeURIComponent(query)}&page=1`);

        if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
        }

        const data = await response.json();

        // Process commercial results
        if (data.commercial?.error) {
            showError(commercialResults, data.commercial.error);
            commercialState.hasMore = false;
        } else if (data.commercial) {
            commercialState.hasMore = data.commercial.hasMore;
            commercialState.totalResults = data.commercial.results.length;
            commercialState.results = data.commercial.results;
            renderResults(commercialResults, data.commercial.results, false);
            updateCount(commercialCount, commercialState.totalResults, commercialState.hasMore);
            attachSentinel(commercialResults, 'commercial');
        }

        // Process noncommercial results
        if (data.noncommercial?.error) {
            showError(noncommercialResults, data.noncommercial.error);
            noncommercialState.hasMore = false;
        } else if (data.noncommercial) {
            noncommercialState.hasMore = data.noncommercial.hasMore;
            noncommercialState.totalResults = data.noncommercial.results.length;
            noncommercialState.results = data.noncommercial.results;
            renderResults(noncommercialResults, data.noncommercial.results, false);
            updateCount(noncommercialCount, noncommercialState.totalResults, noncommercialState.hasMore);
            attachSentinel(noncommercialResults, 'noncommercial');
        }

        // Render merged view if in mobile
        if (isMergedView()) {
            renderMergedResults();
        }

    } catch (error) {
        console.error('Search error:', error);
        showError(commercialResults, error.message);
        showError(noncommercialResults, error.message);
        showError(mergedResults, error.message);
    }
}

async function loadMoreResults(source) {
    const state = source === 'commercial' ? commercialState : noncommercialState;
    const container = source === 'commercial' ? commercialResults : noncommercialResults;
    const countEl = source === 'commercial' ? commercialCount : noncommercialCount;

    if (state.loading || !state.hasMore) return;

    state.loading = true;
    state.page += 1;

    showLoadingMore(container);

    try {
        const response = await fetch(
            `/.netlify/functions/search?q=${encodeURIComponent(currentQuery)}&page=${state.page}&source=${source}`
        );

        if (!response.ok) {
            throw new Error(`Failed to load more: ${response.status}`);
        }

        const data = await response.json();
        const sourceData = data[source];

        removeLoadingMore(container);

        if (sourceData?.error) {
            state.hasMore = false;
        } else if (sourceData) {
            state.hasMore = sourceData.hasMore;
            state.totalResults += sourceData.results.length;
            state.results = [...state.results, ...sourceData.results];

            if (sourceData.results.length > 0) {
                appendResults(container, sourceData.results);
                updateCount(countEl, state.totalResults, state.hasMore);
                attachSentinel(container, source);
            } else {
                state.hasMore = false;
                updateCount(countEl, state.totalResults, false);
            }
        }

    } catch (error) {
        console.error(`Error loading more ${source} results:`, error);
        removeLoadingMore(container);
        state.hasMore = false;
    } finally {
        state.loading = false;
    }
}

async function loadMoreMergedResults() {
    // Load more from whichever source has fewer results (to keep them balanced)
    const commercialNeedsMore = commercialState.hasMore && !commercialState.loading;
    const noncommercialNeedsMore = noncommercialState.hasMore && !noncommercialState.loading;

    if (!commercialNeedsMore && !noncommercialNeedsMore) return;

    mergedState.loading = true;
    showLoadingMore(mergedResults);

    const promises = [];

    if (commercialNeedsMore) {
        promises.push(loadMoreForMerged('commercial'));
    }
    if (noncommercialNeedsMore) {
        promises.push(loadMoreForMerged('noncommercial'));
    }

    await Promise.all(promises);

    removeLoadingMore(mergedResults);
    renderMergedResults(true);
    mergedState.loading = false;
}

async function loadMoreForMerged(source) {
    const state = source === 'commercial' ? commercialState : noncommercialState;

    if (state.loading || !state.hasMore) return;

    state.loading = true;
    state.page += 1;

    try {
        const response = await fetch(
            `/.netlify/functions/search?q=${encodeURIComponent(currentQuery)}&page=${state.page}&source=${source}`
        );

        if (!response.ok) {
            throw new Error(`Failed to load more: ${response.status}`);
        }

        const data = await response.json();
        const sourceData = data[source];

        if (sourceData?.error) {
            state.hasMore = false;
        } else if (sourceData) {
            state.hasMore = sourceData.hasMore;
            state.totalResults += sourceData.results.length;
            state.results = [...state.results, ...sourceData.results];

            // Update count in desktop view too
            const countEl = source === 'commercial' ? commercialCount : noncommercialCount;
            updateCount(countEl, state.totalResults, state.hasMore);
        }

    } catch (error) {
        console.error(`Error loading more ${source} results:`, error);
        state.hasMore = false;
    } finally {
        state.loading = false;
    }
}

function renderMergedResults(append = false) {
    const interleaved = interleaveResults(commercialState.results, noncommercialState.results);

    if (interleaved.length === 0) {
        mergedResults.innerHTML = `
            <div class="empty-state">
                <p>No results found</p>
            </div>
        `;
        return;
    }

    const html = interleaved.map((item, index) => `
        <article class="result-item" data-source="${item.source}" style="animation-delay: ${append ? 0 : index * 0.03}s">
            <div class="result-source">${item.source === 'commercial' ? 'Commercial' : 'Non-commercial'}</div>
            <div class="result-url">${escapeHtml(item.result.displayUrl || getDomain(item.result.url))}</div>
            <h3 class="result-title">
                <a href="${escapeHtml(item.result.url)}" target="_blank" rel="noopener">${escapeHtml(item.result.title)}</a>
            </h3>
            ${item.result.snippet ? `<p class="result-snippet">${escapeHtml(item.result.snippet)}</p>` : ''}
        </article>
    `).join('');

    mergedResults.innerHTML = html;

    // Attach sentinel if there's more to load
    if (commercialState.hasMore || noncommercialState.hasMore) {
        attachSentinel(mergedResults, 'merged');
    }
}

function interleaveResults(commercialArr, noncommercialArr) {
    const result = [];
    const maxLen = Math.max(commercialArr.length, noncommercialArr.length);

    for (let i = 0; i < maxLen; i++) {
        if (i < commercialArr.length) {
            result.push({ source: 'commercial', result: commercialArr[i] });
        }
        if (i < noncommercialArr.length) {
            result.push({ source: 'noncommercial', result: noncommercialArr[i] });
        }
    }

    return result;
}

function attachSentinel(container, source) {
    const sentinelKey = source === 'commercial' ? 'commercialSentinel' :
        source === 'noncommercial' ? 'noncommercialSentinel' : 'mergedSentinel';
    const observerKey = source === 'commercial' ? 'commercialObserver' :
        source === 'noncommercial' ? 'noncommercialObserver' : 'mergedObserver';

    const sentinel = window.sentinels[sentinelKey];
    const observer = window.scrollObservers[observerKey];

    // Remove existing sentinel
    const existingSentinel = container.querySelector('.scroll-sentinel');
    if (existingSentinel) {
        observer.unobserve(existingSentinel);
        existingSentinel.remove();
    }

    // Clone and append new sentinel
    const newSentinel = sentinel.cloneNode();
    container.appendChild(newSentinel);
    observer.observe(newSentinel);
}

function renderResults(container, results, append = false) {
    if (!results || results.length === 0) {
        if (!append) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No results found</p>
                </div>
            `;
        }
        return;
    }

    const html = results.map((result, index) => `
        <article class="result-item" style="animation-delay: ${index * 0.03}s">
            <div class="result-url">${escapeHtml(result.displayUrl || getDomain(result.url))}</div>
            <h3 class="result-title">
                <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener">${escapeHtml(result.title)}</a>
            </h3>
            ${result.snippet ? `<p class="result-snippet">${escapeHtml(result.snippet)}</p>` : ''}
        </article>
    `).join('');

    if (append) {
        container.insertAdjacentHTML('beforeend', html);
    } else {
        container.innerHTML = html;
    }
}

function appendResults(container, results) {
    const sentinel = container.querySelector('.scroll-sentinel');
    if (sentinel) sentinel.remove();

    const html = results.map((result, index) => `
        <article class="result-item" style="animation-delay: ${index * 0.03}s">
            <div class="result-url">${escapeHtml(result.displayUrl || getDomain(result.url))}</div>
            <h3 class="result-title">
                <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener">${escapeHtml(result.title)}</a>
            </h3>
            ${result.snippet ? `<p class="result-snippet">${escapeHtml(result.snippet)}</p>` : ''}
        </article>
    `).join('');

    container.insertAdjacentHTML('beforeend', html);
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
    loadingEl.innerHTML = `
        <div class="loading-spinner small"></div>
        <span>Loading more...</span>
    `;
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
    commercialState = { page: 1, hasMore: true, loading: false, totalResults: 0, results: [] };
    noncommercialState = { page: 1, hasMore: true, loading: false, totalResults: 0, results: [] };
    mergedState = { loading: false };

    commercialResults.innerHTML = `
        <div class="empty-state">
            <p>Commercial results will appear here</p>
        </div>
    `;
    noncommercialResults.innerHTML = `
        <div class="empty-state">
            <p>Non-commercial results will appear here</p>
        </div>
    `;
    mergedResults.innerHTML = `
        <div class="empty-state">
            <p>Search results will appear here</p>
        </div>
    `;
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
