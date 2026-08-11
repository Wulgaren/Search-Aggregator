const DEFAULT_DURATION_MS = 650;
const ANIMATING_CLASS = 'infobox--height-animating';

export type HeightTransitionOptions = {
    durationMs?: number;
    animatingClass?: string;
};

export type HeightTransition = {
    clear: () => void;
    /** Fill content while hidden, show, then animate height 0 → natural. */
    expand: (updateDom: () => void) => void;
};

/**
 * Expand-from-zero height transition for elements shown with an explicit `display` value.
 */
export function createHeightTransition(el: HTMLElement, options: HeightTransitionOptions = {}): HeightTransition {
    const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
    const animatingClass = options.animatingClass ?? ANIMATING_CLASS;

    let token = 0;
    let cleanup: (() => void) | null = null;

    function clear() {
        token += 1;
        if (cleanup) {
            cleanup();
            cleanup = null;
        }
        el.classList.remove(animatingClass);
        el.style.height = '';
    }

    function expand(updateDom: () => void) {
        clear();
        updateDom();

        el.style.display = 'flex';
        el.style.height = 'auto';
        const toHeight = el.getBoundingClientRect().height;
        if (!Number.isFinite(toHeight) || toHeight < 1) {
            el.style.height = '';
            return;
        }

        const currentToken = ++token;
        el.classList.add(animatingClass);
        el.style.height = '0px';
        // Force reflow so the browser registers the starting height before transitioning
        void el.offsetHeight;
        el.style.height = `${toHeight}px`;

        const finish = () => {
            if (currentToken !== token) return;
            el.classList.remove(animatingClass);
            el.style.height = '';
            cleanup = null;
        };

        const onEnd = (event: TransitionEvent) => {
            if (event.target !== el || event.propertyName !== 'height') return;
            el.removeEventListener('transitionend', onEnd);
            finish();
        };

        const timeoutId = window.setTimeout(() => {
            el.removeEventListener('transitionend', onEnd);
            finish();
        }, durationMs + 100);

        cleanup = () => {
            window.clearTimeout(timeoutId);
            el.removeEventListener('transitionend', onEnd);
            el.classList.remove(animatingClass);
            el.style.height = '';
        };

        el.addEventListener('transitionend', onEnd);
    }

    return { clear, expand };
}
