import type { InfoboxCastMember, InfoboxData, InfoboxDeps, InfoboxElements, InfoboxLink, InfoboxState } from './types';

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
        elements.infoboxCast.hidden = true;
        elements.infoboxCast.innerHTML = '';
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

        elements.infoboxCast.hidden = true;
        elements.infoboxCast.innerHTML = '';
        if (data.cast && data.cast.length > 0) {
            elements.infoboxCast.hidden = false;
            const heading = document.createElement('div');
            heading.className = 'infobox-cast-heading';
            heading.textContent = 'Cast';
            elements.infoboxCast.appendChild(heading);
            const scroll = document.createElement('div');
            scroll.className = 'infobox-cast-scroll';
            for (const member of data.cast) {
                scroll.appendChild(buildCastCard(member));
            }
            elements.infoboxCast.appendChild(scroll);
        }

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

    function buildCastCard(member: InfoboxCastMember) {
        const card = document.createElement('a');
        card.className = 'infobox-cast-card';
        card.href = member.url;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';

        const photo = document.createElement('div');
        photo.className = 'infobox-cast-photo';

        if (member.image) {
            const img = document.createElement('img');
            img.src = member.image;
            img.alt = '';
            img.loading = 'lazy';
            img.className = 'infobox-cast-photo-img';
            img.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                deps.openImagePreview({
                    thumbnail: member.image!,
                    full: member.image!,
                    title: member.name,
                    sourceUrl: member.url,
                    sourceLinkText: 'View article',
                });
            });
            img.addEventListener('error', () => {
                img.remove();
                photo.classList.add('infobox-cast-photo--empty');
                photo.textContent = member.name.charAt(0).toUpperCase();
            });
            photo.appendChild(img);
        } else {
            photo.classList.add('infobox-cast-photo--empty');
            photo.textContent = member.name.charAt(0).toUpperCase();
        }

        const meta = document.createElement('div');
        meta.className = 'infobox-cast-meta';
        const nameEl = document.createElement('span');
        nameEl.className = 'infobox-cast-name';
        nameEl.textContent = member.name;
        meta.appendChild(nameEl);
        if (member.role) {
            const roleEl = document.createElement('span');
            roleEl.className = 'infobox-cast-role';
            roleEl.textContent = member.role;
            meta.appendChild(roleEl);
        }

        card.append(photo, meta);
        return card;
    }

    return { reset, fetchInfobox };
}
