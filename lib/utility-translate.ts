/** Edge proxy for MyMemory translate (free, no API key). Browser never calls MyMemory. */

import { asRecord, isRecord, readString } from "./unknown.ts";

const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const TRANSLATE_EXAMPLES = ["translate hello to french", "how do you say goodbye in german"] as const;
/** MyMemory anonymous limit is 500 bytes for `q`. */
const MAX_TEXT_BYTES = 500;

export type UtilityTranslateSuccess = {
    ok: true;
    kind: "translate";
    text: string;
    from: string;
    to: string;
    translatedText: string;
};

export type UtilityTranslateError = {
    ok: false;
    kind: "translate";
    error: string;
    examples: string[];
};

export type UtilityTranslateResult = UtilityTranslateSuccess | UtilityTranslateError;

export type UtilityTranslateDeps = {
    fetch: typeof fetch;
    signal?: AbortSignal;
};

function utf8ByteLength(s: string): number {
    return new TextEncoder().encode(s).length;
}

function errorResult(message: string): UtilityTranslateError {
    return {
        ok: false,
        kind: "translate",
        error: message,
        examples: [...TRANSLATE_EXAMPLES],
    };
}

function normalizeLang(raw: string | null): string | null {
    if (raw === null) return null;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    // Accept short codes (en, zh) or BCP-47 primaries (en-us → en)
    const primary = trimmed.split(/[-_]/)[0];
    if (!primary || !/^[a-z]{2,3}$/.test(primary)) return null;
    return primary;
}

/**
 * Proxy MyMemory for `kind=translate`.
 * Query params: `text`, `from`, `to` (plus required search `q` from the router).
 */
export async function handleUtilityTranslate(
    params: URLSearchParams,
    deps: UtilityTranslateDeps
): Promise<UtilityTranslateResult> {
    const text = (params.get("text") ?? "").trim();
    const from = normalizeLang(params.get("from"));
    const to = normalizeLang(params.get("to"));

    if (!text) {
        return errorResult("Missing text to translate.");
    }
    if (!from || !to) {
        return errorResult("Choose both source and target languages.");
    }
    if (from === to) {
        return errorResult("Source and target languages must differ.");
    }
    if (utf8ByteLength(text) > MAX_TEXT_BYTES) {
        return errorResult(`Text is too long (max ${String(MAX_TEXT_BYTES)} bytes).`);
    }

    const upstream = new URL(MYMEMORY_URL);
    upstream.searchParams.set("q", text);
    upstream.searchParams.set("langpair", `${from}|${to}`);

    try {
        const response = await deps.fetch(upstream.toString(), {
            method: "GET",
            headers: { Accept: "application/json" },
            ...(deps.signal ? { signal: deps.signal } : {}),
        });

        if (!response.ok) {
            return errorResult(`Translation provider failed (${String(response.status)}).`);
        }

        const data: unknown = await response.json();
        return parseMyMemoryResponse(data, text, from, to);
    } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
            return errorResult("Translation timed out.");
        }
        const msg = e instanceof Error ? e.message : "Translation request failed.";
        return errorResult(msg);
    }
}

function parseMyMemoryResponse(
    data: unknown,
    text: string,
    from: string,
    to: string
): UtilityTranslateResult {
    if (!isRecord(data)) {
        return errorResult("Invalid translation response.");
    }

    const statusRaw = data["responseStatus"];
    const status =
        typeof statusRaw === "number"
            ? statusRaw
            : typeof statusRaw === "string"
              ? Number(statusRaw)
              : NaN;

    const responseData = asRecord(data["responseData"]);
    const translatedText = responseData ? readString(responseData, "translatedText") : undefined;

    if (!Number.isFinite(status) || status !== 200 || !translatedText?.trim()) {
        const details =
            readString(data, "responseDetails") ??
            (translatedText?.trim() ? translatedText.trim() : null) ??
            "Translation failed.";
        return errorResult(details);
    }

    // MyMemory sometimes returns 200 with an error string as translatedText
    const lower = translatedText.trim().toLowerCase();
    if (
        lower.includes("invalid") &&
        (lower.includes("language") || lower.includes("langpair"))
    ) {
        return errorResult(translatedText.trim());
    }

    return {
        ok: true,
        kind: "translate",
        text,
        from,
        to,
        translatedText: translatedText.trim(),
    };
}
