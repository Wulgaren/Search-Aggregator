import type { InfoboxCastMember, InfoboxData, InfoboxDeps, InfoboxElements, InfoboxLink, InfoboxState } from './types';

const HEIGHT_TRANSITION_MS = 650;

export function createInfoboxComponent(elements: InfoboxElements, deps: InfoboxDeps) {
    const state: InfoboxState = { data: null, loading: false };
    let activeRequestId = 0;
    let activeQuery = '';
    let heightAnimToken = 0;
    let heightAnimCleanup: (() => void) | null = null;

    function reset() {
        activeRequestId += 1;
        activeQuery = '';
        state.data = null;
        state.loading = false;
        clearHeightAnimation();
        clearInfoboxUi();
        elements.infobox.style.display = 'none';
    }

    function clearHeightAnimation() {
        heightAnimToken += 1;
        if (heightAnimCleanup) {
            heightAnimCleanup();
            heightAnimCleanup = null;
        }
        elements.infobox.classList.remove('infobox--height-animating');
        elements.infobox.style.height = '';
    }

    function withHeightTransition(updateDom: () => void) {
        const el = elements.infobox;
        const visible = el.style.display !== 'none' && el.offsetParent !== null;
        if (!visible || typeof el.getBoundingClientRect !== 'function') {
            updateDom();
            return;
        }

        const fromHeight = el.getBoundingClientRect().height;
        clearHeightAnimation();
        updateDom();

        // Measure natural height after DOM update
        el.style.height = 'auto';
        const toHeight = el.getBoundingClientRect().height;
        if (!Number.isFinite(fromHeight) || !Number.isFinite(toHeight) || Math.abs(fromHeight - toHeight) < 1) {
            el.style.height = '';
            return;
        }

        const token = ++heightAnimToken;
        el.classList.add('infobox--height-animating');
        el.style.height = `${fromHeight}px`;
        // Force reflow so the browser registers the starting height before transitioning
        void el.offsetHeight;
        el.style.height = `${toHeight}px`;

        const finish = () => {
            if (token !== heightAnimToken) return;
            el.classList.remove('infobox--height-animating');
            el.style.height = '';
            heightAnimCleanup = null;
        };

        const onEnd = (event: TransitionEvent) => {
            if (event.target !== el || event.propertyName !== 'height') return;
            el.removeEventListener('transitionend', onEnd);
            finish();
        };

        const timeoutId = window.setTimeout(() => {
            el.removeEventListener('transitionend', onEnd);
            finish();
        }, HEIGHT_TRANSITION_MS + 100);

        heightAnimCleanup = () => {
            window.clearTimeout(timeoutId);
            el.removeEventListener('transitionend', onEnd);
            el.classList.remove('infobox--height-animating');
            el.style.height = '';
        };

        el.addEventListener('transitionend', onEnd);
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
        elements.infobox.style.display = 'flex';
    }

    function showEmpty() {
        withHeightTransition(() => {
            clearInfoboxUi();
            elements.infobox.classList.add('infobox--empty');
            elements.infoboxDescription.textContent = 'No infobox available';
            elements.infobox.style.display = 'flex';
        });
    }

    async function fetchInfobox(query: string) {
        if (state.loading) return;
        const requestId = ++activeRequestId;
        activeQuery = query;
        state.loading = true;
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
            if (data.infobox) renderInfobox(data.infobox);
            else showEmpty();
        } catch (error) {
            console.error('Error fetching infobox:', error);
            if (requestId === activeRequestId && query === activeQuery) showEmpty();
        } finally {
            if (requestId === activeRequestId) state.loading = false;
        }
    }

    function applyNoImageFallback() {
        withHeightTransition(() => {
            elements.infoboxImage.classList.add('no-image');
            elements.infobox.classList.add('no-image-fallback');
            elements.infoboxImage.style.cursor = '';
            elements.infoboxImage.onclick = null;
        });
    }

    function renderInfobox(data: InfoboxData) {
        if (!data) {
            showEmpty();
            return;
        }

        withHeightTransition(() => {
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
                    applyNoImageFallback();
                };
                elements.infoboxImage.onload = () => {
                    if (elements.infoboxImage.naturalWidth === 0) {
                        applyNoImageFallback();
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
        });
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
