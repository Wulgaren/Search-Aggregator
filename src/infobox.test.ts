import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInfoboxComponent } from './infobox';
import type { InfoboxData, InfoboxDeps, InfoboxElements } from './types';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body,
    } as Response;
}

function createElements(): InfoboxElements {
    const infobox = document.createElement('div');
    infobox.style.display = 'none';
    const infoboxImage = document.createElement('img');
    const infoboxTitle = document.createElement('h2');
    const infoboxDescription = document.createElement('p');
    const infoboxCast = document.createElement('div');
    infoboxCast.hidden = true;
    const infoboxLinks = document.createElement('div');
    const infoboxSource = document.createElement('a');
    return {
        infobox,
        infoboxImage,
        infoboxTitle,
        infoboxDescription,
        infoboxCast,
        infoboxLinks,
        infoboxSource,
    };
}

function createDeps(overrides: Partial<InfoboxDeps> = {}): InfoboxDeps {
    return {
        apiFetch: vi.fn(),
        takeEarlyFetch: vi.fn().mockResolvedValue(null),
        openImagePreview: vi.fn(),
        ...overrides,
    };
}

const sampleInfobox: InfoboxData = {
    title: 'Blade Runner',
    description: 'A 1982 science fiction film.',
    url: 'https://en.wikipedia.org/wiki/Blade_Runner',
    image: 'https://example.com/blade.jpg',
    imageFull: 'https://example.com/blade-full.jpg',
    links: [
        { url: 'https://imdb.com/title/tt0083658', icon: '🎬', name: 'IMDb' },
        { url: 'https://example.com/trailer', name: 'Trailer' },
    ],
    cast: [
        {
            name: 'Harrison Ford',
            role: 'Deckard',
            url: 'https://en.wikipedia.org/wiki/Harrison_Ford',
            image: 'https://example.com/harrison.jpg',
        },
        {
            name: 'Rutger Hauer',
            role: 'Batty',
            url: 'https://en.wikipedia.org/wiki/Rutger_Hauer',
        },
    ],
};

describe('createInfoboxComponent', () => {
    let elements: InfoboxElements;
    let deps: InfoboxDeps;

    beforeEach(() => {
        elements = createElements();
        deps = createDeps();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('stays hidden when response has no infobox data', async () => {
        vi.mocked(deps.apiFetch).mockResolvedValue(jsonResponse({ infobox: null }));
        const { fetchInfobox } = createInfoboxComponent(elements, deps);

        await fetchInfobox('empty');

        expect(elements.infobox.style.display).toBe('none');
        expect(elements.infoboxDescription.textContent).toBe('');
    });

    it('stays hidden while loading then expands on success', async () => {
        elements.infobox.getBoundingClientRect = () =>
            ({
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                bottom: 200,
                right: 400,
                width: 400,
                height: 200,
                toJSON: () => ({}),
            }) as DOMRect;

        let resolveFetch!: (value: Response) => void;
        const pending = new Promise<Response>((resolve) => {
            resolveFetch = resolve;
        });
        vi.mocked(deps.apiFetch).mockReturnValue(pending);
        const { fetchInfobox } = createInfoboxComponent(elements, deps);

        const fetchPromise = fetchInfobox('loading');
        expect(elements.infobox.style.display).toBe('none');
        expect(elements.infoboxCast.hidden).toBe(true);
        expect(elements.infoboxCast.innerHTML).toBe('');

        resolveFetch(jsonResponse({ infobox: sampleInfobox }));
        await fetchPromise;

        expect(elements.infobox.style.display).toBe('flex');
        expect(elements.infoboxTitle.textContent).toBe('Blade Runner');
        expect(elements.infobox.classList.contains('infobox--height-animating')).toBe(true);
        expect(elements.infobox.style.height).toBe('200px');
    });

    it('renders title, description, links, and source href', async () => {
        vi.mocked(deps.apiFetch).mockResolvedValue(jsonResponse({ infobox: sampleInfobox }));
        const { fetchInfobox } = createInfoboxComponent(elements, deps);

        await fetchInfobox('blade runner');

        expect(elements.infobox.style.display).toBe('flex');
        expect(elements.infoboxTitle.textContent).toBe('Blade Runner');
        expect(elements.infoboxDescription.textContent).toBe('A 1982 science fiction film.');
        expect(elements.infoboxSource.href).toBe('https://en.wikipedia.org/wiki/Blade_Runner');

        const links = elements.infoboxLinks.querySelectorAll('a.infobox-link');
        expect(links).toHaveLength(2);
        expect(links[0].getAttribute('href')).toBe('https://imdb.com/title/tt0083658');
        expect(links[0].getAttribute('target')).toBe('_blank');
        expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
        expect(links[0].textContent).toBe('🎬IMDb');
        expect(links[1].textContent).toBe('Trailer');
    });

    it('renders cast members when present', async () => {
        vi.mocked(deps.apiFetch).mockResolvedValue(jsonResponse({ infobox: sampleInfobox }));
        const { fetchInfobox } = createInfoboxComponent(elements, deps);

        await fetchInfobox('blade runner');

        expect(elements.infoboxCast.hidden).toBe(false);
        expect(elements.infoboxCast.querySelector('.infobox-cast-heading')?.textContent).toBe('Cast');
        const cards = elements.infoboxCast.querySelectorAll('a.infobox-cast-card');
        expect(cards).toHaveLength(2);
        expect(cards[0].getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Harrison_Ford');
        expect(cards[0].querySelector('.infobox-cast-name')?.textContent).toBe('Harrison Ford');
        expect(cards[0].querySelector('.infobox-cast-role')?.textContent).toBe('Deckard');
        expect(cards[0].querySelector('img.infobox-cast-photo-img')).not.toBeNull();
        expect(cards[1].querySelector('.infobox-cast-photo')?.classList.contains('infobox-cast-photo--empty')).toBe(
            true
        );
        expect(cards[1].querySelector('.infobox-cast-photo')?.textContent).toBe('R');
    });

    it('hides cast when absent', async () => {
        const noCast: InfoboxData = { ...sampleInfobox, cast: undefined };
        vi.mocked(deps.apiFetch).mockResolvedValue(jsonResponse({ infobox: noCast }));
        const { fetchInfobox } = createInfoboxComponent(elements, deps);

        await fetchInfobox('no cast');

        expect(elements.infoboxCast.hidden).toBe(true);
        expect(elements.infoboxCast.innerHTML).toBe('');
    });

    it('adds no-image classes when image is missing', async () => {
        const noImage: InfoboxData = { ...sampleInfobox, image: undefined, imageFull: undefined };
        vi.mocked(deps.apiFetch).mockResolvedValue(jsonResponse({ infobox: noImage }));
        const { fetchInfobox } = createInfoboxComponent(elements, deps);

        await fetchInfobox('no image');

        expect(elements.infoboxImage.classList.contains('no-image')).toBe(true);
        expect(elements.infobox.classList.contains('no-image-fallback')).toBe(true);
        expect(elements.infobox.style.display).toBe('flex');
    });

    it('shows image without fallback classes when image is present', async () => {
        elements.infoboxImage.classList.add('no-image');
        elements.infobox.classList.add('no-image-fallback');
        vi.mocked(deps.apiFetch).mockResolvedValue(jsonResponse({ infobox: sampleInfobox }));
        const { fetchInfobox } = createInfoboxComponent(elements, deps);

        await fetchInfobox('with image');

        expect(elements.infoboxImage.src).toBe('https://example.com/blade.jpg');
        expect(elements.infoboxImage.alt).toBe('Blade Runner');
        expect(elements.infoboxImage.classList.contains('no-image')).toBe(false);
        expect(elements.infobox.classList.contains('no-image-fallback')).toBe(false);
        expect(elements.infoboxImage.style.cursor).toBe('pointer');

        elements.infoboxImage.onclick?.(new MouseEvent('click'));
        expect(deps.openImagePreview).toHaveBeenCalledWith({
            thumbnail: 'https://example.com/blade.jpg',
            full: 'https://example.com/blade-full.jpg',
            title: 'Blade Runner',
            sourceUrl: 'https://en.wikipedia.org/wiki/Blade_Runner',
            sourceLinkText: 'View on Wikipedia',
        });
    });

    it('falls back on image onerror without height animation', async () => {
        vi.mocked(deps.apiFetch).mockResolvedValue(jsonResponse({ infobox: sampleInfobox }));
        const { fetchInfobox } = createInfoboxComponent(elements, deps);

        await fetchInfobox('broken image');
        expect(elements.infoboxImage.onerror).toBeTypeOf('function');
        elements.infobox.classList.remove('infobox--height-animating');
        elements.infobox.style.height = '';

        elements.infoboxImage.onerror?.(new Event('error'));

        expect(elements.infoboxImage.classList.contains('no-image')).toBe(true);
        expect(elements.infobox.classList.contains('no-image-fallback')).toBe(true);
        expect(elements.infobox.classList.contains('infobox--height-animating')).toBe(false);
        expect(elements.infoboxImage.style.cursor).toBe('');
        expect(elements.infoboxImage.onclick).toBeNull();
    });

    it('falls back on onload when naturalWidth is 0', async () => {
        vi.mocked(deps.apiFetch).mockResolvedValue(jsonResponse({ infobox: sampleInfobox }));
        const { fetchInfobox } = createInfoboxComponent(elements, deps);

        await fetchInfobox('zero width');
        Object.defineProperty(elements.infoboxImage, 'naturalWidth', { configurable: true, get: () => 0 });
        expect(elements.infoboxImage.onload).toBeTypeOf('function');

        elements.infoboxImage.onload?.(new Event('load'));

        expect(elements.infoboxImage.classList.contains('no-image')).toBe(true);
        expect(elements.infobox.classList.contains('no-image-fallback')).toBe(true);
        expect(elements.infoboxImage.onclick).toBeNull();
    });

    it('ignores stale response after reset', async () => {
        let resolveFetch!: (value: Response) => void;
        const pending = new Promise<Response>((resolve) => {
            resolveFetch = resolve;
        });
        vi.mocked(deps.apiFetch).mockReturnValue(pending);
        const { fetchInfobox, reset } = createInfoboxComponent(elements, deps);

        const fetchPromise = fetchInfobox('stale');
        expect(elements.infobox.style.display).toBe('none');
        reset();
        resolveFetch(jsonResponse({ infobox: sampleInfobox }));
        await fetchPromise;

        expect(elements.infobox.style.display).toBe('none');
        expect(elements.infoboxTitle.textContent).toBe('');
        expect(elements.infoboxCast.hidden).toBe(true);
        expect(elements.infoboxCast.innerHTML).toBe('');
    });

    it('reset hides infobox and clears cast', async () => {
        vi.mocked(deps.apiFetch).mockResolvedValue(jsonResponse({ infobox: sampleInfobox }));
        const { fetchInfobox, reset } = createInfoboxComponent(elements, deps);

        await fetchInfobox('blade runner');
        expect(elements.infobox.style.display).toBe('flex');
        expect(elements.infoboxCast.hidden).toBe(false);
        expect(elements.infoboxCast.innerHTML).not.toBe('');

        reset();

        expect(elements.infobox.style.display).toBe('none');
        expect(elements.infoboxCast.hidden).toBe(true);
        expect(elements.infoboxCast.innerHTML).toBe('');
    });

    it('uses early fetch when available instead of apiFetch', async () => {
        vi.mocked(deps.takeEarlyFetch).mockResolvedValue(jsonResponse({ infobox: sampleInfobox }));
        const { fetchInfobox } = createInfoboxComponent(elements, deps);

        await fetchInfobox('early');

        expect(deps.takeEarlyFetch).toHaveBeenCalledWith('infobox', 'early');
        expect(deps.apiFetch).not.toHaveBeenCalled();
        expect(elements.infoboxTitle.textContent).toBe('Blade Runner');
    });
});
