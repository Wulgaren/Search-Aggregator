// DOM Elements
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const commercialResults = document.getElementById('commercial-results');
const noncommercialResults = document.getElementById('noncommercial-results');
const mergedResults = document.getElementById('merged-results');
const commercialCount = document.getElementById('commercial-count');
const noncommercialCount = document.getElementById('noncommercial-count');
const chatgptBtn = document.getElementById('chatgpt-btn');

// Image elements
const imageSection = document.getElementById('image-section');
const sliderTrack = document.getElementById('slider-track');
const sliderPrev = document.getElementById('slider-prev');
const sliderNext = document.getElementById('slider-next');
const viewAllBtn = document.getElementById('view-all-images');
const imageModal = document.getElementById('image-modal');
const modalGrid = document.getElementById('modal-grid');
const modalClose = document.getElementById('modal-close');
const modalOverlay = document.getElementById('modal-overlay');
const imagePreview = document.getElementById('image-preview');
const previewImage = document.getElementById('preview-image');
const previewInfo = document.getElementById('preview-info');
const previewClose = document.getElementById('preview-close');
const previewOverlay = document.getElementById('preview-overlay');

// State - track each source separately
let currentQuery = '';
let braveState = { page: 1, hasMore: true, loading: false, results: [], error: null };
let googleState = { page: 1, hasMore: true, loading: false, results: [], error: null };
let marginaliaState = { page: 1, hasMore: true, loading: false, results: [], error: null };
let mergedState = { loading: false };
let imageState = { images: [], loading: false };

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

// ChatGPT button
chatgptBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) {
        window.open(`https://chat.openai.com/?q=${encodeURIComponent(query)}`, '_blank');
    }
});

// Image slider controls
sliderPrev.addEventListener('click', () => {
    sliderTrack.scrollBy({ left: -300, behavior: 'smooth' });
});

sliderNext.addEventListener('click', () => {
    sliderTrack.scrollBy({ left: 300, behavior: 'smooth' });
});

// View all images button
viewAllBtn.addEventListener('click', () => {
    openImageModal();
});

// Modal close handlers
modalClose.addEventListener('click', closeImageModal);
modalOverlay.addEventListener('click', closeImageModal);

// Preview close handlers
previewClose.addEventListener('click', closeImagePreview);
previewOverlay.addEventListener('click', closeImagePreview);

// ESC key to close modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (imagePreview.classList.contains('active')) {
            closeImagePreview();
        } else if (imageModal.classList.contains('active')) {
            closeImageModal();
        }
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
    imageState = { images: [], loading: false };

    // Show loading states
    showLoading(commercialResults);
    showLoading(noncommercialResults);
    showLoading(mergedResults);
    commercialCount.textContent = '';
    noncommercialCount.textContent = '';

    // Hide image section initially
    imageSection.style.display = 'none';

    // Fetch all sources independently - don't wait for all
    fetchSource('brave', query, 1);
    fetchSource('google', query, 1);
    fetchSource('marginalia', query, 1);
    fetchImages(query);
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
    // Interleave Google first, then Brave (order: Google, Brave)
    const interleaved = deduplicateResults(interleaveArrays(googleState.results, braveState.results));

    // Build error messages for sources that failed
    let errorHtml = '';
    if (googleState.error) {
        errorHtml += `<div class="source-error"><span class="error-source">Google:</span> ${escapeHtml(googleState.error)}</div>`;
    }
    if (braveState.error) {
        errorHtml += `<div class="source-error"><span class="error-source">Brave:</span> ${escapeHtml(braveState.error)}</div>`;
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
            <div class="result-source-tag">${source === 'google' ? 'Google' : 'Brave'}</div>
            <div class="result-url">${escapeHtml(result.displayUrl || getDomain(result.url))}</div>
            <h3 class="result-title">
                <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener">${escapeHtml(result.title)}</a>
            </h3>
            ${result.snippet ? `<p class="result-snippet">${sanitizeSnippet(result.snippet)}</p>` : ''}
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
            ${result.snippet ? `<p class="result-snippet">${sanitizeSnippet(result.snippet)}</p>` : ''}
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

// Deduplicate results based on URL domain + path (ignoring protocol and query params)
function deduplicateResults(results) {
    const seen = new Set();
    return results.filter(result => {
        try {
            const url = new URL(result.url);
            const key = url.hostname + url.pathname.replace(/\/$/, '');
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        } catch {
            return true;
        }
    });
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
    // Interleave in order: Google, Marginalia, Brave (and deduplicate)
    const allResults = [];
    const seen = new Set();
    const maxLen = Math.max(googleState.results.length, marginaliaState.results.length, braveState.results.length);

    for (let i = 0; i < maxLen; i++) {
        // Google first
        if (i < googleState.results.length) {
            const result = googleState.results[i];
            const key = getDedupeKey(result.url);
            if (!seen.has(key)) {
                seen.add(key);
                allResults.push({ type: 'commercial', result });
            }
        }
        // Marginalia second
        if (i < marginaliaState.results.length) {
            const result = marginaliaState.results[i];
            const key = getDedupeKey(result.url);
            if (!seen.has(key)) {
                seen.add(key);
                allResults.push({ type: 'noncommercial', result });
            }
        }
        // Brave third
        if (i < braveState.results.length) {
            const result = braveState.results[i];
            const key = getDedupeKey(result.url);
            if (!seen.has(key)) {
                seen.add(key);
                allResults.push({ type: 'commercial', result });
            }
        }
    }

    // Build error messages for sources that failed (in display order)
    let errorHtml = '';
    if (googleState.error) {
        errorHtml += `<div class="source-error"><span class="error-source">Google:</span> ${escapeHtml(googleState.error)}</div>`;
    }
    if (marginaliaState.error) {
        errorHtml += `<div class="source-error"><span class="error-source">Marginalia:</span> ${escapeHtml(marginaliaState.error)}</div>`;
    }
    if (braveState.error) {
        errorHtml += `<div class="source-error"><span class="error-source">Brave:</span> ${escapeHtml(braveState.error)}</div>`;
    }

    const allLoading = braveState.loading && googleState.loading && marginaliaState.loading;

    if (allResults.length === 0 && !allLoading) {
        if (errorHtml) {
            mergedResults.innerHTML = `<div class="error-state">${errorHtml}</div>`;
        } else {
            mergedResults.innerHTML = `<div class="empty-state"><p>No results found</p></div>`;
        }
        return;
    }

    const html = allResults.map((item, index) => {
        const sourceLabel = item.type === 'commercial'
            ? (item.result.source === 'google' ? 'Google' : 'Brave')
            : 'Marginalia';
        const dataSource = item.type === 'commercial' ? 'commercial' : 'noncommercial';

        return `
            <article class="result-item" data-source="${dataSource}" style="animation-delay: ${index * 0.02}s">
                <div class="result-source">${sourceLabel}</div>
                <div class="result-url">${escapeHtml(item.result.displayUrl || getDomain(item.result.url))}</div>
                <h3 class="result-title">
                    <a href="${escapeHtml(item.result.url)}" target="_blank" rel="noopener">${escapeHtml(item.result.title)}</a>
                </h3>
                ${item.result.snippet ? `<p class="result-snippet">${sanitizeSnippet(item.result.snippet)}</p>` : ''}
            </article>
        `;
    }).join('');

    // Show errors at the top if any source failed
    mergedResults.innerHTML = (errorHtml ? `<div class="error-state compact">${errorHtml}</div>` : '') + html;

    const hasMore = braveState.hasMore || googleState.hasMore || marginaliaState.hasMore;
    if (hasMore) {
        attachSentinel(mergedResults, 'merged');
    }
}

function getDedupeKey(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname + parsed.pathname.replace(/\/$/, '');
    } catch {
        return url;
    }
}

async function fetchImages(query) {
    imageState.loading = true;

    try {
        const response = await fetch(
            `/.netlify/functions/search?q=${encodeURIComponent(query)}&source=images`
        );

        if (!response.ok) throw new Error(`Image search failed: ${response.status}`);

        const data = await response.json();
        imageState.images = data.images || [];

        if (imageState.images.length > 0) {
            renderImageSlider();
            imageSection.style.display = 'block';
        }
    } catch (error) {
        console.error('Error fetching images:', error);
    } finally {
        imageState.loading = false;
    }
}

function renderImageSlider() {
    const images = imageState.images;
    sliderTrack.innerHTML = images.slice(0, 20).map((img, index) => `
        <img 
            class="slider-image" 
            src="${escapeHtml(img.thumbnail)}" 
            alt="${escapeHtml(img.title)}"
            data-index="${index}"
            loading="lazy"
        >
    `).join('');

    // Add click handlers
    sliderTrack.querySelectorAll('.slider-image').forEach(img => {
        img.addEventListener('click', () => {
            const index = parseInt(img.dataset.index);
            openImagePreview(index);
        });
    });
}

function openImageModal() {
    const images = imageState.images;
    modalGrid.innerHTML = images.map((img, index) => `
        <div class="modal-image-container" data-index="${index}">
            <img src="${escapeHtml(img.thumbnail)}" alt="${escapeHtml(img.title)}" loading="lazy">
            <span class="modal-image-source">${img.source}</span>
        </div>
    `).join('');

    // Add click handlers
    modalGrid.querySelectorAll('.modal-image-container').forEach(container => {
        container.addEventListener('click', () => {
            const index = parseInt(container.dataset.index);
            openImagePreview(index);
        });
    });

    imageModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeImageModal() {
    imageModal.classList.remove('active');
    document.body.style.overflow = '';
}

function openImagePreview(index) {
    const img = imageState.images[index];
    if (!img) return;

    previewImage.src = img.full;
    previewImage.alt = img.title;
    previewInfo.innerHTML = `
        <div>${escapeHtml(img.title)}</div>
        ${img.sourceUrl ? `<a href="${escapeHtml(img.sourceUrl)}" target="_blank" rel="noopener">Visit page</a>` : ''}
    `;

    imagePreview.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeImagePreview() {
    imagePreview.classList.remove('active');
    previewImage.src = '';
    if (!imageModal.classList.contains('active')) {
        document.body.style.overflow = '';
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
    imageState = { images: [], loading: false };

    commercialResults.innerHTML = `<div class="empty-state"><p>Commercial results will appear here</p></div>`;
    noncommercialResults.innerHTML = `<div class="empty-state"><p>Non-commercial results will appear here</p></div>`;
    mergedResults.innerHTML = `<div class="empty-state"><p>Search results will appear here</p></div>`;
    commercialCount.textContent = '';
    noncommercialCount.textContent = '';
    imageSection.style.display = 'none';
    sliderTrack.innerHTML = '';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Sanitize HTML - allow only safe tags for snippets
function sanitizeSnippet(html) {
    if (!html) return '';
    
    // Create a temporary element to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Walk through all elements and remove unsafe ones
    const allowedTags = ['b', 'strong', 'i', 'em', 'br', 'span', 'mark'];
    
    function sanitizeNode(node) {
        const children = Array.from(node.childNodes);
        
        for (const child of children) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName.toLowerCase();
                
                if (!allowedTags.includes(tagName)) {
                    // Replace element with its text content
                    const text = document.createTextNode(child.textContent);
                    node.replaceChild(text, child);
                } else {
                    // Remove all attributes except class
                    const attrs = Array.from(child.attributes);
                    for (const attr of attrs) {
                        if (attr.name !== 'class') {
                            child.removeAttribute(attr.name);
                        }
                    }
                    // Recursively sanitize children
                    sanitizeNode(child);
                }
            }
        }
    }
    
    sanitizeNode(temp);
    return temp.innerHTML;
}

function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}
