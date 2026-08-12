/** Keyword that opens an empty utility tool (exact match after trim). */
export type UtilityEmptyTool = 'language' | 'currency' | 'timezone';

export type UtilityIntent =
    | { kind: 'empty'; tool: UtilityEmptyTool }
    | { kind: 'currency'; amount: number; from: string; to: string }
    | { kind: 'translate'; text: string; from?: string; to?: string }
    | { kind: 'timezone'; country: string };

/** Alias (lowercase) → ISO 4217 code. Longer aliases matched first. */
const CURRENCY_ALIASES: Readonly<Record<string, string>> = {
    'us dollars': 'USD',
    'us dollar': 'USD',
    'american dollars': 'USD',
    'american dollar': 'USD',
    dollars: 'USD',
    dollar: 'USD',
    usd: 'USD',
    euros: 'EUR',
    euro: 'EUR',
    eur: 'EUR',
    'british pounds': 'GBP',
    'british pound': 'GBP',
    pounds: 'GBP',
    pound: 'GBP',
    gbp: 'GBP',
    yen: 'JPY',
    jpy: 'JPY',
    yuan: 'CNY',
    renminbi: 'CNY',
    cny: 'CNY',
    'swiss francs': 'CHF',
    'swiss franc': 'CHF',
    francs: 'CHF',
    franc: 'CHF',
    chf: 'CHF',
    'canadian dollars': 'CAD',
    'canadian dollar': 'CAD',
    cad: 'CAD',
    'australian dollars': 'AUD',
    'australian dollar': 'AUD',
    aud: 'AUD',
    'new zealand dollars': 'NZD',
    'new zealand dollar': 'NZD',
    nzd: 'NZD',
    rupees: 'INR',
    rupee: 'INR',
    inr: 'INR',
    won: 'KRW',
    krw: 'KRW',
    pesos: 'MXN',
    peso: 'MXN',
    mxn: 'MXN',
    reais: 'BRL',
    real: 'BRL',
    brl: 'BRL',
    krona: 'SEK',
    kronor: 'SEK',
    sek: 'SEK',
    kroner: 'NOK',
    nok: 'NOK',
    dkk: 'DKK',
    pln: 'PLN',
    zloty: 'PLN',
    try: 'TRY',
    lira: 'TRY',
    zar: 'ZAR',
    rand: 'ZAR',
    sgd: 'SGD',
    hkd: 'HKD',
    thb: 'THB',
    baht: 'THB',
    php: 'PHP',
    ils: 'ILS',
    shekel: 'ILS',
    shekels: 'ILS',
    rub: 'RUB',
    ruble: 'RUB',
    rubles: 'RUB',
};

const CURRENCY_ALIAS_KEYS = Object.keys(CURRENCY_ALIASES).sort((a, b) => b.length - a.length);

/** ISO codes we accept even when the query uses the bare code form. */
const KNOWN_CURRENCY_CODES = new Set<string>(Object.values(CURRENCY_ALIASES));

/** Alias (lowercase) → BCP-47-ish language code. */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
    english: 'en',
    en: 'en',
    french: 'fr',
    fr: 'fr',
    spanish: 'es',
    es: 'es',
    german: 'de',
    de: 'de',
    italian: 'it',
    it: 'it',
    portuguese: 'pt',
    pt: 'pt',
    dutch: 'nl',
    nl: 'nl',
    russian: 'ru',
    ru: 'ru',
    chinese: 'zh',
    zh: 'zh',
    japanese: 'ja',
    ja: 'ja',
    korean: 'ko',
    ko: 'ko',
    arabic: 'ar',
    ar: 'ar',
    hindi: 'hi',
    hi: 'hi',
    turkish: 'tr',
    tr: 'tr',
    polish: 'pl',
    pl: 'pl',
    swedish: 'sv',
    sv: 'sv',
    norwegian: 'no',
    no: 'no',
    danish: 'da',
    da: 'da',
    finnish: 'fi',
    fi: 'fi',
    greek: 'el',
    el: 'el',
    hebrew: 'he',
    he: 'he',
    czech: 'cs',
    cs: 'cs',
    hungarian: 'hu',
    hu: 'hu',
    romanian: 'ro',
    ro: 'ro',
    ukrainian: 'uk',
    uk: 'uk',
    vietnamese: 'vi',
    vi: 'vi',
    thai: 'th',
    th: 'th',
    indonesian: 'id',
    id: 'id',
};

/** Curated picker list for the translate utility (codes match LANGUAGE_ALIASES). */
export const UTILITY_LANGUAGE_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'French' },
    { code: 'es', label: 'Spanish' },
    { code: 'de', label: 'German' },
    { code: 'it', label: 'Italian' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'nl', label: 'Dutch' },
    { code: 'ru', label: 'Russian' },
    { code: 'zh', label: 'Chinese' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'ar', label: 'Arabic' },
    { code: 'hi', label: 'Hindi' },
    { code: 'tr', label: 'Turkish' },
    { code: 'pl', label: 'Polish' },
    { code: 'sv', label: 'Swedish' },
    { code: 'no', label: 'Norwegian' },
    { code: 'da', label: 'Danish' },
    { code: 'fi', label: 'Finnish' },
    { code: 'el', label: 'Greek' },
    { code: 'he', label: 'Hebrew' },
    { code: 'cs', label: 'Czech' },
    { code: 'hu', label: 'Hungarian' },
    { code: 'ro', label: 'Romanian' },
    { code: 'uk', label: 'Ukrainian' },
    { code: 'vi', label: 'Vietnamese' },
    { code: 'th', label: 'Thai' },
    { code: 'id', label: 'Indonesian' },
];

const KNOWN_LANGUAGE_CODES = new Set(UTILITY_LANGUAGE_OPTIONS.map((o) => o.code));

/**
 * Locale-derived defaults for empty translate tool.
 * Prefills both pickers; never auto-detects source from text.
 */
export function languageDefaultsFromLocale(
    locale: string = typeof navigator !== 'undefined' ? navigator.language : 'en'
): { from: string; to: string } {
    const primary = locale.trim().toLowerCase().split(/[-_]/)[0] ?? 'en';
    const from = KNOWN_LANGUAGE_CODES.has(primary) ? primary : 'en';
    const to = from === 'en' ? 'es' : 'en';
    return { from, to };
}

/** Fiat codes supported by Frankfurter (ECB) — picker list for currency utility. */
export const FRANKFURTER_CURRENCY_CODES = [
    'AUD',
    'BRL',
    'CAD',
    'CHF',
    'CNY',
    'CZK',
    'DKK',
    'EUR',
    'GBP',
    'HKD',
    'HUF',
    'IDR',
    'ILS',
    'INR',
    'ISK',
    'JPY',
    'KRW',
    'MXN',
    'MYR',
    'NOK',
    'NZD',
    'PHP',
    'PLN',
    'RON',
    'SEK',
    'SGD',
    'THB',
    'TRY',
    'USD',
    'ZAR',
] as const;

const FRANKFURTER_CURRENCY_SET = new Set<string>(FRANKFURTER_CURRENCY_CODES);

/** ISO 3166-1 alpha-2 region → Frankfurter currency (locale defaults). */
const REGION_TO_CURRENCY: Readonly<Record<string, string>> = {
    US: 'USD',
    GB: 'GBP',
    JP: 'JPY',
    AU: 'AUD',
    CA: 'CAD',
    CH: 'CHF',
    CN: 'CNY',
    CZ: 'CZK',
    DK: 'DKK',
    DE: 'EUR',
    FR: 'EUR',
    IT: 'EUR',
    ES: 'EUR',
    NL: 'EUR',
    BE: 'EUR',
    AT: 'EUR',
    IE: 'EUR',
    PT: 'EUR',
    FI: 'EUR',
    GR: 'EUR',
    HK: 'HKD',
    HU: 'HUF',
    ID: 'IDR',
    IL: 'ILS',
    IN: 'INR',
    IS: 'ISK',
    KR: 'KRW',
    MX: 'MXN',
    MY: 'MYR',
    NO: 'NOK',
    NZ: 'NZD',
    PH: 'PHP',
    PL: 'PLN',
    RO: 'RON',
    SE: 'SEK',
    SG: 'SGD',
    TH: 'THB',
    TR: 'TRY',
    ZA: 'ZAR',
    BR: 'BRL',
};

/**
 * Locale-derived defaults for empty currency tool.
 * Amount starts at 100; from/to from navigator region when Frankfurter-supported.
 */
export function currencyDefaultsFromLocale(
    locale: string = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
): { amount: number; from: string; to: string } {
    let from = 'USD';
    try {
        const region = new Intl.Locale(locale).maximize().region;
        if (region) {
            const mapped = REGION_TO_CURRENCY[region.toUpperCase()];
            if (mapped && FRANKFURTER_CURRENCY_SET.has(mapped)) from = mapped;
        }
    } catch {
        // fall through
    }
    const to = from === 'USD' ? 'EUR' : 'USD';
    return { amount: 100, from, to };
}

/**
 * Country / demonym aliases → ISO 3166-1 alpha-2 (lowercase).
 * Cities are intentionally absent so `time in tokyo` stays none.
 */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
    // Multi-zone / common
    'united states of america': 'us',
    'united states': 'us',
    america: 'us',
    usa: 'us',
    us: 'us',
    'u.s.': 'us',
    'u.s.a.': 'us',
    'united kingdom': 'gb',
    britain: 'gb',
    'great britain': 'gb',
    england: 'gb',
    uk: 'gb',
    'u.k.': 'gb',
    canada: 'ca',
    ca: 'ca',
    australia: 'au',
    au: 'au',
    russia: 'ru',
    'russian federation': 'ru',
    ru: 'ru',
    brazil: 'br',
    br: 'br',
    mexico: 'mx',
    mx: 'mx',
    indonesia: 'id',
    id: 'id',
    china: 'cn',
    'people\'s republic of china': 'cn',
    cn: 'cn',
    india: 'in',
    in: 'in',
    // Single / common
    japan: 'jp',
    jp: 'jp',
    germany: 'de',
    de: 'de',
    france: 'fr',
    fr: 'fr',
    italy: 'it',
    it: 'it',
    spain: 'es',
    es: 'es',
    netherlands: 'nl',
    holland: 'nl',
    nl: 'nl',
    belgium: 'be',
    be: 'be',
    switzerland: 'ch',
    ch: 'ch',
    austria: 'at',
    at: 'at',
    sweden: 'se',
    se: 'se',
    norway: 'no',
    no: 'no',
    denmark: 'dk',
    dk: 'dk',
    finland: 'fi',
    fi: 'fi',
    poland: 'pl',
    pl: 'pl',
    portugal: 'pt',
    pt: 'pt',
    greece: 'gr',
    gr: 'gr',
    ireland: 'ie',
    ie: 'ie',
    'new zealand': 'nz',
    nz: 'nz',
    'south korea': 'kr',
    korea: 'kr',
    kr: 'kr',
    'north korea': 'kp',
    kp: 'kp',
    turkey: 'tr',
    türkiye: 'tr',
    tr: 'tr',
    egypt: 'eg',
    eg: 'eg',
    'south africa': 'za',
    za: 'za',
    argentina: 'ar',
    ar: 'ar',
    chile: 'cl',
    cl: 'cl',
    colombia: 'co',
    co: 'co',
    peru: 'pe',
    pe: 'pe',
    israel: 'il',
    il: 'il',
    'saudi arabia': 'sa',
    sa: 'sa',
    'united arab emirates': 'ae',
    uae: 'ae',
    ae: 'ae',
    singapore: 'sg',
    sg: 'sg',
    thailand: 'th',
    th: 'th',
    vietnam: 'vn',
    vn: 'vn',
    philippines: 'ph',
    ph: 'ph',
    malaysia: 'my',
    my: 'my',
    pakistan: 'pk',
    pk: 'pk',
    bangladesh: 'bd',
    bd: 'bd',
    nigeria: 'ng',
    ng: 'ng',
    kenya: 'ke',
    ke: 'ke',
    ukraine: 'ua',
    ua: 'ua',
    czechia: 'cz',
    'czech republic': 'cz',
    cz: 'cz',
    hungary: 'hu',
    hu: 'hu',
    romania: 'ro',
    ro: 'ro',
    iceland: 'is',
    is: 'is',
};

function normalizeKey(raw: string): string {
    return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Resolve a currency token/phrase to an ISO 4217 code, or null. */
export function normalizeCurrencyCode(raw: string): string | null {
    const key = normalizeKey(raw);
    if (!key) return null;
    const mapped = CURRENCY_ALIASES[key];
    if (mapped !== undefined) return mapped;
    if (/^[a-z]{3}$/i.test(key)) {
        const upper = key.toUpperCase();
        if (KNOWN_CURRENCY_CODES.has(upper)) return upper;
    }
    return null;
}

/** Resolve a language name/code to a short language id, or null. */
export function normalizeLanguageCode(raw: string): string | null {
    const key = normalizeKey(raw);
    if (!key) return null;
    return LANGUAGE_ALIASES[key] ?? null;
}

/** Resolve a country name/code to ISO 3166-1 alpha-2 (lowercase), or null. */
export function normalizeCountryId(raw: string): string | null {
    let key = normalizeKey(raw);
    if (!key) return null;
    if (key.startsWith('the ')) {
        key = key.slice(4);
    }
    return COUNTRY_ALIASES[key] ?? null;
}

function matchAliasAt(
    haystack: string,
    start: number,
    keys: readonly string[],
    resolve: (key: string) => string | null
): { value: string; end: number } | null {
    const slice = haystack.slice(start);
    for (const key of keys) {
        if (!slice.startsWith(key)) continue;
        const end = start + key.length;
        const next = haystack[end];
        if (next !== undefined && /[a-z0-9]/i.test(next)) continue;
        const value = resolve(key);
        if (value === null) continue;
        return { value, end };
    }
    return null;
}

function parseAmountAt(s: string, start: number): { amount: number; end: number } | null {
    const m = /^(\d+(?:\.\d+)?)/.exec(s.slice(start));
    if (!m || m[1] === undefined) return null;
    const amount = Number(m[1]);
    if (!Number.isFinite(amount)) return null;
    return { amount, end: start + m[1].length };
}

function skipSpace(s: string, i: number): number {
    while (i < s.length && s[i] === ' ') i += 1;
    return i;
}

function tryParseCurrencyQuery(q: string): UtilityIntent | null {
    const s = normalizeKey(q);

    // how much is/are AMOUNT CURRENCY in/to CURRENCY
    {
        const prefix = /^(?:how much (?:is|are)\s+|convert\s+)/.exec(s);
        if (prefix) {
            const parsed = parseAmountCurrencyPair(s, prefix[0].length, ['in', 'to']);
            if (parsed) return parsed;
        }
    }

    // AMOUNT CURRENCY to/in CURRENCY
    {
        const amount = parseAmountAt(s, 0);
        if (amount) {
            const parsed = parseAmountCurrencyPair(s, 0, ['to', 'in']);
            if (parsed) return parsed;
        }
    }

    return null;
}

function parseAmountCurrencyPair(
    s: string,
    start: number,
    connectors: readonly string[]
): UtilityIntent | null {
    const amountPart = parseAmountAt(s, start);
    if (!amountPart) return null;
    let i = skipSpace(s, amountPart.end);

    const from = matchCurrencyToken(s, i);
    if (!from) return null;
    i = skipSpace(s, from.end);
    return finishCurrencyPair(s, i, amountPart.amount, from.value, connectors);
}

function matchCurrencyToken(s: string, start: number): { value: string; end: number } | null {
    const aliased = matchAliasAt(s, start, CURRENCY_ALIAS_KEYS, (k) => CURRENCY_ALIASES[k] ?? null);
    if (aliased) return aliased;
    const code = /^[a-z]{3}(?![a-z0-9])/i.exec(s.slice(start));
    if (!code || code[0] === undefined) return null;
    const normalized = normalizeCurrencyCode(code[0]);
    if (!normalized) return null;
    return { value: normalized, end: start + code[0].length };
}

function finishCurrencyPair(
    s: string,
    i: number,
    amount: number,
    from: string,
    connectors: readonly string[]
): UtilityIntent | null {
    let matchedConnector = false;
    for (const c of connectors) {
        if (s.startsWith(c, i) && (s[i + c.length] === ' ' || s[i + c.length] === undefined)) {
            i = skipSpace(s, i + c.length);
            matchedConnector = true;
            break;
        }
    }
    if (!matchedConnector) return null;

    const to = matchCurrencyToken(s, i);
    if (!to) return null;
    if (skipSpace(s, to.end) !== s.length) return null;
    return { kind: 'currency', amount, from, to: to.value };
}

function tryParseTranslateQuery(q: string): UtilityIntent | null {
    const trimmed = q.trim();
    if (!trimmed) return null;

    // translate from LANG to/into LANG (no text body)
    {
        const m = /^translate\s+from\s+(\S+)\s+(?:to|into)\s+(\S+)\s*$/i.exec(trimmed);
        if (m && m[1] !== undefined && m[2] !== undefined) {
            return buildTranslate('', m[1], m[2]);
        }
    }

    // translate TEXT from LANG to/into LANG
    {
        const m = /^translate\s+(.+?)\s+from\s+(\S+)\s+(?:to|into)\s+(\S+)\s*$/i.exec(trimmed);
        if (m && m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
            return buildTranslate(m[1], m[2], m[3]);
        }
    }

    // translate TEXT to/into LANG
    {
        const m = /^translate\s+(.+?)\s+(?:to|into)\s+(\S+)\s*$/i.exec(trimmed);
        if (m && m[1] !== undefined && m[2] !== undefined) {
            return buildTranslate(m[1], undefined, m[2]);
        }
    }

    // translate TEXT (no langs)
    {
        const m = /^translate\s+(.+)$/i.exec(trimmed);
        if (m && m[1] !== undefined) {
            const rest = m[1].trim();
            // Avoid swallowing unfinished "translate … from/to …" fragments as bare text
            if (rest && !/\s(?:to|into|from)\s/i.test(rest)) {
                return { kind: 'translate', text: rest };
            }
        }
    }

    // how do you say TEXT in LANG
    {
        const m = /^how do you say\s+(.+?)\s+in\s+(\S+)\s*$/i.exec(trimmed);
        if (m && m[1] !== undefined && m[2] !== undefined) {
            return buildTranslate(m[1], undefined, m[2]);
        }
    }

    return null;
}

function buildTranslate(text: string, fromRaw: string | undefined, toRaw: string | undefined): UtilityIntent {
    const result: { kind: 'translate'; text: string; from?: string; to?: string } = {
        kind: 'translate',
        text: text.trim(),
    };
    if (fromRaw !== undefined) {
        result.from = normalizeLanguageCode(fromRaw) ?? normalizeKey(fromRaw);
    }
    if (toRaw !== undefined) {
        result.to = normalizeLanguageCode(toRaw) ?? normalizeKey(toRaw);
    }
    return result;
}

function tryParseTimezoneQuery(q: string): UtilityIntent | null {
    const s = normalizeKey(q);

    const patterns = [
        /^what time is it in\s+(.+)$/,
        /^what(?:'s| is) the time in\s+(.+)$/,
        /^time in\s+(.+)$/,
    ];

    for (const re of patterns) {
        const m = re.exec(s);
        if (!m || m[1] === undefined) continue;
        const country = normalizeCountryId(m[1]);
        if (country === null) return null;
        return { kind: 'timezone', country };
    }

    return null;
}

function isEmptyTool(value: string): value is UtilityEmptyTool {
    return value === 'language' || value === 'currency' || value === 'timezone';
}

/**
 * Classify a search query as a utility intent, or `null` when none.
 * Pure: no I/O. City time queries (e.g. `time in tokyo`) return null.
 */
export function detectUtilityIntent(query: string): UtilityIntent | null {
    const trimmed = query.trim();
    if (!trimmed) return null;

    const exact = normalizeKey(trimmed);
    if (isEmptyTool(exact)) {
        return { kind: 'empty', tool: exact };
    }

    return (
        tryParseCurrencyQuery(trimmed) ??
        tryParseTranslateQuery(trimmed) ??
        tryParseTimezoneQuery(trimmed)
    );
}
