import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeightTransition } from './height-transition';

describe('createHeightTransition', () => {
    let el: HTMLDivElement;

    beforeEach(() => {
        el = document.createElement('div');
        el.style.display = 'block';
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

    it('runs updateDom immediately when element is not laid out', () => {
        el.style.display = 'none';
        const heightTx = createHeightTransition(el);
        const updateDom = vi.fn();

        heightTx.withTransition(updateDom);

        expect(updateDom).toHaveBeenCalledOnce();
        expect(el.classList.contains('infobox--height-animating')).toBe(false);
    });

    it('animates between measured heights after a DOM update', () => {
        let height = 120;
        el.getBoundingClientRect = () =>
            ({
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                bottom: height,
                right: 200,
                width: 200,
                height,
                toJSON: () => ({}),
            }) as DOMRect;

        const heightTx = createHeightTransition(el);
        heightTx.withTransition(() => {
            height = 220;
        });

        expect(el.classList.contains('infobox--height-animating')).toBe(true);
        expect(el.style.height).toBe('220px');

        el.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'height' }));

        expect(el.classList.contains('infobox--height-animating')).toBe(false);
        expect(el.style.height).toBe('');
    });

    it('collapses to zero then calls onComplete', () => {
        el.getBoundingClientRect = () =>
            ({
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                bottom: 180,
                right: 200,
                width: 200,
                height: 180,
                toJSON: () => ({}),
            }) as DOMRect;

        const onComplete = vi.fn();
        const heightTx = createHeightTransition(el);
        heightTx.animateFromTo(180, 0, onComplete);

        expect(el.classList.contains('infobox--height-animating')).toBe(true);
        expect(el.classList.contains('infobox--collapsing')).toBe(true);
        expect(el.style.height).toBe('0px');
        expect(onComplete).not.toHaveBeenCalled();

        el.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'height' }));

        expect(onComplete).toHaveBeenCalledOnce();
        expect(el.classList.contains('infobox--collapsing')).toBe(false);
        expect(el.style.height).toBe('');
    });

    it('clear cancels an in-flight transition without calling onComplete', () => {
        vi.useFakeTimers();
        const onComplete = vi.fn();
        const heightTx = createHeightTransition(el, { durationMs: 100 });
        heightTx.animateFromTo(100, 0, onComplete);
        expect(el.style.height).toBe('0px');

        heightTx.clear();

        expect(el.style.height).toBe('');
        expect(el.classList.contains('infobox--height-animating')).toBe(false);
        vi.advanceTimersByTime(500);
        expect(onComplete).not.toHaveBeenCalled();
    });
});
