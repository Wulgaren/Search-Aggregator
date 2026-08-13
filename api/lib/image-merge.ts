export function dedupeImages<T extends { full?: string }>(images: T[]): T[] {
    const seenUrls = new Set<string>();
    return images.filter((img) => {
        const full = typeof img.full === "string" ? img.full : "";
        const normalizedUrl = full.replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (seenUrls.has(normalizedUrl)) {
            return false;
        }
        seenUrls.add(normalizedUrl);
        return true;
    });
}

/** Round-robin merge: a0, b0, a1, b1, … (skip exhausted side). */
export function interleaveImages<T>(a: T[], b: T[]): T[] {
    const out: T[] = [];
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
        const left = a[i];
        const right = b[i];
        if (left !== undefined) out.push(left);
        if (right !== undefined) out.push(right);
    }
    return out;
}
