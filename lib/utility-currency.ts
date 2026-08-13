/** Edge proxy for Frankfurter FX v2 (free, no API key). Browser never calls Frankfurter. */

import { isRecord, readNumber, readString } from "./unknown.ts";

const FRANKFURTER_RATE_URL = "https://api.frankfurter.dev/v2/rate";
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

function roundFx(value: number): number {
    return Number(value.toPrecision(12));
}

/**
 * Proxy Frankfurter v2 for `kind=currency`.
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

    // Same-currency pair is identity (v2 would return rate 1).
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

    const upstream = `${FRANKFURTER_RATE_URL}/${from}/${to}`;

    try {
        const response = await deps.fetch(upstream, {
            method: "GET",
            headers: { Accept: "application/json" },
            ...(deps.signal ? { signal: deps.signal } : {}),
        });

        if (!response.ok) {
            return errorResult(`Currency provider failed (${String(response.status)}).`);
        }

        const data: unknown = await response.json();
        return parseFrankfurterV2Response(data, amount, from, to);
    } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
            return errorResult("Currency conversion timed out.");
        }
        const msg = e instanceof Error ? e.message : "Currency conversion failed.";
        return errorResult(msg);
    }
}

function parseRate(data: Record<string, unknown>): number | null {
    const numeric = readNumber(data, "rate");
    if (numeric !== undefined && numeric > 0) return numeric;
    const asText = readString(data, "rate");
    if (asText === undefined) return null;
    const parsed = Number(asText);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseFrankfurterV2Response(
    data: unknown,
    amount: number,
    from: string,
    to: string
): UtilityCurrencyResult {
    if (!isRecord(data)) {
        return errorResult("Invalid currency response.");
    }

    const rateNum = parseRate(data);
    if (rateNum === null) {
        const message =
            readString(data, "message") ??
            `No rate available for ${from} → ${to}.`;
        return errorResult(message);
    }

    const base = readString(data, "base");
    const quote = readString(data, "quote");
    if (
        (base !== undefined && base.toUpperCase() !== from) ||
        (quote !== undefined && quote.toUpperCase() !== to)
    ) {
        return errorResult(`No rate available for ${from} → ${to}.`);
    }

    return {
        ok: true,
        kind: "currency",
        amount,
        from,
        to,
        converted: roundFx(amount * rateNum),
        rate: roundFx(rateNum),
    };
}
