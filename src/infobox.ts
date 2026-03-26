import type { InfoboxData, InfoboxDeps, InfoboxElements, InfoboxLink, InfoboxState } from './types';

export function createInfoboxComponent(elements: InfoboxElements, deps: InfoboxDeps) {
    const state: InfoboxState = { data: null, loading: false };
    let activeRequestId = 0;
    let activeQuery = '';

    function reset() {
        activeRequestId += 1;
        activeQuery = '';
        state.data = null;
        state.loading = false;
        elements.infobox.style.display = 'none';
    }

    async function fetchInfobox(query: string) {
        if (state.loading) return;
        const requestId = ++activeRequestId;
        activeQuery = query;
        state.loading = true;
        try {
            let response: Response;
            const earlyInfobox = await deps.takeEarlyFetch('infobox', query);
            if (earlyInfobox) response = earlyInfobox;
            else response = await deps.apiFetch(`/api/search?q=${encodeURIComponent(query)}&source=infobox`);
            if (!response.ok) throw new Error(`Infobox fetch failed: ${response.status}`);
            const data = await response.json();
            if (requestId !== activeRequestId || query !== activeQuery) return;
            state.data = data.infobox;
            if (data.infobox) renderInfobox(data.infobox);
        } catch (error) {
            console.error('Error fetching infobox:', error);
        } finally {
            if (requestId === activeRequestId) state.loading = false;
        }
    }

    function renderInfobox(data: InfoboxData) {
        if (!data) {
            elements.infobox.style.display = 'none';
            return;
        }
        const wasHidden = elements.infobox.style.display === 'none';
        if (wasHidden) deps.storeElementPositionBeforeContent();
        elements.infoboxTitle.textContent = data.title;
        elements.infoboxDescription.textContent = data.description;
        elements.infobox.classList.remove('no-image-fallback');
        if (data.image) {
            elements.infoboxImage.src = data.image;
            elements.infoboxImage.alt = data.title;
            elements.infoboxImage.classList.remove('no-image');
            elements.infoboxImage.style.cursor = 'pointer';
            elements.infoboxImage.onclick = () =>
                deps.openImagePreview({
                    thumbnail: data.image,
                    full: data.imageFull || data.image,
                    title: data.title,
                    sourceUrl: data.url,
                    sourceLinkText: 'View on Wikipedia',
                });
            elements.infoboxImage.onerror = () => {
                elements.infoboxImage.classList.add('no-image');
                elements.infobox.classList.add('no-image-fallback');
                elements.infoboxImage.style.cursor = '';
                elements.infoboxImage.onclick = null;
            };
            elements.infoboxImage.onload = () => {
                if (elements.infoboxImage.naturalWidth === 0) {
                    elements.infoboxImage.classList.add('no-image');
                    elements.infobox.classList.add('no-image-fallback');
                    elements.infoboxImage.style.cursor = '';
                    elements.infoboxImage.onclick = null;
                }
            };
        } else {
            elements.infoboxImage.classList.add('no-image');
            elements.infobox.classList.add('no-image-fallback');
        }

        elements.infoboxLinks.innerHTML = '';
        if (data.links && data.links.length > 0) {
            data.links.forEach((link: InfoboxLink) => {
                const linkEl = document.createElement('a');
                linkEl.href = link.url;
                linkEl.target = '_blank';
                linkEl.rel = 'noopener noreferrer';
                linkEl.className = 'infobox-link';
                const iconEl = document.createElement('span');
                iconEl.className = 'infobox-link-icon';
                iconEl.textContent = String(link.icon ?? '');
                linkEl.appendChild(iconEl);
                linkEl.appendChild(document.createTextNode(String(link.name ?? '')));
                elements.infoboxLinks.appendChild(linkEl);
            });
        }
        elements.infoboxSource.href = data.url;
        elements.infobox.style.display = 'flex';
        requestAnimationFrame(() => deps.maintainMousePosition());
    }

    return { reset, fetchInfobox };
}
