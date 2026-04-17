// Conservative client-side spell correction.
// Loads the SymSpell English frequency dictionary (82,765 words) as a static
// asset, then for each submit corrects tokens that are almost certainly typos
// while leaving short tokens, acronyms, and known words alone. Only single-word
// Lookup is performed; no compound word segmentation (so "nin" stays "nin").

type Spell = {
    freq: Map<string, number>;
    byLength: Map<number, Array<[string, number]>>;
};

let spell: Spell | null = null;
let loading: Promise<void> | null = null;

const DICT_URL = '/dict/frequency_dictionary_en_82_765.txt';
const MAX_DIST = 2;
const MIN_LEN = 4;

export function preloadSpellcheck(): Promise<void> {
    if (spell) return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
        try {
            const res = await fetch(DICT_URL, { credentials: 'omit' });
            if (!res.ok) return;
            const text = await res.text();
            const freq = new Map<string, number>();
            const byLength = new Map<number, Array<[string, number]>>();
            const lines = text.split('\n');
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;
                const sp = line.indexOf(' ');
                if (sp <= 0) continue;
                const word = line.slice(0, sp).toLowerCase();
                const n = Number(line.slice(sp + 1));
                if (!word || !Number.isFinite(n) || n <= 0) continue;
                freq.set(word, n);
                let bucket = byLength.get(word.length);
                if (!bucket) {
                    bucket = [];
                    byLength.set(word.length, bucket);
                }
                bucket.push([word, n]);
            }
            if (freq.size === 0) return;
            spell = { freq, byLength };
        } catch {
            // Swallow: failure means autocorrect stays silently disabled.
        } finally {
            loading = null;
        }
    })();
    return loading;
}

export function isSpellReady(): boolean {
    return spell !== null;
}

export type CorrectionResult = { corrected: string | null; ready: boolean };

export function maybeCorrect(query: string): CorrectionResult {
    if (!spell) return { corrected: null, ready: false };
    if (!query.trim()) return { corrected: null, ready: true };
    if (isBangOrOperatorQuery(query)) return { corrected: null, ready: true };

    const parts = query.split(/(\s+)/);
    let changed = false;
    const out: string[] = [];
    for (const part of parts) {
        if (part === '' || /^\s+$/.test(part)) {
            out.push(part);
            continue;
        }
        const replaced = correctToken(part);
        if (replaced !== null && replaced !== part) {
            changed = true;
            out.push(replaced);
        } else {
            out.push(part);
        }
    }
    if (!changed) return { corrected: null, ready: true };
    return { corrected: out.join(''), ready: true };
}

function isBangOrOperatorQuery(query: string): boolean {
    // Don't mangle bang redirects, quoted phrases, or URL-ish queries.
    if (/^!\w+(?:\s|$)|\s!\w+$/.test(query)) return true;
    if (/["']/.test(query)) return true;
    if (/\bhttps?:\/\//i.test(query)) return true;
    if (/\bsite:|filetype:|intitle:|inurl:/i.test(query)) return true;
    return false;
}

function correctToken(token: string): string | null {
    // Peel leading/trailing punctuation so "hello," or "(word)" still get corrected.
    const match = token.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}'’\-]*)([^\p{L}\p{N}]*)$/u);
    if (!match) return null;
    const [, pre, core, post] = match;
    if (!core) return null;
    if (core.length < MIN_LEN) return null;
    if (/\d/.test(core)) return null;
    if (/[-'’]/.test(core)) return null; // skip hyphenated or possessive forms
    if (isAllCaps(core)) return null;

    const lower = core.toLowerCase();
    const index = spell!;
    if (index.freq.has(lower)) return null;

    const minLen = Math.max(1, lower.length - MAX_DIST);
    const maxLen = lower.length + MAX_DIST;
    let bestWord: string | null = null;
    let bestDist = MAX_DIST + 1;
    let bestFreq = 0;
    for (let len = minLen; len <= maxLen; len++) {
        const bucket = index.byLength.get(len);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
            const entry = bucket[i];
            const candidate = entry[0];
            const freq = entry[1];
            const d = damerauLevenshtein(lower, candidate, bestDist);
            if (d < 0) continue;
            if (d < bestDist || (d === bestDist && freq > bestFreq)) {
                bestWord = candidate;
                bestDist = d;
                bestFreq = freq;
            }
        }
    }
    if (!bestWord || bestDist > MAX_DIST || bestFreq <= 0) return null;

    return pre + restoreCase(core, bestWord) + post;
}

function isAllCaps(s: string): boolean {
    let hasLetter = false;
    for (const ch of s) {
        const upper = ch.toUpperCase();
        const lower = ch.toLowerCase();
        if (upper === lower) continue;
        hasLetter = true;
        if (ch !== upper) return false;
    }
    return hasLetter;
}

function restoreCase(original: string, replacement: string): string {
    const firstOrig = original[0];
    const firstRepl = replacement[0];
    if (!firstOrig || !firstRepl) return replacement;
    if (firstOrig === firstOrig.toUpperCase() && firstOrig !== firstOrig.toLowerCase()) {
        return firstRepl.toUpperCase() + replacement.slice(1);
    }
    return replacement;
}

function damerauLevenshtein(a: string, b: string, maxDist: number): number {
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > maxDist) return -1;
    if (m === 0) return n <= maxDist ? n : -1;
    if (n === 0) return m <= maxDist ? m : -1;

    let prev2 = new Array<number>(n + 1).fill(0);
    let prev1 = new Array<number>(n + 1);
    let curr = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev1[j] = j;

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        let rowMin = i;
        const ai = a.charCodeAt(i - 1);
        const aPrev = i > 1 ? a.charCodeAt(i - 2) : -1;
        for (let j = 1; j <= n; j++) {
            const bj = b.charCodeAt(j - 1);
            const cost = ai === bj ? 0 : 1;
            let v = curr[j - 1] + 1;
            const up = prev1[j] + 1;
            if (up < v) v = up;
            const diag = prev1[j - 1] + cost;
            if (diag < v) v = diag;
            if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && aPrev === bj) {
                const trans = prev2[j - 2] + 1;
                if (trans < v) v = trans;
            }
            curr[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > maxDist) return -1;
        const tmp = prev2;
        prev2 = prev1;
        prev1 = curr;
        curr = tmp;
    }
    const result = prev1[n];
    return result > maxDist ? -1 : result;
}
