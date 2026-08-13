import { describe, expect, it } from 'vitest';
import { handleUtilityTimezone } from './utility-timezone.ts';

/** Fixed UTC instant: 2024-06-15T16:00:00.000Z */
const FIXED_NOW = new Date('2024-06-15T16:00:00.000Z');

describe('handleUtilityTimezone', () => {
    it('returns one zone row for Japan at a fixed instant', () => {
        const body = handleUtilityTimezone('jp', { now: FIXED_NOW });
        expect(body.ok).toBe(true);
        if (!body.ok) return;
        expect(body.kind).toBe('timezone');
        expect(body.country).toBe('jp');
        expect(body.countryLabel.length).toBeGreaterThan(0);
        expect(body.zones).toHaveLength(1);
        const zone = body.zones[0]!;
        expect(zone.id).toBe('Asia/Tokyo');
        expect(zone.label).toBe('Japan');
        expect(zone.localTime).toMatch(/\d/);
        // 16:00 UTC → 01:00 next day in Tokyo (JST, UTC+9), 24h
        expect(zone.localTime).toMatch(/01:00/);
        expect(zone.offset).toMatch(/GMT|\+|-/i);
    });

    it('returns several major zones for USA', () => {
        const body = handleUtilityTimezone('us', { now: FIXED_NOW });
        expect(body.ok).toBe(true);
        if (!body.ok) return;
        expect(body.zones.length).toBeGreaterThanOrEqual(4);
        const labels = body.zones.map((z) => z.label);
        expect(labels).toContain('Eastern');
        expect(labels).toContain('Pacific');
        for (const z of body.zones) {
            expect(z.localTime.length).toBeGreaterThan(0);
        }
    });

    it('normalizes country case', () => {
        const lower = handleUtilityTimezone('jp', { now: FIXED_NOW });
        const upper = handleUtilityTimezone('JP', { now: FIXED_NOW });
        expect(lower).toEqual(upper);
    });

    it('errors when country missing', () => {
        const body = handleUtilityTimezone(null);
        expect(body).toEqual({
            ok: false,
            error: 'Country is required.',
            examples: ['time in japan', 'time in usa'],
            kind: 'timezone',
        });
    });

    it('errors for unknown country', () => {
        const body = handleUtilityTimezone('xx');
        expect(body.ok).toBe(false);
        if (body.ok) return;
        expect(body.kind).toBe('timezone');
        expect(body.error).toMatch(/unknown country/i);
        expect(body.examples).toEqual(['time in japan', 'time in usa']);
    });
});
