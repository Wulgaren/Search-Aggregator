import { describe, expect, it } from 'vitest';
import { guessSourceLanguage } from './guess-source-language';

describe('guessSourceLanguage', () => {
    it('returns null for empty or plain ASCII Latin', () => {
        expect(guessSourceLanguage('')).toBeNull();
        expect(guessSourceLanguage('   ')).toBeNull();
        expect(guessSourceLanguage('prawns')).toBeNull();
        expect(guessSourceLanguage('hello world')).toBeNull();
    });

    it('uses distinctive diacritics', () => {
        expect(guessSourceLanguage('żółć')).toBe('pl');
        expect(guessSourceLanguage('Größe')).toBe('de');
        expect(guessSourceLanguage('niño')).toBe('es');
        expect(guessSourceLanguage('ação')).toBe('pt');
    });

    it('uses scripts', () => {
        expect(guessSourceLanguage('привет')).toBe('ru');
        expect(guessSourceLanguage('こんにちは')).toBe('ja');
        expect(guessSourceLanguage('한글')).toBe('ko');
        expect(guessSourceLanguage('مرحبا')).toBe('ar');
        expect(guessSourceLanguage('γεια')).toBe('el');
    });
});
