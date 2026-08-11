import type { InfoboxCastMember, InfoboxData, InfoboxDeps, InfoboxElements, InfoboxLink, InfoboxState } from './types';

export function createInfoboxComponent(elements: InfoboxElements, deps: InfoboxDeps) {
    const state: InfoboxState = { data: null, loading: false };
    let activeRequestId = 0;
    let activeQuery = '';
    let open = false;
    let hasCompletedRequest = false;

    function reset() {
        activeRequestId += 1;
        activeQuery = '';
        state.data = null;
        state.loading = false;
        open = false;
        hasCompletedRequest = false;
        clearInfoboxUi();
        elements.infobox.style.display = 'none';
        syncButton();
    }

    function syncButton() {
        const ready = hasCompletedRequest && !!state.data && !state.loading;
        elements.infoboxBtn.classList.toggle('active', open);
        elements.infoboxBtn.classList.toggle('ready', ready);
        elements.infoboxBtn.classList.toggle('shine', ready && !open);
        elements.infoboxBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
        elements.infoboxBtn.disabled = false;
        if (state.loading) {
            elements.infoboxBtn.title = 'Loading knowledge panel…';
        } else if (ready) {
            elements.infoboxBtn.title = open ? 'Hide knowledge panel' : 'Show knowledge panel';
        } else if (hasCompletedRequest) {
            elements.infoboxBtn.title = 'No knowledge panel for this search';
        } else {
            elements.infoboxBtn.title = 'Knowledge panel';
        }
    }

    function applyVisibility() {
        elements.infobox.style.display = open ? 'flex' : 'none';
        syncButton();
    }

    function clearInfoboxUi() {
        elements.infobox.classList.remove('infobox--skeleton', 'infobox--empty', 'no-image-fallback');
        elements.infoboxTitle.textContent = '';
        elements.infoboxDescription.textContent = '';
        elements.infoboxLinks.innerHTML = '';
        elements.infoboxCast.hidden = true;
        elements.infoboxCast.innerHTML = '';
        elements.infoboxSource.href = '';
        elements.infoboxImage.removeAttribute('src');
        elements.infoboxImage.alt = '';
        elements.infoboxImage.classList.remove('no-image');
        elements.infoboxImage.style.cursor = '';
        elements.infoboxImage.onclick = null;
        elements.infoboxImage.onerror = null;
        elements.infoboxImage.onload = null;
    }

    function showSkeleton() {
        clearInfoboxUi();
        elements.infobox.classList.add('infobox--skeleton');
        applyVisibility();
    }

    function showEmpty() {
        clearInfoboxUi();
        elements.infobox.classList.add('infobox--empty');
        elements.infoboxDescription.textContent = 'No infobox available';
        applyVisibility();
    }

    function setOpen(next: boolean) {
        open = next;
        applyVisibility();
        if (open) {
            elements.infobox.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function toggle() {
        if (!open && !state.loading && !hasCompletedRequest) return;
        setOpen(!open);
    }

    async function fetchInfobox(query: string) {
        if (state.loading) return;
        const requestId = ++activeRequestId;
        activeQuery = query;
        state.loading = true;
        state.data = null;
        hasCompletedRequest = false;
        showSkeleton();
        try {
            let response: Response;
            const earlyInfobox = await deps.takeEarlyFetch('infobox', query);
            if (earlyInfobox) response = earlyInfobox;
            else response = await deps.apiFetch(`/api/search?q=${encodeURIComponent(query)}&source=infobox`);
            if (!response.ok) throw new Error(`Infobox fetch failed: ${response.status}`);
            const data = await response.json();
            if (requestId !== activeRequestId || query !== activeQuery) return;
            state.data = data.infobox;
            hasCompletedRequest = true;
            if (data.infobox) renderInfobox(data.infobox);
            else showEmpty();
        } catch (error) {
            console.error('Error fetching infobox:', error);
            if (requestId === activeRequestId && query === activeQuery) {
                state.data = null;
                hasCompletedRequest = true;
                showEmpty();
            }
        } finally {
            if (requestId === activeRequestId) {
                state.loading = false;
                syncButton();
            }
        }
    }

    function renderInfobox(data: InfoboxData) {
        if (!data) {
            showEmpty();
            return;
        }
        elements.infobox.classList.remove('infobox--skeleton', 'infobox--empty');
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
        applyVisibility();
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

    function setupEvents() {
        elements.infoboxBtn.addEventListener('click', () => {
            toggle();
        });
        syncButton();
    }

    syncButton();

    return { reset, fetchInfobox, setupEvents, toggle, setOpen };
}
