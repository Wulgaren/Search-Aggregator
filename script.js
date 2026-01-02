// DOM Elements
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const googleResults = document.getElementById('google-results');
const marginaliaResults = document.getElementById('marginalia-results');
const googleCount = document.getElementById('google-count');
const marginaliaCount = document.getElementById('marginalia-count');

// State
let currentQuery = '';
let googleState = { page: 1, hasMore: true, loading: false, totalResults: 0 };
let marginaliaState = { page: 1, hasMore: true, loading: false, totalResults: 0 };

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
    // Use Intersection Observer for each column
    const observerOptions = {
        root: null,
        rootMargin: '100px',
        threshold: 0
    };

    // Create sentinel elements for each column
    const googleSentinel = document.createElement('div');
    googleSentinel.className = 'scroll-sentinel';
    googleSentinel.id = 'google-sentinel';

    const marginaliaSentinel = document.createElement('div');
    marginaliaSentinel.className = 'scroll-sentinel';
    marginaliaSentinel.id = 'marginalia-sentinel';

    // Observer for Google results
    const googleObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !googleState.loading && googleState.hasMore && currentQuery) {
                loadMoreResults('google');
            }
        });
    }, observerOptions);

    // Observer for Marginalia results
    const marginaliaObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !marginaliaState.loading && marginaliaState.hasMore && currentQuery) {
                loadMoreResults('marginalia');
            }
        });
    }, observerOptions);

    // Store observers and sentinels globally
    window.scrollObservers = { googleObserver, marginaliaObserver };
    window.sentinels = { googleSentinel, marginaliaSentinel };
}

async function performSearch(query) {
    // Reset state for new search
    currentQuery = query;
    googleState = { page: 1, hasMore: true, loading: false, totalResults: 0 };
    marginaliaState = { page: 1, hasMore: true, loading: false, totalResults: 0 };

    // Show loading states
    showLoading(googleResults);
    showLoading(marginaliaResults);
    googleCount.textContent = '';
    marginaliaCount.textContent = '';

    try {
        const response = await fetch(`/.netlify/functions/search?q=${encodeURIComponent(query)}&page=1`);

        if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
        }

        const data = await response.json();

        // Render Google results
        if (data.google?.error) {
            showError(googleResults, data.google.error);
            googleState.hasMore = false;
        } else if (data.google) {
            googleState.hasMore = data.google.hasMore;
            googleState.totalResults = data.google.results.length;
            renderResults(googleResults, data.google.results, false);
            updateCount(googleCount, googleState.totalResults, googleState.hasMore);
            attachSentinel(googleResults, 'google');
        }

        // Render Marginalia results
        if (data.marginalia?.error) {
            showError(marginaliaResults, data.marginalia.error);
            marginaliaState.hasMore = false;
        } else if (data.marginalia) {
            marginaliaState.hasMore = data.marginalia.hasMore;
            marginaliaState.totalResults = data.marginalia.results.length;
            renderResults(marginaliaResults, data.marginalia.results, false);
            updateCount(marginaliaCount, marginaliaState.totalResults, marginaliaState.hasMore);
            attachSentinel(marginaliaResults, 'marginalia');
        }

    } catch (error) {
        console.error('Search error:', error);
        showError(googleResults, error.message);
        showError(marginaliaResults, error.message);
    }
}

async function loadMoreResults(source) {
    const state = source === 'google' ? googleState : marginaliaState;
    const container = source === 'google' ? googleResults : marginaliaResults;
    const countEl = source === 'google' ? googleCount : marginaliaCount;

    if (state.loading || !state.hasMore) return;

    state.loading = true;
    state.page += 1;

    // Show loading indicator at bottom
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

        // Remove loading indicator
        removeLoadingMore(container);

        if (sourceData?.error) {
            state.hasMore = false;
        } else if (sourceData) {
            state.hasMore = sourceData.hasMore;
            state.totalResults += sourceData.results.length;

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

function attachSentinel(container, source) {
    const sentinel = window.sentinels[source === 'google' ? 'googleSentinel' : 'marginaliaSentinel'];
    const observer = window.scrollObservers[source === 'google' ? 'googleObserver' : 'marginaliaObserver'];

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
    // Remove sentinel before appending
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
    // Remove any existing loading-more element
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
    googleState = { page: 1, hasMore: true, loading: false, totalResults: 0 };
    marginaliaState = { page: 1, hasMore: true, loading: false, totalResults: 0 };

    googleResults.innerHTML = `
        <div class="empty-state">
            <p>Google results will appear here</p>
        </div>
    `;
    marginaliaResults.innerHTML = `
        <div class="empty-state">
            <p>Marginalia results will appear here</p>
        </div>
    `;
    googleCount.textContent = '';
    marginaliaCount.textContent = '';
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
