import { describe, expect, it } from 'vitest';
import {
    isTimezoneCountry,
    listTimezoneCountryCodes,
    lookupCountryZones,
} from './country-timezones.ts';

describe('lookupCountryZones', () => {
    it('returns a single major zone for Japan', () => {
        const zones = lookupCountryZones('jp');
        expect(zones).toEqual([{ id: 'Asia/Tokyo', label: 'Japan' }]);
        expect(lookupCountryZones('JP')).toEqual(zones);
    });

    it('returns several major zones for the USA (multi-zone)', () => {
        const zones = lookupCountryZones('us');
        expect(zones).not.toBeNull();
        expect(zones!.length).toBeGreaterThanOrEqual(4);
        const ids = zones!.map((z) => z.id);
        expect(ids).toContain('America/New_York');
        expect(ids).toContain('America/Los_Angeles');
        expect(ids).toContain('Pacific/Honolulu');
        for (const z of zones!) {
            expect(z.label.length).toBeGreaterThan(0);
            expect(z.id).toMatch(/\//);
        }
    });

    it('returns multi-zone lists for Australia and Canada', () => {
        expect(lookupCountryZones('au')!.length).toBeGreaterThan(1);
        expect(lookupCountryZones('ca')!.length).toBeGreaterThan(1);
    });

    it('returns null for unknown or empty country', () => {
        expect(lookupCountryZones('xx')).toBeNull();
        expect(lookupCountryZones('')).toBeNull();
        expect(lookupCountryZones('tokyo')).toBeNull();
    });
});

describe('listTimezoneCountryCodes / isTimezoneCountry', () => {
    it('lists sorted ISO codes including us and jp', () => {
        const codes = listTimezoneCountryCodes();
        expect(codes).toContain('us');
        expect(codes).toContain('jp');
        expect([...codes].sort()).toEqual(codes);
    });

    it('isTimezoneCountry mirrors lookup', () => {
        expect(isTimezoneCountry('us')).toBe(true);
        expect(isTimezoneCountry('tokyo')).toBe(false);
    });
});
