/** Narrow `unknown` from JSON / DOM without type assertions. */

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

export function asArray(value: unknown): unknown[] | undefined {
    return Array.isArray(value) ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined;
}

/** Read a property via bracket access (satisfies noPropertyAccessFromIndexSignature). */
export function read(obj: Record<string, unknown>, key: string): unknown {
    return obj[key];
}

export function readString(obj: Record<string, unknown>, key: string): string | undefined {
    return asString(obj[key]);
}

export function readNumber(obj: Record<string, unknown>, key: string): number | undefined {
    return asNumber(obj[key]);
}

export function readBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
    return asBoolean(obj[key]);
}

export function readArray(obj: Record<string, unknown>, key: string): unknown[] | undefined {
    return asArray(obj[key]);
}

export function readRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
    return asRecord(obj[key]);
}
