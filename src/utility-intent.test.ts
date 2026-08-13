import { describe, expect, it } from 'vitest';
import {
    detectUtilityIntent,
    normalizeCountryId,
    normalizeCurrencyCode,
    normalizeLanguageCode,
} from './utility-intent';

describe('detectUtilityIntent — empty keywords', () => {
    it('matches exact language / currency / timezone (trim, case-insensitive)', () => {
        expect(detectUtilityIntent('language')).toEqual({ kind: 'empty', tool: 'language' });
        expect(detectUtilityIntent('CURRENCY')).toEqual({ kind: 'empty', tool: 'currency' });
        expect(detectUtilityIntent('  Timezone  ')).toEqual({ kind: 'empty', tool: 'timezone' });
    });

    it('rejects keyword with extra words', () => {
        expect(detectUtilityIntent('currency converter')).toBeNull();
        expect(detectUtilityIntent('language school')).toBeNull();
    });
});

describe('detectUtilityIntent — currency', () => {
    it('parses amount + codes: 100 usd to eur', () => {
        expect(detectUtilityIntent('100 usd to eur')).toEqual({
            kind: 'currency',
            amount: 100,
            from: 'USD',
            to: 'EUR',
        });
    });

    it('parses common phrasing: how much is 5 euros in dollars', () => {
        expect(detectUtilityIntent('how much is 5 euros in dollars')).toEqual({
            kind: 'currency',
            amount: 5,
            from: 'EUR',
            to: 'USD',
        });
    });

    it('parses convert and decimal amounts', () => {
        expect(detectUtilityIntent('convert 12.5 gbp to jpy')).toEqual({
            kind: 'currency',
            amount: 12.5,
            from: 'GBP',
            to: 'JPY',
        });
    });

    it('parses AMOUNT CURRENCY in CURRENCY', () => {
        expect(detectUtilityIntent('5 euros in dollars')).toEqual({
            kind: 'currency',
            amount: 5,
            from: 'EUR',
            to: 'USD',
        });
    });

    it('rejects non-currency lookalikes', () => {
        expect(detectUtilityIntent('100 cat to dog')).toBeNull();
        expect(detectUtilityIntent('usd to eur')).toBeNull();
    });
});

describe('detectUtilityIntent — translate', () => {
    it('parses translate hello to french', () => {
        expect(detectUtilityIntent('translate hello to french')).toEqual({
            kind: 'translate',
            text: 'hello',
            to: 'fr',
        });
    });

    it('parses from + to languages', () => {
        expect(detectUtilityIntent('translate hello from english to spanish')).toEqual({
            kind: 'translate',
            text: 'hello',
            from: 'en',
            to: 'es',
        });
    });

    it('parses how do you say … in …', () => {
        expect(detectUtilityIntent('how do you say goodbye in german')).toEqual({
            kind: 'translate',
            text: 'goodbye',
            to: 'de',
        });
    });

    it('parses translate into and multi-word text', () => {
        expect(detectUtilityIntent('translate good morning into japanese')).toEqual({
            kind: 'translate',
            text: 'good morning',
            to: 'ja',
        });
    });

    it('still returns translate when only text is present', () => {
        expect(detectUtilityIntent('translate hello world')).toEqual({
            kind: 'translate',
            text: 'hello world',
        });
    });

    it('parses translate from/to without body text', () => {
        expect(detectUtilityIntent('translate from english to french')).toEqual({
            kind: 'translate',
            text: '',
            from: 'en',
            to: 'fr',
        });
    });

    it('parses TEXT in LANG when LANG is a known language', () => {
        expect(detectUtilityIntent('prawns in polish')).toEqual({
            kind: 'translate',
            text: 'prawns',
            to: 'pl',
        });
        expect(detectUtilityIntent('prawns in pl')).toEqual({
            kind: 'translate',
            text: 'prawns',
            to: 'pl',
        });
        expect(detectUtilityIntent('king prawns in polish')).toEqual({
            kind: 'translate',
            text: 'king prawns',
            to: 'pl',
        });
        expect(detectUtilityIntent('good morning in japanese')).toEqual({
            kind: 'translate',
            text: 'good morning',
            to: 'ja',
        });
    });

    it('does not treat places as TEXT in LANG', () => {
        expect(detectUtilityIntent('best coffee in berlin')).toBeNull();
        expect(detectUtilityIntent('restaurants in london')).toBeNull();
    });
});

describe('detectUtilityIntent — timezone', () => {
    it('parses time in japan', () => {
        expect(detectUtilityIntent('time in japan')).toEqual({
            kind: 'timezone',
            country: 'jp',
        });
    });

    it('parses what time is it in usa (multi-zone country still timezone)', () => {
        expect(detectUtilityIntent('what time is it in usa')).toEqual({
            kind: 'timezone',
            country: 'us',
        });
        expect(detectUtilityIntent('time in united states')).toEqual({
            kind: 'timezone',
            country: 'us',
        });
    });

    it('accepts the-prefixed country names', () => {
        expect(detectUtilityIntent('time in the netherlands')).toEqual({
            kind: 'timezone',
            country: 'nl',
        });
    });

    it('returns none for city time queries', () => {
        expect(detectUtilityIntent('time in tokyo')).toBeNull();
        expect(detectUtilityIntent('time in london')).toBeNull();
        expect(detectUtilityIntent('what time is it in paris')).toBeNull();
    });
});

describe('detectUtilityIntent — none', () => {
    it('returns null for normal web queries', () => {
        expect(detectUtilityIntent('best coffee in berlin')).toBeNull();
        expect(detectUtilityIntent('cats')).toBeNull();
        expect(detectUtilityIntent('')).toBeNull();
        expect(detectUtilityIntent('   ')).toBeNull();
    });
});

describe('normalize helpers', () => {
    it('normalizeCurrencyCode maps names and codes', () => {
        expect(normalizeCurrencyCode('euros')).toBe('EUR');
        expect(normalizeCurrencyCode('USD')).toBe('USD');
        expect(normalizeCurrencyCode('dog')).toBeNull();
    });

    it('normalizeLanguageCode maps names', () => {
        expect(normalizeLanguageCode('French')).toBe('fr');
        expect(normalizeLanguageCode('xx')).toBeNull();
    });

    it('normalizeCountryId maps aliases and strips the', () => {
        expect(normalizeCountryId('USA')).toBe('us');
        expect(normalizeCountryId('the uk')).toBe('gb');
        expect(normalizeCountryId('tokyo')).toBeNull();
    });
});
