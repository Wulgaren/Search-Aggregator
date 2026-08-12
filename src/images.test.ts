import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageDeps, ImageElements, ImageItem } from './types';

vi.mock('./api-keys', () => ({
    hasGoogleSearchConfigured: vi.fn(() => false),
}));

import { hasGoogleSearchConfigured } from './api-keys';
import { createImagesComponent } from './images';

const hasGoogle = vi.mocked(hasGoogleSearchConfigured);

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
    return {
        ok,
        status,
        json: async () => body,
    } as Response;
}

function img(overrides: Partial<ImageItem> & Pick<ImageItem, 'full'>): ImageItem {
    return {
        thumbnail: overrides.thumbnail ?? `${overrides.full}/thumb`,
        title: overrides.title ?? 'title',
        full: overrides.full,
        sourceUrl: overrides.sourceUrl,
        sourceLinkText: overrides.sourceLinkText,
    };
}

function buildElements(): ImageElements {
    document.body.innerHTML = `
        <section id="image-section" style="display: none">
            <div class="slider-track"></div>
        </section>
        <div id="image-preview">
            <img id="preview-image" />
            <div id="preview-info"></div>
            <button type="button" id="preview-close"></button>
            <div id="preview-overlay"></div>
            <button type="button" id="preview-prev"></button>
            <button type="button" id="preview-next"></button>
            <div id="preview-counter"></div>
        </div>
    `;
    return {
        imageSection: document.getElementById('image-section')!,
        sliderTrack: document.querySelector('.slider-track') as HTMLElement,
        imagePreview: document.getElementById('image-preview')!,
        previewImage: document.getElementById('preview-image') as HTMLImageElement,
        previewInfo: document.getElementById('preview-info')!,
        previewClose: document.getElementById('preview-close') as HTMLButtonElement,
        previewOverlay: document.getElementById('preview-overlay')!,
        previewPrev: document.getElementById('preview-prev') as HTMLButtonElement,
        previewNext: document.getElementById('preview-next') as HTMLButtonElement,
        previewCounter: document.getElementById('preview-counter')!,
    };
}

function buildDeps(overrides: Partial<ImageDeps> = {}): ImageDeps {
    return {
        apiFetch: vi.fn(async () => jsonResponse({ images: [] })),
        takeEarlyFetch: vi.fn(async () => null),
        escapeHtml: (text: string) =>
            String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;'),
        ...overrides,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('createImagesComponent', () => {
    let elements: ImageElements;
    let deps: ImageDeps;

    beforeEach(() => {
        vi.useRealTimers();
        hasGoogle.mockReturnValue(false);
        elements = buildElements();
        deps = buildDeps();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    it('shows skeleton tiles immediately on page-1 fetch', async () => {
        const pending = deferred<Response>();
        deps.apiFetch = vi.fn(() => pending.promise);

        const images = createImagesComponent(elements, deps);
        const fetchPromise = images.fetchImages('cats');

        expect(elements.imageSection.style.display).toBe('block');
        expect(elements.sliderTrack.querySelectorAll('.slider-image-skeleton')).toHaveLength(8);

        pending.resolve(jsonResponse({ images: [] }));
        await fetchPromise;
    });

    it('shows No images on empty success and keeps section visible', async () => {
        deps.apiFetch = vi.fn(async () => jsonResponse({ images: [] }));

        const images = createImagesComponent(elements, deps);
        await images.fetchImages('cats');

        expect(elements.imageSection.style.display).toBe('block');
        expect(elements.sliderTrack.textContent).toContain('No images');
        expect(elements.sliderTrack.querySelector('.image-slider-status')).toBeTruthy();
    });

    it('shows error status on hard fail and keeps section visible', async () => {
        deps.apiFetch = vi.fn(async () => jsonResponse({}, false, 500));

        const images = createImagesComponent(elements, deps);
        await images.fetchImages('cats');

        expect(elements.imageSection.style.display).toBe('block');
        expect(elements.sliderTrack.textContent).toContain('Something went wrong');
        expect(elements.sliderTrack.querySelector('.image-slider-status--error')).toBeTruthy();
    });

    it('renders slider-image thumbs on success', async () => {
        deps.apiFetch = vi.fn(async () =>
            jsonResponse({
                images: [img({ full: 'https://cdn.example/a.jpg', title: 'A', thumbnail: 'https://cdn.example/a-t.jpg' })],
            })
        );

        const images = createImagesComponent(elements, deps);
        await images.fetchImages('cats');

        const thumbs = elements.sliderTrack.querySelectorAll('.slider-image');
        expect(thumbs).toHaveLength(1);
        expect((thumbs[0] as HTMLImageElement).src).toContain('a-t.jpg');
        expect(elements.imageSection.style.display).toBe('block');
    });

    it('dedupes by normalized full URL (protocol + trailing slash)', async () => {
        hasGoogle.mockReturnValue(true);
        deps.takeEarlyFetch = vi.fn(async () =>
            jsonResponse({
                images: [
                    img({ full: 'https://cdn.example/same.jpg/', title: 'Google' }),
                    img({ full: 'http://cdn.example/same.jpg', title: 'Dup' }),
                    img({ full: 'https://cdn.example/other.jpg', title: 'Other' }),
                ],
            })
        );
        deps.apiFetch = vi.fn(async () => jsonResponse({ images: [] }));

        vi.useFakeTimers();
        const images = createImagesComponent(elements, deps);
        const done = images.fetchImages('cats');
        await vi.runAllTimersAsync();
        await done;

        expect(elements.sliderTrack.querySelectorAll('.slider-image')).toHaveLength(2);
    });

    it('ignores stale response after reset()', async () => {
        const pending = deferred<Response>();
        deps.apiFetch = vi.fn(() => pending.promise);

        const images = createImagesComponent(elements, deps);
        const first = images.fetchImages('cats');

        expect(elements.sliderTrack.querySelectorAll('.slider-image-skeleton')).toHaveLength(8);

        images.reset();
        expect(elements.imageSection.style.display).toBe('none');
        expect(elements.sliderTrack.innerHTML).toBe('');

        pending.resolve(
            jsonResponse({
                images: [img({ full: 'https://cdn.example/late.jpg' })],
            })
        );
        await first;

        expect(elements.imageSection.style.display).toBe('none');
        expect(elements.sliderTrack.querySelectorAll('.slider-image')).toHaveLength(0);
    });

    it('aborts in-flight image fetch on reset()', async () => {
        const signals: AbortSignal[] = [];
        deps.apiFetch = vi.fn((_path: string, init?: RequestInit) => {
            const signal = init?.signal;
            if (signal) signals.push(signal);
            return new Promise<Response>((_resolve, reject) => {
                if (signal?.aborted) {
                    reject(new DOMException('Aborted', 'AbortError'));
                    return;
                }
                signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            });
        });

        const images = createImagesComponent(elements, deps);
        const pending = images.fetchImages('cats');
        await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));

        images.reset();
        await pending;

        expect(signals[0]!.aborted).toBe(true);
        expect(elements.imageSection.style.display).toBe('none');
        expect(elements.sliderTrack.querySelector('.image-slider-status--error')).toBeNull();
    });

    it('ignores stale delayed Brave when newer requestId wins', async () => {
        hasGoogle.mockReturnValue(true);
        deps.takeEarlyFetch = vi.fn(async () =>
            jsonResponse({
                images: [img({ full: 'https://cdn.example/g.jpg', title: 'G', thumbnail: 'https://cdn.example/g-t.jpg' })],
            })
        );
        const bravePending = deferred<Response>();
        deps.apiFetch = vi.fn(() => bravePending.promise);

        vi.useFakeTimers();
        const images = createImagesComponent(elements, deps);
        await images.fetchImages('old');
        expect(elements.sliderTrack.querySelectorAll('.slider-image')).toHaveLength(1);

        // New page-1 search bumps requestId; old 2s Brave must not append.
        hasGoogle.mockReturnValue(false);
        deps.apiFetch = vi.fn(async () =>
            jsonResponse({
                images: [img({ full: 'https://cdn.example/new.jpg', title: 'New', thumbnail: 'https://cdn.example/new-t.jpg' })],
            })
        );
        await images.fetchImages('new');
        expect((elements.sliderTrack.querySelector('.slider-image') as HTMLImageElement).alt).toBe('New');

        await vi.advanceTimersByTimeAsync(2000);
        bravePending.resolve(
            jsonResponse({
                images: [img({ full: 'https://cdn.example/stale-brave.jpg', title: 'Stale' })],
            })
        );
        await Promise.resolve();
        await Promise.resolve();

        const thumbs = elements.sliderTrack.querySelectorAll('.slider-image');
        expect(thumbs).toHaveLength(1);
        expect((thumbs[0] as HTMLImageElement).alt).toBe('New');
    });

    it('reset() hides image section', async () => {
        deps.apiFetch = vi.fn(async () =>
            jsonResponse({ images: [img({ full: 'https://cdn.example/a.jpg' })] })
        );

        const images = createImagesComponent(elements, deps);
        await images.fetchImages('cats');
        expect(elements.imageSection.style.display).toBe('block');

        images.reset();
        expect(elements.imageSection.style.display).toBe('none');
        expect(elements.sliderTrack.innerHTML).toBe('');
    });

    it('appends page-2 images without replacing page-1 thumbs', async () => {
        let pageCalls = 0;
        deps.apiFetch = vi.fn(async (path: string) => {
            if (path.includes('page=1') || path.includes('imageSource=brave')) {
                pageCalls += 1;
                return jsonResponse({
                    images: [img({ full: 'https://cdn.example/p1.jpg', title: 'P1', thumbnail: 'https://cdn.example/p1-t.jpg' })],
                });
            }
            pageCalls += 1;
            return jsonResponse({
                images: [img({ full: 'https://cdn.example/p2.jpg', title: 'P2', thumbnail: 'https://cdn.example/p2-t.jpg' })],
                hasMore: false,
            });
        });

        const images = createImagesComponent(elements, deps);
        await images.fetchImages('cats', 1);
        expect(elements.sliderTrack.querySelectorAll('.slider-image')).toHaveLength(1);

        // trigger scroll pagination path via public fetchImages page 2
        await images.fetchImages('cats', 2);

        const thumbs = elements.sliderTrack.querySelectorAll('.slider-image');
        expect(thumbs).toHaveLength(2);
        expect((thumbs[0] as HTMLImageElement).alt).toBe('P1');
        expect((thumbs[1] as HTMLImageElement).alt).toBe('P2');
        expect(pageCalls).toBeGreaterThanOrEqual(2);
    });

    it('schedules delayed Brave merge after Google success (fake timers)', async () => {
        hasGoogle.mockReturnValue(true);
        deps.takeEarlyFetch = vi.fn(async () =>
            jsonResponse({
                images: [img({ full: 'https://cdn.example/g.jpg', title: 'G', thumbnail: 'https://cdn.example/g-t.jpg' })],
            })
        );
        deps.apiFetch = vi.fn(async () =>
            jsonResponse({
                images: [img({ full: 'https://cdn.example/b.jpg', title: 'B', thumbnail: 'https://cdn.example/b-t.jpg' })],
            })
        );

        vi.useFakeTimers();
        const images = createImagesComponent(elements, deps);
        const done = images.fetchImages('cats');
        await Promise.resolve();
        await Promise.resolve();
        await done;

        expect(elements.sliderTrack.querySelectorAll('.slider-image')).toHaveLength(1);
        expect(deps.apiFetch).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2000);
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.apiFetch).toHaveBeenCalledWith(
            expect.stringContaining('imageSource=brave'),
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        expect(elements.sliderTrack.querySelectorAll('.slider-image')).toHaveLength(2);
    });

    it('shows empty when Google configured but both sources return empty ok', async () => {
        hasGoogle.mockReturnValue(true);
        deps.takeEarlyFetch = vi.fn(async () => jsonResponse({ images: [] }));
        deps.apiFetch = vi.fn(async () => jsonResponse({ images: [] }));

        const images = createImagesComponent(elements, deps);
        await images.fetchImages('cats');

        expect(elements.sliderTrack.textContent).toContain('No images');
        expect(elements.imageSection.style.display).toBe('block');
    });
});
