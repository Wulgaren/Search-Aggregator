import { describe, expect, it } from 'vitest';
import { detectBang, resolveQueryForBangHandling, stripGoogleBangFromQuery } from './query-bangs';

declare const __DISABLE_GOOGLE_BANG__: boolean;

describe('detectBang', () => {
    it('detects bangs at start or end', () => {
        expect(detectBang('!g cats')).toBe(true);
        expect(detectBang('cats !yt')).toBe(true);
        expect(detectBang('cats')).toBe(false);
    });

    it('matches bang-only query', () => {
        expect(detectBang('!g')).toBe(true);
        expect(detectBang('!yt')).toBe(true);
    });

    it('ignores bang in the middle', () => {
        expect(detectBang('hello !g world')).toBe(false);
        expect(detectBang('a !yt b')).toBe(false);
    });

    it('rejects bare ! and empty / whitespace', () => {
        expect(detectBang('!')).toBe(false);
        expect(detectBang('')).toBe(false);
        expect(detectBang('   ')).toBe(false);
    });

    it('allows word chars in bang name', () => {
        expect(detectBang('!w')).toBe(true);
        expect(detectBang('!g123 foo')).toBe(true);
        expect(detectBang('foo !gh')).toBe(true);
    });

    it('requires bang flush at end (no trailing space after bang)', () => {
        expect(detectBang('cats !g ')).toBe(false);
    });
});

describe('stripGoogleBangFromQuery', () => {
    it('strips only !g at start or end', () => {
        expect(stripGoogleBangFromQuery('!g hello')).toBe('hello');
        expect(stripGoogleBangFromQuery('hello !g')).toBe('hello');
    });

    it('is case-insensitive for !g', () => {
        expect(stripGoogleBangFromQuery('!G hello')).toBe('hello');
        expect(stripGoogleBangFromQuery('hello !G')).toBe('hello');
        expect(stripGoogleBangFromQuery('!g Hello World')).toBe('Hello World');
    });

    it('leaves non-!g bangs alone', () => {
        expect(stripGoogleBangFromQuery('!yt cats')).toBe('!yt cats');
        expect(stripGoogleBangFromQuery('cats !w')).toBe('cats !w');
        expect(stripGoogleBangFromQuery('!gh hello')).toBe('!gh hello');
    });

    it('trims surrounding whitespace', () => {
        expect(stripGoogleBangFromQuery('  !g hello  ')).toBe('hello');
        expect(stripGoogleBangFromQuery('  plain  ')).toBe('plain');
    });

    it('handles bang-only !g', () => {
        expect(stripGoogleBangFromQuery('!g')).toBe('');
        expect(stripGoogleBangFromQuery('!G')).toBe('');
    });
});

describe('resolveQueryForBangHandling', () => {
    it('resolves non-bang as search', () => {
        expect(resolveQueryForBangHandling('plain query')).toEqual({
            kind: 'search',
            q: 'plain query',
        });
    });

    it('exposes current build-time __DISABLE_GOOGLE_BANG__ (vite define from DISABLE_GOOGLE_BANG env)', () => {
        expect(typeof __DISABLE_GOOGLE_BANG__).toBe('boolean');
    });

    it.skipIf(__DISABLE_GOOGLE_BANG__)(
        'default (flag false): any bang → redirect with raw query',
        () => {
            expect(resolveQueryForBangHandling('!g cats')).toEqual({
                kind: 'redirect',
                q: '!g cats',
            });
            expect(resolveQueryForBangHandling('cats !yt')).toEqual({
                kind: 'redirect',
                q: 'cats !yt',
            });
            expect(resolveQueryForBangHandling('!w')).toEqual({
                kind: 'redirect',
                q: '!w',
            });
        }
    );

    it.skipIf(!__DISABLE_GOOGLE_BANG__)(
        'flag true: bare !g → search with stripped query',
        () => {
            expect(resolveQueryForBangHandling('!g cats')).toEqual({
                kind: 'search',
                q: 'cats',
            });
            expect(resolveQueryForBangHandling('cats !G')).toEqual({
                kind: 'search',
                q: 'cats',
            });
            expect(resolveQueryForBangHandling('!g')).toEqual({
                kind: 'search',
                q: '',
            });
        }
    );

    it.skipIf(!__DISABLE_GOOGLE_BANG__)(
        'flag true: non-!g bang → redirect unchanged',
        () => {
            expect(resolveQueryForBangHandling('!yt cats')).toEqual({
                kind: 'redirect',
                q: '!yt cats',
            });
        }
    );

    it.skipIf(!__DISABLE_GOOGLE_BANG__)(
        'flag true: !g plus remaining bang → redirect stripped',
        () => {
            expect(resolveQueryForBangHandling('!g cats !yt')).toEqual({
                kind: 'redirect',
                q: 'cats !yt',
            });
        }
    );
});
