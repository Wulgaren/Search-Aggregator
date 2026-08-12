import type { ImageDeps, ImageElements, ImageItem, ImageState } from './types';
import { asArray, asRecord, isRecord, readBoolean, readNumber, readString } from './unknown';

function isAbortError(error: unknown): boolean {
    if (!isRecord(error)) return false;
    return readString(error, 'name') === 'AbortError';
}

function parseImageItems(value: unknown): ImageItem[] {
    const items = asArray(value);
    if (!items) return [];
    return items.flatMap((raw) => {
        const item = asRecord(raw);
        if (!item) return [];
        const thumbnail = readString(item, 'thumbnail');
        const full = readString(item, 'full');
        if (!thumbnail || !full) return [];
        const out: ImageItem = { thumbnail, full, title: readString(item, 'title') || '' };
        const sourceUrl = readString(item, 'sourceUrl');
        if (sourceUrl !== undefined) out.sourceUrl = sourceUrl;
        const sourceLinkText = readString(item, 'sourceLinkText');
        if (sourceLinkText !== undefined) out.sourceLinkText = sourceLinkText;
        const width = readNumber(item, 'width');
        if (width !== undefined) out.width = width;
        const height = readNumber(item, 'height');
        if (height !== undefined) out.height = height;
        const source = readString(item, 'source');
        if (source !== undefined) out.source = source;
        return [out];
    });
}

function parseImagesPayload(data: unknown): { images: ImageItem[]; hasMore: boolean } {
    if (!isRecord(data)) return { images: [], hasMore: false };
    return {
        images: parseImageItems(data['images']),
        hasMore: readBoolean(data, 'hasMore') ?? false,
    };
}

export function createImagesComponent(elements: ImageElements, deps: ImageDeps) {
    const state: ImageState = { images: [], loading: false, page: 1, hasMore: true };
    let imageSliderScrollBound = false;
    let imageSliderScrollHandler: (() => void) | null = null;
    let currentPreviewIndex = -1;
    let touchStartX = 0;
    let touchStartY = 0;
    let activeQuery = '';
    let activeRequestId = 0;
    let sessionAbort: AbortController | null = null;

    function abortActiveSession() {
        if (sessionAbort) {
            sessionAbort.abort();
            sessionAbort = null;
        }
    }

    function beginSession(): AbortSignal {
        abortActiveSession();
        sessionAbort = new AbortController();
        return sessionAbort.signal;
    }

    function normalizeImageKey(img: ImageItem): string {
        return String(img?.full || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    }

    function uniqueImages(images: ImageItem[], existing: ImageItem[] = []): ImageItem[] {
        const seen = new Set<string>(existing.map((img) => normalizeImageKey(img)).filter(Boolean));
        return images.filter((img) => {
            const key = normalizeImageKey(img);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    const SKELETON_TILE_COUNT = 8;

    function showImageSkeleton() {
        elements.sliderTrack.innerHTML = Array.from({ length: SKELETON_TILE_COUNT }, () => '<div class="slider-image-skeleton" aria-hidden="true"></div>').join('');
        elements.imageSection.style.display = 'block';
    }

    function showImageStatus(kind: 'empty' | 'error') {
        elements.imageSection.style.display = 'block';
        if (kind === 'empty') {
            elements.sliderTrack.innerHTML = `<div class="image-slider-status"><span class="image-slider-status-message">No images</span></div>`;
            return;
        }
        elements.sliderTrack.innerHTML = `<div class="image-slider-status image-slider-status--error"><span class="error-icon">⚠</span><span class="error-message">Something went wrong</span></div>`;
    }

    function revealImageSection() {
        elements.imageSection.style.display = 'block';
    }

    function reset() {
        abortActiveSession();
        activeRequestId += 1;
        activeQuery = '';
        state.images = [];
        state.loading = false;
        state.page = 1;
        state.hasMore = true;
        if (imageSliderScrollHandler) {
            elements.sliderTrack.removeEventListener('scroll', imageSliderScrollHandler);
            imageSliderScrollHandler = null;
        }
        imageSliderScrollBound = false;
        currentPreviewIndex = -1;
        elements.imageSection.style.display = 'none';
        elements.sliderTrack.innerHTML = '';
        closeImagePreview();
    }

    function setupEvents(getCurrentQuery: () => string) {
        elements.previewClose.addEventListener('click', closeImagePreview);
        elements.previewOverlay.addEventListener('click', closeImagePreview);
        elements.previewPrev.addEventListener('click', (e) => {
            e.stopPropagation();
            void navigatePreview(-1, getCurrentQuery);
        });
        elements.previewNext.addEventListener('click', (e) => {
            e.stopPropagation();
            void navigatePreview(1, getCurrentQuery);
        });
        document.addEventListener('keydown', (e) => {
            if (elements.imagePreview.classList.contains('active')) {
                if (e.key === 'Escape') closeImagePreview();
                else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    void navigatePreview(-1, getCurrentQuery);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    void navigatePreview(1, getCurrentQuery);
                }
            }
        });
        elements.imagePreview.addEventListener(
            'touchstart',
            (e) => {
                const touch = e.changedTouches[0];
                if (!touch) return;
                touchStartX = touch.screenX;
                touchStartY = touch.screenY;
            },
            { passive: true }
        );
        elements.imagePreview.addEventListener(
            'touchend',
            (e) => {
                const touch = e.changedTouches[0];
                if (!touch) return;
                const touchEndX = touch.screenX;
                const touchEndY = touch.screenY;
                handleSwipe(touchStartX, touchEndX, touchStartY, touchEndY, getCurrentQuery);
            },
            { passive: true }
        );
    }

    async function fetchImages(query: string, page = 1) {
        if (state.loading) return;
        const requestId = page === 1 ? ++activeRequestId : activeRequestId;
        const signal = page === 1 ? beginSession() : sessionAbort?.signal;
        if (!signal) return;
        if (page === 1) activeQuery = query;
        if (!activeQuery || query !== activeQuery) return;
        state.loading = true;
        try {
            if (page === 1) {
                state.images = [];
                state.page = 1;
                showImageSkeleton();
                let sourceSucceeded = false;
                const earlyImages = await deps.takeEarlyFetch('images', query);
                if (signal.aborted || requestId !== activeRequestId || query !== activeQuery) return;

                const combinedResponse =
                    earlyImages ??
                    (await deps.apiFetch(
                        `/api/search?q=${encodeURIComponent(query)}&source=images&page=1`,
                        { signal }
                    ));
                if (signal.aborted || requestId !== activeRequestId || query !== activeQuery) return;
                if (combinedResponse.ok) {
                    sourceSucceeded = true;
                    const data: unknown = await combinedResponse.json();
                    if (signal.aborted || requestId !== activeRequestId || query !== activeQuery) return;
                    state.images = uniqueImages(parseImageItems(isRecord(data) ? data['images'] : undefined));
                    if (state.images.length > 0) {
                        renderImageSlider();
                        revealImageSection();
                        setupImageSliderScroll(query);
                    }
                }
                if (signal.aborted || requestId !== activeRequestId || query !== activeQuery) return;
                if (state.images.length === 0) {
                    showImageStatus(sourceSucceeded ? 'empty' : 'error');
                }
                state.hasMore = state.images.length > 0;
            } else {
                const response = await deps.apiFetch(
                    `/api/search?q=${encodeURIComponent(query)}&source=images&page=${page}`,
                    { signal }
                );
                if (!response.ok) throw new Error(`Image search failed: ${response.status}`);
                const data: unknown = await response.json();
                if (signal.aborted || requestId !== activeRequestId || query !== activeQuery) return;
                const payload = parseImagesPayload(data);
                const newImages = payload.images;
                state.hasMore = payload.hasMore;
                state.page = page;
                const uniqueNewImages = uniqueImages(newImages, state.images);
                state.images = [...state.images, ...uniqueNewImages];
                appendImagesToSlider(uniqueNewImages);
            }
        } catch (error) {
            if (isAbortError(error)) return;
            console.error('Error fetching images:', error);
            if (page === 1 && requestId === activeRequestId && query === activeQuery && state.images.length === 0) {
                showImageStatus('error');
            }
        } finally {
            if (requestId === activeRequestId) state.loading = false;
            if (page > 1) removeImageLoadingIndicator();
        }
    }

    function setupImageSliderScroll(query: string) {
        if (query !== activeQuery) return;
        if (imageSliderScrollBound) return;
        imageSliderScrollBound = true;
        imageSliderScrollHandler = () => {
            if (state.loading || !state.hasMore) return;
            const scrollRight =
                elements.sliderTrack.scrollWidth - elements.sliderTrack.scrollLeft - elements.sliderTrack.clientWidth;
            if (scrollRight < 200) {
                showImageLoadingIndicator();
                void fetchImages(query, state.page + 1);
            }
        };
        elements.sliderTrack.addEventListener('scroll', imageSliderScrollHandler);
    }

    function showImageLoadingIndicator() {
        if (elements.sliderTrack.querySelector('.image-loading')) return;
        const loader = document.createElement('div');
        loader.className = 'image-loading';
        loader.innerHTML = '<div class="loading-spinner small"></div>';
        elements.sliderTrack.appendChild(loader);
    }

    function removeImageLoadingIndicator() {
        const loader = elements.sliderTrack.querySelector('.image-loading');
        if (loader) loader.remove();
    }

    function appendImagesToSlider(newImages: ImageItem[]) {
        removeImageLoadingIndicator();
        const startIndex = state.images.length - newImages.length;
        const html = newImages
            .map(
                (img, i) => `
        <img class="slider-image" src="${deps.escapeHtml(img.thumbnail)}" alt="${deps.escapeHtml(img.title)}" data-index="${
                    startIndex + i
                }" loading="lazy">
    `
            )
            .join('');
        elements.sliderTrack.insertAdjacentHTML('beforeend', html);
        bindSliderImageEvents();
    }

    function renderImageSlider() {
        elements.sliderTrack.innerHTML = state.images
            .map(
                (img, index) => `
        <img class="slider-image" src="${deps.escapeHtml(img.thumbnail)}" alt="${deps.escapeHtml(img.title)}" data-index="${index}" loading="lazy">
    `
            )
            .join('');
        bindSliderImageEvents();
    }

    function bindSliderImageEvents() {
        const newImgElements = elements.sliderTrack.querySelectorAll('.slider-image:not([data-bound])');
        newImgElements.forEach((node) => {
            if (!(node instanceof HTMLImageElement)) return;
            const img = node;
            img.setAttribute('data-bound', 'true');
            img.addEventListener('click', () => {
                const index = parseInt(img.dataset['index'] ?? '', 10);
                openImagePreview(index);
            });
            img.addEventListener('error', () => {
                img.style.display = 'none';
            });
            img.addEventListener('load', () => {
                if (img.naturalWidth === 0) img.style.display = 'none';
            });
        });
    }

    function openImagePreview(imgOrIndex: ImageItem | number) {
        let img: ImageItem | undefined;
        let index = -1;
        if (typeof imgOrIndex === 'number') {
            index = imgOrIndex;
            img = state.images[index];
            currentPreviewIndex = index;
        } else {
            img = imgOrIndex;
            currentPreviewIndex = -1;
        }
        if (!img) return;
        elements.imagePreview.classList.add('active', 'loading');
        elements.previewImage.style.opacity = '0';
        elements.previewImage.alt = img.title;
        elements.previewImage.dataset['thumbnail'] = img.thumbnail;
        elements.previewImage.onload = () => {
            elements.imagePreview.classList.remove('loading');
            elements.previewImage.style.opacity = '1';
        };
        elements.previewImage.onerror = () => {
            if (elements.previewImage.src !== img.thumbnail) {
                elements.previewImage.src = img.thumbnail;
            } else {
                elements.imagePreview.classList.remove('loading');
                elements.previewImage.style.opacity = '1';
            }
        };
        elements.previewImage.src = img.full;
        elements.previewInfo.innerHTML = `
            <div>${deps.escapeHtml(img.title)}</div>
            ${img.sourceUrl ? `<a href="${deps.escapeHtml(img.sourceUrl)}" target="_blank" rel="noopener">${img.sourceLinkText || 'Visit page'}</a>` : ''}
        `;
        updatePreviewNavigation();
        document.body.style.overflow = 'hidden';
    }

    function closeImagePreview() {
        elements.imagePreview.classList.remove('active', 'loading');
        elements.previewImage.src = '';
        elements.previewImage.style.opacity = '';
        elements.previewImage.onload = null;
        elements.previewImage.onerror = null;
        currentPreviewIndex = -1;
        document.body.style.overflow = '';
    }

    function updatePreviewNavigation() {
        const totalImages = state.images.length;
        const isNavigable = currentPreviewIndex >= 0 && totalImages > 1;
        elements.previewPrev.style.display = isNavigable && currentPreviewIndex > 0 ? 'flex' : 'none';
        const canGoNext = currentPreviewIndex < totalImages - 1 || state.hasMore;
        elements.previewNext.style.display = isNavigable && canGoNext ? 'flex' : 'none';
        if (isNavigable) {
            const suffix = state.hasMore ? '+' : '';
            elements.previewCounter.textContent = `${currentPreviewIndex + 1} / ${totalImages}${suffix}`;
            elements.previewCounter.style.display = 'block';
        } else elements.previewCounter.style.display = 'none';
    }

    async function navigatePreview(direction: number, getCurrentQuery: () => string) {
        if (state.images.length === 0) return;
        const newIndex = currentPreviewIndex + direction;
        if (newIndex >= 0 && newIndex < state.images.length) {
            openImagePreview(newIndex);
        } else if (newIndex >= state.images.length && state.hasMore && !state.loading) {
            elements.previewNext.classList.add('nav-loading');
            const previousCount = state.images.length;
            await fetchImages(getCurrentQuery(), state.page + 1);
            elements.previewNext.classList.remove('nav-loading');
            if (state.images.length > previousCount) openImagePreview(previousCount);
        }
    }

    function handleSwipe(startX: number, endX: number, startY: number, endY: number, getCurrentQuery: () => string) {
        const deltaX = endX - startX;
        const deltaY = Math.abs(endY - startY);
        if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > deltaY) {
            void navigatePreview(deltaX > 0 ? -1 : 1, getCurrentQuery);
        }
    }

    return { setupEvents, reset, fetchImages, openImagePreview };
}
