import { isTimezoneCountry } from '../lib/country-timezones.ts';
import { guessSourceLanguage } from './guess-source-language';
import { languageDefaultsFromLocale, type UtilityIntent } from './utility-intent';

/** Locale → ISO alpha-2 country for empty timezone tool / early fetch. */
export function defaultCountryFromLocale(
    language: string = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
): string {
    try {
        const region = new Intl.Locale(language).maximize().region;
        if (region) {
            const lower = region.toLowerCase();
            if (isTimezoneCountry(lower)) return lower;
        }
    } catch {
        // fall through
    }
    return 'us';
}

export function buildCurrencyUtilityPath(input: {
    amount: number;
    from: string;
    to: string;
}): string {
    const params = new URLSearchParams({
        q: `${String(input.amount)} ${input.from} to ${input.to}`,
        source: 'utility',
        kind: 'currency',
        amount: String(input.amount),
        from: input.from,
        to: input.to,
    });
    return `/api/search?${params.toString()}`;
}

/**
 * Resolve from/to for a translate intent: explicit langs win; else local text
 * guess for source; else locale defaults. Avoids from === to when possible.
 */
export function resolveTranslateLanguages(
    text: string,
    fromRaw: string | undefined,
    toRaw: string | undefined,
    locale?: string
): { from: string; to: string } {
    const defaults = languageDefaultsFromLocale(locale);
    let from = fromRaw ?? guessSourceLanguage(text) ?? defaults.from;
    const to = toRaw ?? (fromRaw === defaults.to ? defaults.from : defaults.to);
    if (from === to) {
        if (defaults.from !== to) from = defaults.from;
        else from = to === 'en' ? 'es' : 'en';
    }
    return { from, to };
}

export function buildTranslateUtilityPath(input: {
    text: string;
    from: string;
    to: string;
}): string {
    const params = new URLSearchParams({
        q: input.text,
        source: 'utility',
        kind: 'translate',
        text: input.text,
        from: input.from,
        to: input.to,
    });
    return `/api/search?${params.toString()}`;
}

export function buildTimezoneUtilityPath(country: string): string {
    const params = new URLSearchParams({
        q: country,
        source: 'utility',
        kind: 'timezone',
        country,
    });
    return `/api/search?${params.toString()}`;
}

/**
 * API path for early utility fetch, or `null` when intent needs no network
 * (empty language/currency tools, empty translate text).
 */
export function buildUtilityEarlyFetchPath(intent: UtilityIntent): string | null {
    if (intent.kind === 'currency') {
        return buildCurrencyUtilityPath({
            amount: intent.amount,
            from: intent.from,
            to: intent.to,
        });
    }
    if (intent.kind === 'translate') {
        const text = intent.text.trim();
        if (!text) return null;
        const { from, to } = resolveTranslateLanguages(text, intent.from, intent.to);
        if (!from || !to || from === to) return null;
        return buildTranslateUtilityPath({ text, from, to });
    }
    if (intent.kind === 'timezone') {
        return buildTimezoneUtilityPath(intent.country);
    }
    if (intent.kind === 'empty' && intent.tool === 'timezone') {
        return buildTimezoneUtilityPath(defaultCountryFromLocale());
    }
    return null;
}
