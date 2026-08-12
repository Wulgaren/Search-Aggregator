import type { InfoboxCastMember, InfoboxData, InfoboxDeps, InfoboxElements, InfoboxLink, InfoboxState } from './types';
import { createHeightTransition } from './height-transition';
import { asRecord, isRecord, readArray, readString } from './unknown';

export function createInfoboxComponent(elements: InfoboxElements, deps: InfoboxDeps) {
    const state: InfoboxState = { data: null, loading: false };
    let activeRequestId = 0;
    let activeQuery = '';
    const heightTx = createHeightTransition(elements.infobox);

    function reset() {
        activeRequestId += 1;
        activeQuery = '';
        state.data = null;
        state.loading = false;
        heightTx.clear();
        clearInfoboxUi();
        elements.infobox.style.display = 'none';
    }

    function clearInfoboxUi() {
        elements.infobox.classList.remove('no-image-fallback');
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

    function hide() {
        heightTx.clear();
        clearInfoboxUi();
        elements.infobox.style.display = 'none';
    }

    async function fetchInfobox(query: string) {
        if (state.loading) return;
        const requestId = ++activeRequestId;
        activeQuery = query;
        state.loading = true;
        hide();
        try {
            let response: Response;
            const earlyInfobox = await deps.takeEarlyFetch('infobox', query);
            if (earlyInfobox) response = earlyInfobox;
            else response = await deps.apiFetch(`/api/search?q=${encodeURIComponent(query)}&source=infobox`);
            if (!response.ok) throw new Error(`Infobox fetch failed: ${response.status}`);
            const data: unknown = await response.json();
            if (requestId !== activeRequestId || query !== activeQuery) return;
            const infoboxData = parseInfoboxData(isRecord(data) ? data['infobox'] : undefined);
            state.data = infoboxData;
            if (infoboxData) renderInfobox(infoboxData);
            else hide();
        } catch (error) {
            console.error('Error fetching infobox:', error);
            if (requestId === activeRequestId && query === activeQuery) hide();
        } finally {
            if (requestId === activeRequestId) state.loading = false;
        }
    }

    function applyNoImageFallback() {
        elements.infoboxImage.classList.add('no-image');
        elements.infobox.classList.add('no-image-fallback');
        elements.infoboxImage.style.cursor = '';
        elements.infoboxImage.onclick = null;
    }

    function renderInfobox(data: InfoboxData) {
        if (!data) {
            hide();
            return;
        }

        heightTx.expand(() => {
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
                const image = data.image;
                const imageFull = data.imageFull || image;
                elements.infoboxImage.src = image;
                elements.infoboxImage.alt = data.title;
                elements.infoboxImage.classList.remove('no-image');
                elements.infoboxImage.style.cursor = 'pointer';
                elements.infoboxImage.onclick = () =>
                    deps.openImagePreview({
                        thumbnail: image,
                        full: imageFull,
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
            const imageUrl = member.image;
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = '';
            img.loading = 'lazy';
            img.className = 'infobox-cast-photo-img';
            img.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                deps.openImagePreview({
                    thumbnail: imageUrl,
                    full: imageUrl,
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

function parseInfoboxLink(value: unknown): InfoboxLink | null {
    const record = asRecord(value);
    if (!record) return null;
    const url = readString(record, 'url');
    if (!url) return null;
    const link: InfoboxLink = { url };
    const icon = readString(record, 'icon');
    if (icon !== undefined) link.icon = icon;
    const name = readString(record, 'name');
    if (name !== undefined) link.name = name;
    return link;
}

function parseInfoboxCastMember(value: unknown): InfoboxCastMember | null {
    const record = asRecord(value);
    if (!record) return null;
    const name = readString(record, 'name');
    const url = readString(record, 'url');
    if (!name || !url) return null;
    const member: InfoboxCastMember = { name, url };
    const role = readString(record, 'role');
    if (role !== undefined) member.role = role;
    const image = readString(record, 'image');
    if (image !== undefined) member.image = image;
    return member;
}

function parseInfoboxData(value: unknown): InfoboxData | null {
    if (!isRecord(value)) return null;
    const url = readString(value, 'url');
    const description = readString(value, 'description');
    if (!url || description === undefined || !description.trim()) return null;
    const rawTitle = readString(value, 'title');
    let title = rawTitle?.trim() || '';
    if (!title) {
        try {
            title = new URL(url).hostname || 'Untitled';
        } catch {
            title = 'Untitled';
        }
    }
    const data: InfoboxData = { title, description, url };
    const image = readString(value, 'image');
    if (image !== undefined) data.image = image;
    const imageFull = readString(value, 'imageFull');
    if (imageFull !== undefined) data.imageFull = imageFull;
    const linksRaw = readArray(value, 'links');
    if (linksRaw) {
        data.links = linksRaw.flatMap((l) => {
            const link = parseInfoboxLink(l);
            return link ? [link] : [];
        });
    }
    const castRaw = readArray(value, 'cast');
    if (castRaw) {
        data.cast = castRaw.flatMap((c) => {
            const member = parseInfoboxCastMember(c);
            return member ? [member] : [];
        });
    }
    return data;
}
