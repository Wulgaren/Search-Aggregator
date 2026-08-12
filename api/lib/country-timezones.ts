/**
 * Country (ISO 3166-1 alpha-2) → major IANA zones + display labels.
 * Labels are region names (not cities). Multi-zone for US/AU/etc.
 */

export type CountryZoneDef = {
    /** IANA time zone id */
    id: string;
    /** Human label for the zone (e.g. "Eastern"), not a city name */
    label: string;
};

/** ISO alpha-2 (lowercase) → major zones for that country. */
export const COUNTRY_TIMEZONES: Readonly<Record<string, readonly CountryZoneDef[]>> = {
    // Multi-zone
    us: [
        { id: 'America/New_York', label: 'Eastern' },
        { id: 'America/Chicago', label: 'Central' },
        { id: 'America/Denver', label: 'Mountain' },
        { id: 'America/Los_Angeles', label: 'Pacific' },
        { id: 'America/Anchorage', label: 'Alaska' },
        { id: 'Pacific/Honolulu', label: 'Hawaii' },
    ],
    ca: [
        { id: 'America/St_Johns', label: 'Newfoundland' },
        { id: 'America/Halifax', label: 'Atlantic' },
        { id: 'America/Toronto', label: 'Eastern' },
        { id: 'America/Winnipeg', label: 'Central' },
        { id: 'America/Edmonton', label: 'Mountain' },
        { id: 'America/Vancouver', label: 'Pacific' },
    ],
    au: [
        { id: 'Australia/Sydney', label: 'Eastern' },
        { id: 'Australia/Brisbane', label: 'Eastern (no DST)' },
        { id: 'Australia/Adelaide', label: 'Central' },
        { id: 'Australia/Darwin', label: 'Central (no DST)' },
        { id: 'Australia/Perth', label: 'Western' },
    ],
    ru: [
        { id: 'Europe/Kaliningrad', label: 'Kaliningrad' },
        { id: 'Europe/Moscow', label: 'Moscow' },
        { id: 'Asia/Yekaterinburg', label: 'Yekaterinburg' },
        { id: 'Asia/Novosibirsk', label: 'Novosibirsk' },
        { id: 'Asia/Vladivostok', label: 'Vladivostok' },
    ],
    br: [
        { id: 'America/Noronha', label: 'Fernando de Noronha' },
        { id: 'America/Sao_Paulo', label: 'Brasília' },
        { id: 'America/Manaus', label: 'Amazon' },
        { id: 'America/Rio_Branco', label: 'Acre' },
    ],
    mx: [
        { id: 'America/Cancun', label: 'Southeast' },
        { id: 'America/Mexico_City', label: 'Central' },
        { id: 'America/Hermosillo', label: 'Pacific (no DST)' },
        { id: 'America/Tijuana', label: 'Northwest' },
    ],
    id: [
        { id: 'Asia/Jakarta', label: 'Western' },
        { id: 'Asia/Makassar', label: 'Central' },
        { id: 'Asia/Jayapura', label: 'Eastern' },
    ],
    nz: [
        { id: 'Pacific/Auckland', label: 'New Zealand' },
        { id: 'Pacific/Chatham', label: 'Chatham Islands' },
    ],
    es: [
        { id: 'Europe/Madrid', label: 'Mainland' },
        { id: 'Atlantic/Canary', label: 'Canary Islands' },
    ],
    pt: [
        { id: 'Europe/Lisbon', label: 'Mainland' },
        { id: 'Atlantic/Azores', label: 'Azores' },
    ],
    cl: [
        { id: 'America/Santiago', label: 'Mainland' },
        { id: 'Pacific/Easter', label: 'Easter Island' },
    ],
    // Single-zone
    gb: [{ id: 'Europe/London', label: 'United Kingdom' }],
    jp: [{ id: 'Asia/Tokyo', label: 'Japan' }],
    de: [{ id: 'Europe/Berlin', label: 'Germany' }],
    fr: [{ id: 'Europe/Paris', label: 'France' }],
    it: [{ id: 'Europe/Rome', label: 'Italy' }],
    nl: [{ id: 'Europe/Amsterdam', label: 'Netherlands' }],
    be: [{ id: 'Europe/Brussels', label: 'Belgium' }],
    ch: [{ id: 'Europe/Zurich', label: 'Switzerland' }],
    at: [{ id: 'Europe/Vienna', label: 'Austria' }],
    se: [{ id: 'Europe/Stockholm', label: 'Sweden' }],
    no: [{ id: 'Europe/Oslo', label: 'Norway' }],
    dk: [{ id: 'Europe/Copenhagen', label: 'Denmark' }],
    fi: [{ id: 'Europe/Helsinki', label: 'Finland' }],
    pl: [{ id: 'Europe/Warsaw', label: 'Poland' }],
    gr: [{ id: 'Europe/Athens', label: 'Greece' }],
    ie: [{ id: 'Europe/Dublin', label: 'Ireland' }],
    cz: [{ id: 'Europe/Prague', label: 'Czechia' }],
    hu: [{ id: 'Europe/Budapest', label: 'Hungary' }],
    ro: [{ id: 'Europe/Bucharest', label: 'Romania' }],
    ua: [{ id: 'Europe/Kyiv', label: 'Ukraine' }],
    is: [{ id: 'Atlantic/Reykjavik', label: 'Iceland' }],
    in: [{ id: 'Asia/Kolkata', label: 'India' }],
    cn: [{ id: 'Asia/Shanghai', label: 'China' }],
    kr: [{ id: 'Asia/Seoul', label: 'South Korea' }],
    kp: [{ id: 'Asia/Pyongyang', label: 'North Korea' }],
    tr: [{ id: 'Europe/Istanbul', label: 'Turkey' }],
    eg: [{ id: 'Africa/Cairo', label: 'Egypt' }],
    za: [{ id: 'Africa/Johannesburg', label: 'South Africa' }],
    ng: [{ id: 'Africa/Lagos', label: 'Nigeria' }],
    ke: [{ id: 'Africa/Nairobi', label: 'Kenya' }],
    ar: [{ id: 'America/Argentina/Buenos_Aires', label: 'Argentina' }],
    co: [{ id: 'America/Bogota', label: 'Colombia' }],
    pe: [{ id: 'America/Lima', label: 'Peru' }],
    il: [{ id: 'Asia/Jerusalem', label: 'Israel' }],
    sa: [{ id: 'Asia/Riyadh', label: 'Saudi Arabia' }],
    ae: [{ id: 'Asia/Dubai', label: 'United Arab Emirates' }],
    sg: [{ id: 'Asia/Singapore', label: 'Singapore' }],
    th: [{ id: 'Asia/Bangkok', label: 'Thailand' }],
    vn: [{ id: 'Asia/Ho_Chi_Minh', label: 'Vietnam' }],
    ph: [{ id: 'Asia/Manila', label: 'Philippines' }],
    my: [{ id: 'Asia/Kuala_Lumpur', label: 'Malaysia' }],
    pk: [{ id: 'Asia/Karachi', label: 'Pakistan' }],
    bd: [{ id: 'Asia/Dhaka', label: 'Bangladesh' }],
};

/** Sorted unique ISO alpha-2 codes with timezone data. */
export function listTimezoneCountryCodes(): string[] {
    return Object.keys(COUNTRY_TIMEZONES).sort();
}

/** Look up major zones for an ISO alpha-2 country id (case-insensitive). */
export function lookupCountryZones(countryId: string): readonly CountryZoneDef[] | null {
    const key = countryId.trim().toLowerCase();
    if (!key) return null;
    const zones = COUNTRY_TIMEZONES[key];
    return zones ?? null;
}

export function isTimezoneCountry(countryId: string): boolean {
    return lookupCountryZones(countryId) !== null;
}
