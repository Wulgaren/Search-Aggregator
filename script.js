// DOM Elements
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const googleResults = document.getElementById('google-results');
const marginaliaResults = document.getElementById('marginalia-results');
const googleCount = document.getElementById('google-count');
const marginaliaCount = document.getElementById('marginalia-count');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check for query in URL
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');
    if (query) {
        searchInput.value = query;
        performSearch(query);
    }
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

async function performSearch(query) {
    // Show loading states
    showLoading(googleResults);
    showLoading(marginaliaResults);
    googleCount.textContent = '';
    marginaliaCount.textContent = '';

    try {
        const response = await fetch(`/.netlify/functions/search?q=${encodeURIComponent(query)}`);
        
        if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
        }

        const data = await response.json();

        // Render Google results
        if (data.google.error) {
            showError(googleResults, data.google.error);
        } else {
            renderResults(googleResults, data.google.results);
            googleCount.textContent = `${data.google.results.length} results`;
        }

        // Render Marginalia results
        if (data.marginalia.error) {
            showError(marginaliaResults, data.marginalia.error);
        } else {
            renderResults(marginaliaResults, data.marginalia.results);
            marginaliaCount.textContent = `${data.marginalia.results.length} results`;
        }

    } catch (error) {
        console.error('Search error:', error);
        showError(googleResults, error.message);
        showError(marginaliaResults, error.message);
    }
}

function renderResults(container, results) {
    if (!results || results.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No results found</p>
            </div>
        `;
        return;
    }

    container.innerHTML = results.map((result, index) => `
        <article class="result-item" style="animation-delay: ${index * 0.05}s">
            <div class="result-url">${escapeHtml(result.displayUrl || getDomain(result.url))}</div>
            <h3 class="result-title">
                <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener">${escapeHtml(result.title)}</a>
            </h3>
            ${result.snippet ? `<p class="result-snippet">${escapeHtml(result.snippet)}</p>` : ''}
        </article>
    `).join('');
}

function showLoading(container) {
    container.innerHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <span class="loading-text">Searching...</span>
        </div>
    `;
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

