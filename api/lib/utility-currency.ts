/** Edge proxy for Frankfurter FX (free, no API key). Browser never calls Frankfurter. */

import { asNumber, isRecord, readNumber, readRecord, readString } from "./unknown.ts";

const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";
const CURRENCY_EXAMPLES = ["100 usd to eur", "5 eur to usd"] as const;

export type UtilityCurrencySuccess = {
    ok: true;
    kind: "currency";
    amount: number;
    from: string;
    to: string;
    converted: number;
    rate: number;
};

export type UtilityCurrencyError = {
    ok: false;
    kind: "currency";
    error: string;
    examples: string[];
};

export type UtilityCurrencyResult = UtilityCurrencySuccess | UtilityCurrencyError;

export type UtilityCurrencyDeps = {
    fetch: typeof fetch;
    signal?: AbortSignal;
};

function errorResult(message: string): UtilityCurrencyError {
    return {
        ok: false,
        kind: "currency",
        error: message,
        examples: [...CURRENCY_EXAMPLES],
    };
}

function normalizeCurrencyCode(raw: string | null): string | null {
    if (raw === null) return null;
    const trimmed = raw.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmed)) return null;
    return trimmed;
}

function parseAmount(raw: string | null): number | null {
    if (raw === null || raw.trim() === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

/**
 * Proxy Frankfurter for `kind=currency`.
 * Query params: `amount`, `from`, `to` (plus required search `q` from the router).
 * Success includes converted amount + unit rate; no as-of date, no attribution.
 */
export async function handleUtilityCurrency(
    params: URLSearchParams,
    deps: UtilityCurrencyDeps
): Promise<UtilityCurrencyResult> {
    const amount = parseAmount(params.get("amount"));
    const from = normalizeCurrencyCode(params.get("from"));
    const to = normalizeCurrencyCode(params.get("to"));

    if (amount === null) {
        return errorResult("Enter a positive amount to convert.");
    }
    if (!from || !to) {
        return errorResult("Choose both source and target currencies.");
    }

    // Frankfurter rejects same-currency pairs (422); treat as identity.
    if (from === to) {
        return {
            ok: true,
            kind: "currency",
            amount,
            from,
            to,
            converted: amount,
            rate: 1,
        };
    }

    const upstream = new URL(FRANKFURTER_URL);
    upstream.searchParams.set("amount", String(amount));
    upstream.searchParams.set("from", from);
    upstream.searchParams.set("to", to);

    try {
        const response = await deps.fetch(upstream.toString(), {
            method: "GET",
            headers: { Accept: "application/json" },
            ...(deps.signal ? { signal: deps.signal } : {}),
        });

        if (!response.ok) {
            return errorResult(`Currency provider failed (${String(response.status)}).`);
        }

        const data: unknown = await response.json();
        return parseFrankfurterResponse(data, amount, from, to);
    } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
            return errorResult("Currency conversion timed out.");
        }
        const msg = e instanceof Error ? e.message : "Currency conversion failed.";
        return errorResult(msg);
    }
}

function parseFrankfurterResponse(
    data: unknown,
    amount: number,
    from: string,
    to: string
): UtilityCurrencyResult {
    if (!isRecord(data)) {
        return errorResult("Invalid currency response.");
    }

    const rates = readRecord(data, "rates");
    if (!rates) {
        return errorResult("Invalid currency response.");
    }

    const convertedRaw = rates[to];
    const converted =
        asNumber(convertedRaw) ??
        (typeof convertedRaw === "string" ? Number(convertedRaw) : undefined);
    if (converted === undefined || !Number.isFinite(converted)) {
        const message =
            readString(data, "message") ??
            `No rate available for ${from} → ${to}.`;
        return errorResult(message);
    }

    const baseAmount = readNumber(data, "amount") ?? amount;
    const rateRaw = baseAmount !== 0 ? converted / baseAmount : converted;
    // Avoid binary float noise (e.g. 86.62/100 → 0.8662000000000001)
    const rate = Number(rateRaw.toPrecision(12));

    return {
        ok: true,
        kind: "currency",
        amount,
        from,
        to,
        converted,
        rate,
    };
}
