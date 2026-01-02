// DOM Elements
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const commercialResults = document.getElementById('commercial-results');
const noncommercialResults = document.getElementById('noncommercial-results');
const mergedResults = document.getElementById('merged-results');
const commercialCount = document.getElementById('commercial-count');
const noncommercialCount = document.getElementById('noncommercial-count');
const chatgptBtn = document.getElementById('chatgpt-btn');

// DDG Bang detection - matches !bang with space before/after or at start/end
function detectBang(query) {
    // Pattern: !word at start (followed by space) or at end (preceded by space)
    // Valid: "!g test", "test !g", "!yt video"
    // Invalid: "test !g query" (middle)
    const bangPattern = /(?:^![\w]+\s|\s![\w]+$)/;
    return bangPattern.test(query);
}

// Redirect to unduck.link for bang handling
function handleBangRedirect(query) {
    window.location.href = `https://unduck.link?q=${encodeURIComponent(query)}`;
}

// Prefetch link on mousedown/touchstart for faster navigation
const prefetchedUrls = new Set();
function prefetchLink(url) {
    if (prefetchedUrls.has(url)) return;
    prefetchedUrls.add(url);

    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    document.head.appendChild(link);
}

function attachPrefetchListeners(container) {
    container.querySelectorAll('.result-title a').forEach(link => {
        const url = link.href;
        link.addEventListener('mousedown', () => prefetchLink(url), { once: true });
        link.addEventListener('touchstart', () => prefetchLink(url), { once: true, passive: true });
    });
}

// Image elements
const imageSection = document.getElementById('image-section');
const sliderTrack = document.getElementById('slider-track');
const imagePreview = document.getElementById('image-preview');
const previewImage = document.getElementById('preview-image');
const previewInfo = document.getElementById('preview-info');
const previewClose = document.getElementById('preview-close');
const previewOverlay = document.getElementById('preview-overlay');

// Infobox elements
const infobox = document.getElementById('infobox');
const infoboxImage = document.getElementById('infobox-image');
const infoboxTitle = document.getElementById('infobox-title');
const infoboxDescription = document.getElementById('infobox-description');
const infoboxLinks = document.getElementById('infobox-links');
const infoboxSource = document.getElementById('infobox-source');

// State - track each source separately
let currentQuery = '';
let braveState = { page: 1, hasMore: true, loading: false, results: [], error: null };
let googleState = { page: 1, hasMore: true, loading: false, results: [], error: null };
let marginaliaState = { page: 1, hasMore: true, loading: false, results: [], error: null };
let mergedState = { loading: false };
let imageState = { images: [], loading: false, page: 1, hasMore: true };
let infoboxState = { data: null, loading: false };

// Check if we're in mobile merged view
function isMergedView() {
    return window.innerWidth <= 700;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    restoreSearchState(true);
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
        // Check for DDG bang and redirect if found
        if (detectBang(query)) {
            handleBangRedirect(query);
            return;
        }
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

// Preview close handlers
previewClose.addEventListener('click', closeImagePreview);
previewOverlay.addEventListener('click', closeImagePreview);

// ESC key to close preview
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (imagePreview.classList.contains('active')) {
            closeImagePreview();
        }
    }
});

// Handle browser back/forward
window.addEventListener('popstate', () => {
    restoreSearchState();
});

// Handle bfcache restoration (Safari)
window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
        restoreSearchState();
    }
});

function restoreSearchState(focusInput = false) {
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');

    if (query) {
        // Check for DDG bang and redirect if found
        if (detectBang(query)) {
            handleBangRedirect(query);
            return;
        }

        // Use setTimeout to ensure this runs after Safari's bfcache form restoration
        setTimeout(() => {
            searchInput.value = query;
            if (focusInput) {
                searchInput.focus();
                const len = query.length;
                searchInput.setSelectionRange(len, len);
            }
        }, 0);

        document.title = `${query} - Search`;
        // Only re-search if results are empty (page was restored from bfcache)
        if (!currentQuery || currentQuery !== query) {
            performSearch(query);
        }
    } else {
        // Use setTimeout for Safari bfcache compatibility
        setTimeout(() => {
            searchInput.value = '';
        }, 0);
        document.title = 'Search';
        resetResults();
    }
}

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
    imageState = { images: [], loading: false, page: 1, hasMore: true };
    infoboxState = { data: null, loading: false };

    // Show loading states
    showLoading(commercialResults);
    showLoading(noncommercialResults);
    showLoading(mergedResults);
    commercialCount.textContent = '';
    noncommercialCount.textContent = '';

    // Hide image section and infobox initially
    imageSection.style.display = 'none';
    infobox.style.display = 'none';

    // Fetch all sources independently - don't wait for all
    fetchSource('brave', query, 1);
    fetchSource('google', query, 1);
    fetchSource('marginalia', query, 1);
    fetchImages(query);
    fetchInfobox(query);
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

    } catch (error) {
        console.error(`Error fetching ${source}:`, error);
        state.hasMore = false;
        state.error = error.message;
    } finally {
        state.loading = false;
    }

    // Render after loading state is updated
    if (source === 'marginalia') {
        renderNoncommercialResults();
    } else {
        renderCommercialResults();
    }

    if (isMergedView()) {
        renderMergedResults();
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

    // Log errors to console
    if (googleState.error) {
        console.log('Google error:', googleState.error);
    }
    if (braveState.error) {
        console.log('Brave error:', braveState.error);
    }

    if (interleaved.length === 0 && !braveState.loading && !googleState.loading) {
        if (googleState.error || braveState.error) {
            commercialResults.innerHTML = `<div class="error-state"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`;
        } else {
            commercialResults.innerHTML = `<div class="empty-state"><p>No results found</p></div>`;
        }
        return;
    }

    const html = interleaved.map((result, index) => {
        const source = result.source || 'brave';
        const faviconUrl = getFaviconUrl(result.url);
        return `
        <article class="result-item" data-source="${source}" style="animation-delay: ${index * 0.02}s">
            <div class="result-url-row">
                <img class="result-favicon" src="${escapeHtml(faviconUrl)}" alt="" loading="lazy" onerror="this.classList.add('error')">
                <div class="result-url">${escapeHtml(result.displayUrl || getDomain(result.url))}</div>
                <div class="result-source-tag">${source === 'google' ? 'Google' : 'Brave'}</div>
            </div>
            <h3 class="result-title">
                <a href="${escapeHtml(result.url)}">${escapeHtml(result.title)}</a>
            </h3>
            ${result.snippet ? `<p class="result-snippet">${sanitizeSnippet(result.snippet)}</p>` : ''}
        </article>
    `}).join('');

    commercialResults.innerHTML = html;
    attachPrefetchListeners(commercialResults);

    const totalResults = braveState.results.length + googleState.results.length;
    const hasMore = braveState.hasMore || googleState.hasMore;
    updateCount(commercialCount, totalResults, hasMore);

    if (hasMore) {
        attachSentinel(commercialResults, 'commercial');
    }
}

function renderNoncommercialResults() {
    const results = marginaliaState.results;

    // Log errors to console
    if (marginaliaState.error) {
        console.log('Marginalia error:', marginaliaState.error);
    }

    if (results.length === 0 && !marginaliaState.loading) {
        if (marginaliaState.error) {
            noncommercialResults.innerHTML = `<div class="error-state"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`;
        } else {
            noncommercialResults.innerHTML = `<div class="empty-state"><p>No results found</p></div>`;
        }
        return;
    }

    const html = results.map((result, index) => {
        const faviconUrl = getFaviconUrl(result.url);
        return `
        <article class="result-item" data-source="marginalia" style="animation-delay: ${index * 0.02}s">
            <div class="result-url-row">
                <img class="result-favicon" src="${escapeHtml(faviconUrl)}" alt="" loading="lazy" onerror="this.classList.add('error')">
                <div class="result-url">${escapeHtml(result.displayUrl || getDomain(result.url))}</div>
                <div class="result-source-tag">Marginalia</div>
            </div>
            <h3 class="result-title">
                <a href="${escapeHtml(result.url)}">${escapeHtml(result.title)}</a>
            </h3>
            ${result.snippet ? `<p class="result-snippet">${sanitizeSnippet(result.snippet)}</p>` : ''}
        </article>
    `}).join('');

    noncommercialResults.innerHTML = html;
    attachPrefetchListeners(noncommercialResults);
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

    // Log errors to console
    if (googleState.error) console.log('Google error:', googleState.error);
    if (marginaliaState.error) console.log('Marginalia error:', marginaliaState.error);
    if (braveState.error) console.log('Brave error:', braveState.error);

    const allLoading = braveState.loading && googleState.loading && marginaliaState.loading;
    const hasErrors = googleState.error || marginaliaState.error || braveState.error;

    if (allResults.length === 0 && !allLoading) {
        if (hasErrors) {
            mergedResults.innerHTML = `<div class="error-state"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`;
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
        const faviconUrl = getFaviconUrl(item.result.url);

        return `
            <article class="result-item" data-source="${dataSource}" style="animation-delay: ${index * 0.02}s">
                <div class="result-url-row">
                    <img class="result-favicon" src="${escapeHtml(faviconUrl)}" alt="" loading="lazy" onerror="this.classList.add('error')">
                    <div class="result-url">${escapeHtml(item.result.displayUrl || getDomain(item.result.url))}</div>
                    <div class="result-source">${sourceLabel}</div>
                </div>
                <h3 class="result-title">
                    <a href="${escapeHtml(item.result.url)}">${escapeHtml(item.result.title)}</a>
                </h3>
                ${item.result.snippet ? `<p class="result-snippet">${sanitizeSnippet(item.result.snippet)}</p>` : ''}
            </article>
        `;
    }).join('');

    mergedResults.innerHTML = html;
    attachPrefetchListeners(mergedResults);

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

async function fetchImages(query, page = 1) {
    if (imageState.loading) return;
    imageState.loading = true;

    try {
        const response = await fetch(
            `/.netlify/functions/search?q=${encodeURIComponent(query)}&source=images&page=${page}`
        );

        if (!response.ok) throw new Error(`Image search failed: ${response.status}`);

        const data = await response.json();
        const newImages = data.images || [];
        imageState.hasMore = data.hasMore ?? false;
        imageState.page = page;

        if (page === 1) {
            imageState.images = newImages;
            if (newImages.length > 0) {
                renderImageSlider();
                imageSection.style.display = 'block';
                setupImageSliderScroll();
            }
        } else {
            // Deduplicate against existing images
            const existingUrls = new Set(imageState.images.map(img => img.full));
            const uniqueNewImages = newImages.filter(img => !existingUrls.has(img.full));
            imageState.images = [...imageState.images, ...uniqueNewImages];
            appendImagesToSlider(uniqueNewImages);
        }
    } catch (error) {
        console.error('Error fetching images:', error);
    } finally {
        imageState.loading = false;
    }
}

function setupImageSliderScroll() {
    sliderTrack.addEventListener('scroll', () => {
        if (imageState.loading || !imageState.hasMore) return;

        // Check if scrolled near the end (within 200px)
        const scrollRight = sliderTrack.scrollWidth - sliderTrack.scrollLeft - sliderTrack.clientWidth;
        if (scrollRight < 200) {
            showImageLoadingIndicator();
            fetchImages(currentQuery, imageState.page + 1);
        }
    });
}

function showImageLoadingIndicator() {
    if (sliderTrack.querySelector('.image-loading')) return;
    const loader = document.createElement('div');
    loader.className = 'image-loading';
    loader.innerHTML = '<div class="loading-spinner small"></div>';
    sliderTrack.appendChild(loader);
}

function removeImageLoadingIndicator() {
    const loader = sliderTrack.querySelector('.image-loading');
    if (loader) loader.remove();
}

function appendImagesToSlider(newImages) {
    removeImageLoadingIndicator();

    const startIndex = imageState.images.length - newImages.length;
    const html = newImages.map((img, i) => `
        <img 
            class="slider-image" 
            src="${escapeHtml(img.thumbnail)}" 
            alt="${escapeHtml(img.title)}"
            data-index="${startIndex + i}"
            loading="lazy"
        >
    `).join('');

    sliderTrack.insertAdjacentHTML('beforeend', html);

    // Add click and error handlers to new images
    const newImgElements = sliderTrack.querySelectorAll('.slider-image:not([data-bound])');
    newImgElements.forEach(img => {
        img.setAttribute('data-bound', 'true');
        img.addEventListener('click', () => {
            const index = parseInt(img.dataset.index);
            openImagePreview(index);
        });
        // Hide broken images
        img.addEventListener('error', () => {
            img.style.display = 'none';
        });
        img.addEventListener('load', () => {
            if (img.naturalWidth === 0) {
                img.style.display = 'none';
            }
        });
    });
}

function renderImageSlider() {
    const images = imageState.images;
    sliderTrack.innerHTML = images.map((img, index) => `
        <img 
            class="slider-image" 
            src="${escapeHtml(img.thumbnail)}" 
            alt="${escapeHtml(img.title)}"
            data-index="${index}"
            data-bound="true"
            loading="lazy"
        >
    `).join('');

    // Add click and error handlers
    sliderTrack.querySelectorAll('.slider-image').forEach(img => {
        img.addEventListener('click', () => {
            const index = parseInt(img.dataset.index);
            openImagePreview(index);
        });
        // Hide broken images
        img.addEventListener('error', () => {
            img.style.display = 'none';
        });
        // Also check for images that "load" but are actually broken (0x0)
        img.addEventListener('load', () => {
            if (img.naturalWidth === 0) {
                img.style.display = 'none';
            }
        });
    });
}

function openImagePreview(index) {
    const img = imageState.images[index];
    if (!img) return;

    // Show loading state
    imagePreview.classList.add('active', 'loading');
    previewImage.style.opacity = '0';
    previewImage.alt = img.title;

    // Store thumbnail as fallback
    previewImage.dataset.thumbnail = img.thumbnail;

    // Handle successful load
    previewImage.onload = () => {
        imagePreview.classList.remove('loading');
        previewImage.style.opacity = '1';
    };

    // Handle error - fallback to thumbnail
    previewImage.onerror = () => {
        if (previewImage.src !== img.thumbnail) {
            previewImage.src = img.thumbnail;
        } else {
            // Even thumbnail failed, just show what we have
            imagePreview.classList.remove('loading');
            previewImage.style.opacity = '1';
        }
    };

    previewImage.src = img.full;
    previewInfo.innerHTML = `
        <div>${escapeHtml(img.title)}</div>
        ${img.sourceUrl ? `<a href="${escapeHtml(img.sourceUrl)}" target="_blank" rel="noopener">Visit page</a>` : ''}
    `;

    document.body.style.overflow = 'hidden';
}

function closeImagePreview() {
    imagePreview.classList.remove('active', 'loading');
    previewImage.src = '';
    previewImage.style.opacity = '';
    previewImage.onload = null;
    previewImage.onerror = null;
    document.body.style.overflow = '';
}

// Infobox (Knowledge Panel) functions
async function fetchInfobox(query) {
    if (infoboxState.loading) return;
    infoboxState.loading = true;

    try {
        const response = await fetch(
            `/.netlify/functions/search?q=${encodeURIComponent(query)}&source=infobox`
        );

        if (!response.ok) throw new Error(`Infobox fetch failed: ${response.status}`);

        const data = await response.json();
        infoboxState.data = data.infobox;

        if (data.infobox) {
            renderInfobox(data.infobox);
        }
    } catch (error) {
        console.error('Error fetching infobox:', error);
    } finally {
        infoboxState.loading = false;
    }
}

function renderInfobox(data) {
    if (!data) {
        infobox.style.display = 'none';
        return;
    }

    // Set title
    infoboxTitle.textContent = data.title;

    // Set description
    infoboxDescription.textContent = data.description;

    // Set image with error handling for broken images
    infobox.classList.remove('no-image-fallback');
    if (data.image) {
        infoboxImage.src = data.image;
        infoboxImage.alt = data.title;
        infoboxImage.classList.remove('no-image');
        infoboxImage.onerror = () => {
            infoboxImage.classList.add('no-image');
            infobox.classList.add('no-image-fallback');
        };
        infoboxImage.onload = () => {
            // Hide if image loads but is broken (0x0 dimension)
            if (infoboxImage.naturalWidth === 0) {
                infoboxImage.classList.add('no-image');
                infobox.classList.add('no-image-fallback');
            }
        };
    } else {
        infoboxImage.classList.add('no-image');
        infobox.classList.add('no-image-fallback');
    }

    // Set external links
    infoboxLinks.innerHTML = '';
    if (data.links && data.links.length > 0) {
        data.links.forEach(link => {
            const linkEl = document.createElement('a');
            linkEl.href = link.url;
            linkEl.target = '_blank';
            linkEl.rel = 'noopener noreferrer';
            linkEl.className = 'infobox-link';
            linkEl.innerHTML = `<span class="infobox-link-icon">${link.icon}</span>${link.name}`;
            infoboxLinks.appendChild(linkEl);
        });
    }

    // Set Wikipedia source link
    infoboxSource.href = data.url;

    // Show the infobox
    infobox.style.display = 'flex';
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
    imageState = { images: [], loading: false, page: 1, hasMore: true };
    infoboxState = { data: null, loading: false };

    commercialResults.innerHTML = `<div class="empty-state"><p>Commercial results will appear here</p></div>`;
    noncommercialResults.innerHTML = `<div class="empty-state"><p>Non-commercial results will appear here</p></div>`;
    mergedResults.innerHTML = `<div class="empty-state"><p>Search results will appear here</p></div>`;
    commercialCount.textContent = '';
    noncommercialCount.textContent = '';
    imageSection.style.display = 'none';
    sliderTrack.innerHTML = '';
    infobox.style.display = 'none';
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

    // Format ellipsis separators - split on " ... " patterns and wrap each segment
    let result = temp.innerHTML;
    // Match patterns like " ... " or "... " at start or " ..." at end
    result = result.replace(/\s*\.{3}\s*/g, '<span class="snippet-separator">···</span>');

    return result;
}

function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

function getFaviconUrl(url) {
    try {
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?sz=32&domain=${domain}`;
    } catch {
        return '';
    }
}
