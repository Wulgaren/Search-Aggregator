/** Injected by `scripts/build.ts` from env `DISABLE_GOOGLE_BANG` or `disable_google_bang`. */
declare const __DISABLE_GOOGLE_BANG__: boolean;

export function detectBang(query: string): boolean {
    return /^![\w]+(?:\s|$)|\s![\w]+$/.test(query);
}

/** Removes DDG `!g` only (start or end), case-insensitive. */
export function stripGoogleBangFromQuery(query: string): string {
    let s = query.trim();
    s = s.replace(/^!g(?:\s+|$)/i, '').trim();
    s = s.replace(/(?:^|\s)!g$/i, '').trim();
    return s;
}

export type BangResolution = { kind: 'redirect'; q: string } | { kind: 'search'; q: string };

export function resolveQueryForBangHandling(raw: string): BangResolution {
    if (!detectBang(raw)) {
        return { kind: 'search', q: raw };
    }
    if (__DISABLE_GOOGLE_BANG__) {
        const stripped = stripGoogleBangFromQuery(raw);
        if (stripped !== raw) {
            if (detectBang(stripped)) {
                return { kind: 'redirect', q: stripped };
            }
            return { kind: 'search', q: stripped };
        }
    }
    return { kind: 'redirect', q: raw };
}

export function redirectForBang(query: string): void {
    window.location.href = `https://unduck.link?q=${encodeURIComponent(query)}`;
}

export function redirectToGoogleSearch(query: string): void {
    window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
