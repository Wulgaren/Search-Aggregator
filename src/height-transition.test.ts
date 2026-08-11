import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeightTransition } from './height-transition';

describe('createHeightTransition', () => {
    let el: HTMLDivElement;

    beforeEach(() => {
        el = document.createElement('div');
        el.style.display = 'none';
        document.body.appendChild(el);
        Object.defineProperty(el, 'offsetParent', {
            configurable: true,
            get: () => document.body,
        });
    });

    afterEach(() => {
        el.remove();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('expands from zero to measured height then clears inline height', () => {
        el.getBoundingClientRect = () =>
            ({
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                bottom: 220,
                right: 200,
                width: 200,
                height: 220,
                toJSON: () => ({}),
            }) as DOMRect;

        const heightTx = createHeightTransition(el);
        const updateDom = vi.fn(() => {
            el.textContent = 'ready';
        });

        heightTx.expand(updateDom);

        expect(updateDom).toHaveBeenCalledOnce();
        expect(el.style.display).toBe('flex');
        expect(el.classList.contains('infobox--height-animating')).toBe(true);
        expect(el.style.height).toBe('220px');

        el.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'height' }));

        expect(el.classList.contains('infobox--height-animating')).toBe(false);
        expect(el.style.height).toBe('');
    });

    it('skips animation when measured height is zero', () => {
        el.getBoundingClientRect = () =>
            ({
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                width: 0,
                height: 0,
                toJSON: () => ({}),
            }) as DOMRect;

        const heightTx = createHeightTransition(el);
        heightTx.expand(() => {
            el.textContent = 'empty';
        });

        expect(el.style.display).toBe('flex');
        expect(el.classList.contains('infobox--height-animating')).toBe(false);
        expect(el.style.height).toBe('');
    });

    it('clear cancels an in-flight expand', () => {
        vi.useFakeTimers();
        el.getBoundingClientRect = () =>
            ({
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                bottom: 100,
                right: 200,
                width: 200,
                height: 100,
                toJSON: () => ({}),
            }) as DOMRect;

        const heightTx = createHeightTransition(el, { durationMs: 100 });
        heightTx.expand(() => {
            el.textContent = 'go';
        });
        expect(el.style.height).toBe('100px');

        heightTx.clear();

        expect(el.style.height).toBe('');
        expect(el.classList.contains('infobox--height-animating')).toBe(false);
        vi.advanceTimersByTime(500);
        expect(el.classList.contains('infobox--height-animating')).toBe(false);
    });
});
