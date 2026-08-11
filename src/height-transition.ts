const DEFAULT_DURATION_MS = 650;
const ANIMATING_CLASS = 'infobox--height-animating';
const COLLAPSING_CLASS = 'infobox--collapsing';

export type HeightTransitionOptions = {
    durationMs?: number;
    animatingClass?: string;
    collapsingClass?: string;
};

export type HeightTransition = {
    clear: () => void;
    isLaidOut: () => boolean;
    withTransition: (updateDom: () => void) => void;
    animateFromTo: (fromHeight: number, toHeight: number, onComplete?: () => void) => void;
};

/**
 * Pixel-height transitions for elements whose natural height is `auto`.
 * Measures before/after (or animates to an explicit target), then clears inline height.
 */
export function createHeightTransition(el: HTMLElement, options: HeightTransitionOptions = {}): HeightTransition {
    const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
    const animatingClass = options.animatingClass ?? ANIMATING_CLASS;
    const collapsingClass = options.collapsingClass ?? COLLAPSING_CLASS;

    let token = 0;
    let cleanup: (() => void) | null = null;

    function clear() {
        token += 1;
        if (cleanup) {
            cleanup();
            cleanup = null;
        }
        el.classList.remove(animatingClass, collapsingClass);
        el.style.height = '';
    }

    function isLaidOut() {
        return el.style.display !== 'none' && el.offsetParent !== null && typeof el.getBoundingClientRect === 'function';
    }

    function animateFromTo(fromHeight: number, toHeight: number, onComplete?: () => void) {
        if (!Number.isFinite(fromHeight) || !Number.isFinite(toHeight) || Math.abs(fromHeight - toHeight) < 1) {
            el.style.height = '';
            onComplete?.();
            return;
        }

        const currentToken = ++token;
        const collapsing = toHeight === 0;
        el.classList.add(animatingClass);
        if (collapsing) el.classList.add(collapsingClass);
        el.style.height = `${fromHeight}px`;
        // Force reflow so the browser registers the starting height before transitioning
        void el.offsetHeight;
        el.style.height = `${toHeight}px`;

        const finish = () => {
            if (currentToken !== token) return;
            el.classList.remove(animatingClass, collapsingClass);
            el.style.height = '';
            cleanup = null;
            onComplete?.();
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
            el.classList.remove(animatingClass, collapsingClass);
            el.style.height = '';
        };

        el.addEventListener('transitionend', onEnd);
    }

    function withTransition(updateDom: () => void) {
        if (!isLaidOut()) {
            updateDom();
            return;
        }

        const fromHeight = el.getBoundingClientRect().height;
        clear();
        updateDom();

        el.style.height = 'auto';
        const toHeight = el.getBoundingClientRect().height;
        animateFromTo(fromHeight, toHeight);
    }

    return { clear, isLaidOut, withTransition, animateFromTo };
}
