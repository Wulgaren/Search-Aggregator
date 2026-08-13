/**
 * Edge utility: country timezone — compute local times via Intl/IANA (no third-party API).
 */

import {
    lookupCountryZones,
    type CountryZoneDef,
} from './country-timezones.ts';

export type TimezoneZoneRow = {
    id: string;
    label: string;
    localTime: string;
    offset: string;
};

export type TimezoneSuccessPayload = {
    ok: true;
    kind: 'timezone';
    country: string;
    countryLabel: string;
    zones: TimezoneZoneRow[];
};

export type TimezoneErrorPayload = {
    ok: false;
    error: string;
    examples: string[];
    kind: 'timezone';
};

export type TimezonePayload = TimezoneSuccessPayload | TimezoneErrorPayload;

const TIMEZONE_EXAMPLES = ['time in japan', 'time in usa'] as const;

export type HandleUtilityTimezoneOptions = {
    /** Fixed instant for tests; defaults to now. */
    now?: Date;
};

function countryLabel(isoAlpha2: string): string {
    try {
        const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(
            isoAlpha2.toUpperCase()
        );
        if (name) return name;
    } catch {
        // fall through
    }
    return isoAlpha2.toUpperCase();
}

function formatZoneParts(
    zone: CountryZoneDef,
    now: Date
): TimezoneZoneRow {
    const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone: zone.id,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(now);

    let offset = '';
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: zone.id,
            timeZoneName: 'shortOffset',
        }).formatToParts(now);
        const tzPart = parts.find((p) => p.type === 'timeZoneName');
        offset = tzPart?.value ?? '';
    } catch {
        offset = '';
    }

    return {
        id: zone.id,
        label: zone.label,
        localTime,
        offset,
    };
}

/**
 * Resolve country → major IANA zones and format local times at `now`.
 */
export function handleUtilityTimezone(
    countryRaw: string | null | undefined,
    options: HandleUtilityTimezoneOptions = {}
): TimezonePayload {
    const raw = (countryRaw ?? '').trim();
    if (!raw) {
        return {
            ok: false,
            error: 'Country is required.',
            examples: [...TIMEZONE_EXAMPLES],
            kind: 'timezone',
        };
    }

    const country = raw.toLowerCase();
    const defs = lookupCountryZones(country);
    if (!defs || defs.length === 0) {
        return {
            ok: false,
            error: 'Unknown country. Try a country name or ISO code (e.g. japan, us).',
            examples: [...TIMEZONE_EXAMPLES],
            kind: 'timezone',
        };
    }

    const now = options.now ?? new Date();
    const zones: TimezoneZoneRow[] = [];
    for (const def of defs) {
        try {
            zones.push(formatZoneParts(def, now));
        } catch {
            return {
                ok: false,
                error: 'Could not compute local time for this country.',
                examples: [...TIMEZONE_EXAMPLES],
                kind: 'timezone',
            };
        }
    }

    return {
        ok: true,
        kind: 'timezone',
        country,
        countryLabel: countryLabel(country),
        zones,
    };
}
