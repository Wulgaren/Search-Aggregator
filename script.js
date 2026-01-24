// DOM Elements
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const commercialResults = document.getElementById('commercial-results');
const noncommercialResults = document.getElementById('noncommercial-results');
const mergedResults = document.getElementById('merged-results');
const commercialCount = document.getElementById('commercial-count');
const noncommercialCount = document.getElementById('noncommercial-count');
const aiBtn = document.getElementById('ai-btn');
const aiPanel = document.getElementById('ai-panel');
const aiPanelClose = document.getElementById('ai-panel-close');
const aiPanelContent = document.getElementById('ai-panel-content');
const aiLoading = document.getElementById('ai-loading');
const aiAnswer = document.getElementById('ai-answer');
const aiPanelFooter = document.getElementById('ai-panel-footer');
const aiSources = document.getElementById('ai-sources');

// DDG Bang detection - matches !bang with space before/after or at start/end
function detectBang(query) {
    // Pattern: !word at start (followed by space) or at end (preceded by space)
    // Valid: "!g test", "test !g", "!yt video", "!g"
    // Invalid: "test !g query" (middle), "test!g"
    const bangPattern = /^![\w]+(?:\s|$)|\s![\w]+$/;
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
let aiState = { loading: false, abortController: null };

// Track rendered URLs to prevent animation replay on re-render
let renderedCommercialUrls = new Set();
let renderedNoncommercialUrls = new Set();
let renderedMergedUrls = new Set();

// Check if we're in mobile merged view
function isMergedView() {
    return window.innerWidth <= 900;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    restoreSearchState();
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
        // Handle bangs before updating URL (so back button doesn't cause redirect loop)
        if (detectBang(query)) {
            handleBangRedirect(query);
            return;
        }
        const url = new URL(window.location);
        url.searchParams.set('q', query);
        window.history.pushState({}, '', url);
        restoreSearchState();
    }
});

// AI Answer button
aiBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) {
        fetchAIAnswer(query);
    }
});

// AI Panel close button
aiPanelClose.addEventListener('click', () => {
    closeAIPanel();
});

// Close AI panel with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aiPanel.style.display !== 'none') {
        closeAIPanel();
    }
});

// Handle clicks on source references in AI answer
aiAnswer.addEventListener('click', (e) => {
    if (e.target.classList.contains('source-ref')) {
        const sourceNum = parseInt(e.target.dataset.source);
        const sourceItem = aiSources.querySelector(`.ai-source-item:nth-child(${sourceNum})`);
        if (sourceItem) {
            sourceItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            sourceItem.style.animation = 'none';
            sourceItem.offsetHeight; // Trigger reflow
            sourceItem.style.animation = 'highlightSource 1s ease';
        }
    }
});

function closeAIPanel() {
    // Abort any ongoing request
    if (aiState.abortController) {
        aiState.abortController.abort();
        aiState.abortController = null;
    }
    aiPanel.style.display = 'none';
    aiBtn.classList.remove('active');
    aiState.loading = false;
}

async function fetchAIAnswer(query) {
    // If already loading, abort and close
    if (aiState.loading) {
        closeAIPanel();
        return;
    }

    // Show panel and loading state
    aiPanel.style.display = 'block';
    aiBtn.classList.add('active');
    aiLoading.style.display = 'flex';
    aiAnswer.innerHTML = '';
    aiAnswer.style.display = 'none';
    aiPanelFooter.style.display = 'none';
    aiState.loading = true;

    // Scroll to make AI panel visible
    aiPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Collect search results for grounding
    const allResults = [
        ...googleState.results,
        ...braveState.results,
        ...marginaliaState.results,
    ];

    // Deduplicate by URL
    const seen = new Set();
    const searchResults = allResults.filter(result => {
        const key = result.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 8).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
    }));

    // Create abort controller for this request
    aiState.abortController = new AbortController();

    try {
        const response = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, searchResults }),
            signal: aiState.abortController.signal,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Request failed: ${response.status}`);
        }

        // Start streaming
        aiLoading.style.display = 'none';
        aiAnswer.style.display = 'block';

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        // Add cursor for streaming effect
        aiAnswer.innerHTML = '<span class="ai-cursor"></span>';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (!trimmed.startsWith('data: ')) continue;

                try {
                    const json = JSON.parse(trimmed.slice(6));
                    if (json.content) {
                        fullContent += json.content;
                        // Render markdown and add cursor
                        aiAnswer.innerHTML = renderMarkdown(fullContent) + '<span class="ai-cursor"></span>';
                    }
                    if (json.error) {
                        throw new Error(json.error);
                    }
                } catch (e) {
                    if (e.message !== 'Unexpected end of JSON input') {
                        console.error('Parse error:', e);
                    }
                }
            }
        }

        // Final render without cursor
        aiAnswer.innerHTML = renderMarkdown(fullContent);

        // Show sources if we have them
        if (searchResults.length > 0) {
            renderAISources(searchResults);
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            // Request was aborted, do nothing
            return;
        }
        aiLoading.style.display = 'none';
        aiAnswer.style.display = 'block';
        aiAnswer.innerHTML = `
            <div class="ai-error">
                <span class="ai-error-icon">⚠</span>
                <span class="ai-error-message">${escapeHtml(error.message)}</span>
            </div>
        `;
    } finally {
        aiState.loading = false;
        aiState.abortController = null;
    }
}

function renderAISources(sources) {
    if (!sources || sources.length === 0) return;

    aiPanelFooter.style.display = 'block';
    aiSources.innerHTML = sources.map((source, index) => `
        <a href="${escapeHtml(source.url)}" class="ai-source-item" target="_blank" rel="noopener">
            <span class="ai-source-num">${index + 1}</span>
            <span class="ai-source-title">${escapeHtml(source.title)}</span>
        </a>
    `).join('');
}

// Simple markdown renderer
function renderMarkdown(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    // Code blocks (must be first to prevent other replacements inside)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Source references [1], [2], etc.
    html = html.replace(/\[(\d+)\]/g, '<span class="source-ref" data-source="$1">$1</span>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Paragraphs (double newlines)
    html = html.replace(/\n\n+/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs and fix structure
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[123]>)/g, '$1');
    html = html.replace(/(<\/h[123]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');

    // Single newlines to <br> within paragraphs
    html = html.replace(/([^>])\n([^<])/g, '$1<br>$2');

    return html;
}

// Preview navigation elements
const previewPrev = document.getElementById('preview-prev');
const previewNext = document.getElementById('preview-next');
const previewCounter = document.getElementById('preview-counter');

// Preview state
let currentPreviewIndex = -1;

// Preview close handlers
previewClose.addEventListener('click', closeImagePreview);
previewOverlay.addEventListener('click', closeImagePreview);

// Preview navigation handlers
previewPrev.addEventListener('click', (e) => {
    e.stopPropagation();
    navigatePreview(-1);
});
previewNext.addEventListener('click', (e) => {
    e.stopPropagation();
    navigatePreview(1);
});

// Keyboard navigation for preview
document.addEventListener('keydown', (e) => {
    if (imagePreview.classList.contains('active')) {
        if (e.key === 'Escape') {
            closeImagePreview();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigatePreview(-1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigatePreview(1);
        }
    }
});

// Touch swipe support for preview
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;

imagePreview.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

imagePreview.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    handleSwipe(touchStartX, touchEndX, touchStartY, touchEndY);
}, { passive: true });

function handleSwipe(startX, endX, startY, endY) {
    const deltaX = endX - startX;
    const deltaY = Math.abs(endY - startY);
    const minSwipeDistance = 50;
    
    // Only trigger if horizontal swipe is dominant and significant
    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
        if (deltaX > 0) {
            navigatePreview(-1); // Swipe right = previous
        } else {
            navigatePreview(1); // Swipe left = next
        }
    }
}

async function navigatePreview(direction) {
    if (imageState.images.length === 0) return;
    
    const newIndex = currentPreviewIndex + direction;
    
    if (newIndex >= 0 && newIndex < imageState.images.length) {
        openImagePreview(newIndex);
    } else if (newIndex >= imageState.images.length && imageState.hasMore && !imageState.loading) {
        // At the end but more images available - load them
        previewNext.classList.add('loading');
        const previousCount = imageState.images.length;
        await fetchImages(currentQuery, imageState.page + 1);
        previewNext.classList.remove('loading');
        
        // If new images were loaded, navigate to the first new one
        if (imageState.images.length > previousCount) {
            openImagePreview(previousCount);
        }
    }
}

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

function restoreSearchState() {
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');

    // Safari bfcache restores form values after JS runs - use multiple strategies
    const setInputValue = (value, focus) => {
        const doSet = () => {
            searchInput.value = value;
            if (focus && value) {
                searchInput.focus();
                const len = value.length;
                searchInput.setSelectionRange(len, len);
            }
        };
        // Immediate attempt
        doSet();
        // After next frame (standard browsers)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (searchInput.value !== value) doSet();
            });
        });
    };

    if (query) {
        // Check for DDG bang and redirect if found
        if (detectBang(query)) {
            handleBangRedirect(query);
            return;
        }

        setInputValue(query, false);

        document.title = `${query} - Search`;
        // Only re-search if results are empty (page was restored from bfcache)
        if (!currentQuery || currentQuery !== query) {
            performSearch(query);
        }
    } else {
        setInputValue('', true);
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

    // Reset AI state
    if (aiState.abortController) {
        aiState.abortController.abort();
        aiState.abortController = null;
    }
    aiState = { loading: false, abortController: null };

    // Reset rendered URL tracking for new search
    renderedCommercialUrls = new Set();
    renderedNoncommercialUrls = new Set();
    renderedMergedUrls = new Set();

    // Show loading states
    showLoading(commercialResults);
    showLoading(noncommercialResults);
    showLoading(mergedResults);
    commercialCount.textContent = '';
    noncommercialCount.textContent = '';

    // Hide image section, infobox, and AI panel initially
    imageSection.style.display = 'none';
    infobox.style.display = 'none';
    aiPanel.style.display = 'none';
    aiBtn.classList.remove('active');

    // Fetch all sources independently - don't wait for all
    fetchSource('brave', query, 1);
    fetchSource('google', query, 1);
    fetchSource('marginalia', query, 1);
    fetchImages(query); // Google images load immediately, Brave images after 1s delay
    fetchInfobox(query);
}

async function fetchSource(source, query, page) {
    const state = getState(source);
    state.loading = true;

    try {
        let response;

        // Check if we have an early fetch for this source (page 1 only)
        if (page === 1 && window.__earlyFetch?.query === query && window.__earlyFetch[source]) {
            response = await window.__earlyFetch[source];
            delete window.__earlyFetch[source]; // Consume it
        } else {
            response = await fetch(
                `/api/search?q=${encodeURIComponent(query)}&page=${page}&source=${source}`
            );
        }

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
    const anyLoading = braveState.loading || googleState.loading;

    // Log errors to console
    if (googleState.error) {
        console.log('Google error:', googleState.error);
    }
    if (braveState.error) {
        console.log('Brave error:', braveState.error);
    }

    if (interleaved.length === 0) {
        if (anyLoading) {
            // Still loading, keep showing skeletons
            return;
        }
        if (googleState.error && braveState.error) {
            commercialResults.innerHTML = `<div class="error-state"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`;
        } else {
            commercialResults.innerHTML = `<div class="empty-state"><p>No results found</p></div>`;
        }
        return;
    }

    const html = interleaved.map((result, index) => {
        const source = result.source || 'brave';
        const faviconUrl = getFaviconUrl(result.url);
        const urlKey = getDedupeKey(result.url);
        return `
        <article class="result-item" data-source="${source}" data-url-key="${escapeHtml(urlKey)}" style="animation-delay: ${index * 0.02}s">
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

    // Disable animation on already-rendered items, track new ones
    commercialResults.querySelectorAll('.result-item').forEach(item => {
        const urlKey = item.dataset.urlKey;
        if (renderedCommercialUrls.has(urlKey)) {
            item.classList.add('no-animate');
        } else {
            renderedCommercialUrls.add(urlKey);
        }
    });

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

    if (results.length === 0) {
        if (marginaliaState.loading) {
            // Still loading, keep showing skeletons
            return;
        }
        if (marginaliaState.error) {
            noncommercialResults.innerHTML = `<div class="error-state"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`;
        } else {
            noncommercialResults.innerHTML = `<div class="empty-state"><p>No results found</p></div>`;
        }
        return;
    }

    const html = results.map((result, index) => {
        const faviconUrl = getFaviconUrl(result.url);
        const urlKey = getDedupeKey(result.url);
        return `
        <article class="result-item" data-source="marginalia" data-url-key="${escapeHtml(urlKey)}" style="animation-delay: ${index * 0.02}s">
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

    // Disable animation on already-rendered items, track new ones
    noncommercialResults.querySelectorAll('.result-item').forEach(item => {
        const urlKey = item.dataset.urlKey;
        if (renderedNoncommercialUrls.has(urlKey)) {
            item.classList.add('no-animate');
        } else {
            renderedNoncommercialUrls.add(urlKey);
        }
    });

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
                allResults.push({ type: 'commercial', result, urlKey: key });
            }
        }
        // Marginalia second
        if (i < marginaliaState.results.length) {
            const result = marginaliaState.results[i];
            const key = getDedupeKey(result.url);
            if (!seen.has(key)) {
                seen.add(key);
                allResults.push({ type: 'noncommercial', result, urlKey: key });
            }
        }
        // Brave third
        if (i < braveState.results.length) {
            const result = braveState.results[i];
            const key = getDedupeKey(result.url);
            if (!seen.has(key)) {
                seen.add(key);
                allResults.push({ type: 'commercial', result, urlKey: key });
            }
        }
    }

    // Log errors to console
    if (googleState.error) console.log('Google error:', googleState.error);
    if (marginaliaState.error) console.log('Marginalia error:', marginaliaState.error);
    if (braveState.error) console.log('Brave error:', braveState.error);

    const anyLoading = braveState.loading || googleState.loading || marginaliaState.loading;
    const allErrors = googleState.error && marginaliaState.error && braveState.error;

    if (allResults.length === 0) {
        if (anyLoading) {
            // Still loading, keep showing skeletons
            return;
        }
        if (allErrors) {
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
            <article class="result-item" data-source="${dataSource}" data-url-key="${escapeHtml(item.urlKey)}" style="animation-delay: ${index * 0.02}s">
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

    // Disable animation on already-rendered items, track new ones
    mergedResults.querySelectorAll('.result-item').forEach(item => {
        const urlKey = item.dataset.urlKey;
        if (renderedMergedUrls.has(urlKey)) {
            item.classList.add('no-animate');
        } else {
            renderedMergedUrls.add(urlKey);
        }
    });

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
        if (page === 1) {
            // First page: fetch Google immediately, Brave after 1s delay (avoid rate limit)
            imageState.images = [];
            imageState.page = 1;

            // Fetch Google images - use early fetch if available
            let googleResponse;
            if (window.__earlyFetch?.query === query && window.__earlyFetch.images) {
                googleResponse = await window.__earlyFetch.images;
                delete window.__earlyFetch.images;
            } else {
                googleResponse = await fetch(
                    `/api/search?q=${encodeURIComponent(query)}&source=images&imageSource=google&page=1`
                );
            }
            if (googleResponse.ok) {
                const googleData = await googleResponse.json();
                const googleImages = googleData.images || [];
                imageState.images = googleImages;
                if (googleImages.length > 0) {
                    renderImageSlider();
                    imageSection.style.display = 'block';
                    setupImageSliderScroll();
                }
            }

            // Fetch Brave images after 1 second delay
            setTimeout(async () => {
                try {
                    const braveResponse = await fetch(
                        `/api/search?q=${encodeURIComponent(query)}&source=images&imageSource=brave&page=1`
                    );
                    if (braveResponse.ok) {
                        const braveData = await braveResponse.json();
                        const braveImages = braveData.images || [];
                        // Deduplicate against existing images
                        const existingUrls = new Set(imageState.images.map(img => img.full));
                        const uniqueBraveImages = braveImages.filter(img => !existingUrls.has(img.full));
                        if (uniqueBraveImages.length > 0) {
                            imageState.images = [...imageState.images, ...uniqueBraveImages];
                            if (imageSection.style.display === 'none' && imageState.images.length > 0) {
                                renderImageSlider();
                                imageSection.style.display = 'block';
                                setupImageSliderScroll();
                            } else {
                                appendImagesToSlider(uniqueBraveImages);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error fetching Brave images:', error);
                }
            }, 1000);

            imageState.hasMore = true;
        } else {
            // Subsequent pages: fetch both together (user-triggered, rate limit not an issue)
            const response = await fetch(
                `/api/search?q=${encodeURIComponent(query)}&source=images&page=${page}`
            );

            if (!response.ok) throw new Error(`Image search failed: ${response.status}`);

            const data = await response.json();
            const newImages = data.images || [];
            imageState.hasMore = data.hasMore ?? false;
            imageState.page = page;

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

function openImagePreview(imgOrIndex) {
    // Accept either an index (for image slider) or an image object directly
    let img;
    let index = -1;
    
    if (typeof imgOrIndex === 'number') {
        index = imgOrIndex;
        img = imageState.images[index];
        currentPreviewIndex = index;
    } else {
        // It's an image object (e.g., from infobox), not from the slider
        img = imgOrIndex;
        currentPreviewIndex = -1; // Not navigable
    }
    
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
        ${img.sourceUrl ? `<a href="${escapeHtml(img.sourceUrl)}" target="_blank" rel="noopener">${img.sourceLinkText || 'Visit page'}</a>` : ''}
    `;

    // Update navigation visibility and counter
    updatePreviewNavigation();

    document.body.style.overflow = 'hidden';
}

function updatePreviewNavigation() {
    const totalImages = imageState.images.length;
    const isNavigable = currentPreviewIndex >= 0 && totalImages > 1;
    
    // Show/hide navigation buttons
    // Show prev if not at start
    previewPrev.style.display = isNavigable && currentPreviewIndex > 0 ? 'flex' : 'none';
    // Show next if not at end, OR if more images can be loaded
    const canGoNext = currentPreviewIndex < totalImages - 1 || imageState.hasMore;
    previewNext.style.display = isNavigable && canGoNext ? 'flex' : 'none';
    
    // Update counter - show "+" if more images available
    if (isNavigable) {
        const suffix = imageState.hasMore ? '+' : '';
        previewCounter.textContent = `${currentPreviewIndex + 1} / ${totalImages}${suffix}`;
        previewCounter.style.display = 'block';
    } else {
        previewCounter.style.display = 'none';
    }
}

function closeImagePreview() {
    imagePreview.classList.remove('active', 'loading');
    previewImage.src = '';
    previewImage.style.opacity = '';
    previewImage.onload = null;
    previewImage.onerror = null;
    currentPreviewIndex = -1;
    document.body.style.overflow = '';
}

// Infobox (Knowledge Panel) functions
async function fetchInfobox(query) {
    if (infoboxState.loading) return;
    infoboxState.loading = true;

    try {
        let response;

        // Use early fetch if available
        if (window.__earlyFetch?.query === query && window.__earlyFetch.infobox) {
            response = await window.__earlyFetch.infobox;
            delete window.__earlyFetch.infobox;
        } else {
            response = await fetch(
                `/api/search?q=${encodeURIComponent(query)}&source=infobox`
            );
        }

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
        infoboxImage.style.cursor = 'pointer';
        infoboxImage.onclick = () => openImagePreview({
            thumbnail: data.image,
            full: data.imageFull || data.image,
            title: data.title,
            sourceUrl: data.url,
            sourceLinkText: 'View on Wikipedia'
        });
        infoboxImage.onerror = () => {
            infoboxImage.classList.add('no-image');
            infobox.classList.add('no-image-fallback');
            infoboxImage.style.cursor = '';
            infoboxImage.onclick = null;
        };
        infoboxImage.onload = () => {
            // Hide if image loads but is broken (0x0 dimension)
            if (infoboxImage.naturalWidth === 0) {
                infoboxImage.classList.add('no-image');
                infobox.classList.add('no-image-fallback');
                infoboxImage.style.cursor = '';
                infoboxImage.onclick = null;
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
    // Show skeleton loading for optimistic updates
    container.innerHTML = generateSkeletonHTML(5);
}

function generateSkeletonHTML(count = 5) {
    return Array(count).fill(0).map(() => `
        <article class="skeleton-item">
            <div class="skeleton-url-row">
                <div class="skeleton-favicon"></div>
                <div class="skeleton-url"></div>
                <div class="skeleton-tag"></div>
            </div>
            <div class="skeleton-title"></div>
            <div class="skeleton-snippet">
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
            </div>
        </article>
    `).join('');
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

    // Reset AI state
    if (aiState.abortController) {
        aiState.abortController.abort();
        aiState.abortController = null;
    }
    aiState = { loading: false, abortController: null };

    // Reset rendered URL tracking
    renderedCommercialUrls = new Set();
    renderedNoncommercialUrls = new Set();
    renderedMergedUrls = new Set();

    commercialResults.innerHTML = `<div class="empty-state"><p>Commercial results will appear here</p></div>`;
    noncommercialResults.innerHTML = `<div class="empty-state"><p>Non-commercial results will appear here</p></div>`;
    mergedResults.innerHTML = `<div class="empty-state"><p>Search results will appear here</p></div>`;
    commercialCount.textContent = '';
    noncommercialCount.textContent = '';
    imageSection.style.display = 'none';
    sliderTrack.innerHTML = '';
    infobox.style.display = 'none';
    aiPanel.style.display = 'none';
    aiBtn.classList.remove('active');
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
