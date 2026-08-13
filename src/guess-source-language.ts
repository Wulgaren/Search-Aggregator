/**
 * Lightweight local source-language guess for translate.
 * Uses scripts + distinctive diacritics. No network. Returns null when weak
 * (plain ASCII Latin, ties, unknown) so callers can fall back to locale.
 */

/** Distinctive letters → language codes (only codes in the translate picker). */
const DIACRITIC_MARKERS: ReadonlyArray<{ code: string; chars: string }> = [
    { code: 'pl', chars: 'ąćęłńóśźż' },
    { code: 'cs', chars: 'ěščřžýůú' },
    { code: 'hu', chars: 'őű' },
    { code: 'ro', chars: 'ăâîșț' },
    { code: 'tr', chars: 'ğış' },
    { code: 'vi', chars: 'ơưđ' },
    { code: 'de', chars: 'ß' },
    { code: 'sv', chars: 'å' },
    { code: 'no', chars: 'æø' },
    { code: 'da', chars: 'æø' },
    { code: 'pt', chars: 'ãõ' },
    { code: 'es', chars: 'ñ' },
    { code: 'fr', chars: 'œæ' },
];

const KNOWN = new Set(DIACRITIC_MARKERS.map((m) => m.code).concat([
    'en',
    'ru',
    'uk',
    'zh',
    'ja',
    'ko',
    'ar',
    'he',
    'el',
    'th',
    'hi',
    'it',
    'nl',
]));

function countMarkerHits(text: string, chars: string): number {
    const set = new Set([...chars.toLowerCase(), ...chars.toUpperCase()]);
    let n = 0;
    for (const ch of text) {
        if (set.has(ch)) n += 1;
    }
    return n;
}

function guessFromDiacritics(text: string): string | null {
    let bestCode: string | null = null;
    let bestHits = 0;
    let tied = false;
    for (const marker of DIACRITIC_MARKERS) {
        const hits = countMarkerHits(text, marker.chars);
        if (hits === 0) continue;
        if (hits > bestHits) {
            bestHits = hits;
            bestCode = marker.code;
            tied = false;
        } else if (hits === bestHits) {
            tied = true;
        }
    }
    if (tied || bestHits === 0 || !bestCode) return null;
    return bestCode;
}

function guessFromScript(text: string): string | null {
    let cyrillic = 0;
    let ukrainian = 0;
    let hangul = 0;
    let hiragana = 0;
    let katakana = 0;
    let cjk = 0;
    let arabic = 0;
    let hebrew = 0;
    let greek = 0;
    let thai = 0;
    let devanagari = 0;

    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp === undefined) continue;
        if (cp >= 0x0400 && cp <= 0x04ff) {
            cyrillic += 1;
            if ('іїєґІЇЄҐ'.includes(ch)) ukrainian += 1;
        } else if (cp >= 0xac00 && cp <= 0xd7af) hangul += 1;
        else if (cp >= 0x3040 && cp <= 0x309f) hiragana += 1;
        else if (cp >= 0x30a0 && cp <= 0x30ff) katakana += 1;
        else if (cp >= 0x4e00 && cp <= 0x9fff) cjk += 1;
        else if (cp >= 0x0600 && cp <= 0x06ff) arabic += 1;
        else if (cp >= 0x0590 && cp <= 0x05ff) hebrew += 1;
        else if (cp >= 0x0370 && cp <= 0x03ff) greek += 1;
        else if (cp >= 0x0e00 && cp <= 0x0e7f) thai += 1;
        else if (cp >= 0x0900 && cp <= 0x097f) devanagari += 1;
    }

    if (hangul > 0) return 'ko';
    if (hiragana > 0 || katakana > 0) return 'ja';
    if (cjk > 0) return 'zh';
    if (arabic > 0) return 'ar';
    if (hebrew > 0) return 'he';
    if (greek > 0) return 'el';
    if (thai > 0) return 'th';
    if (devanagari > 0) return 'hi';
    if (cyrillic > 0) return ukrainian > 0 ? 'uk' : 'ru';
    return null;
}

/**
 * Guess BCP-47-ish primary language of `text`, or null when confidence is low.
 * Only returns codes we can use in the translate picker.
 */
export function guessSourceLanguage(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const fromScript = guessFromScript(trimmed);
    if (fromScript && KNOWN.has(fromScript)) return fromScript;

    const fromMarks = guessFromDiacritics(trimmed);
    if (fromMarks && KNOWN.has(fromMarks)) return fromMarks;

    return null;
}
