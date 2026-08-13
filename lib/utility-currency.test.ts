import { afterEach, describe, expect, it, vi } from "vitest";
import { handleUtilityCurrency } from "./utility-currency.ts";

function params(entries: Record<string, string>): URLSearchParams {
    return new URLSearchParams(entries);
}

describe("handleUtilityCurrency", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns error when amount or currencies missing", async () => {
        const fetchMock = vi.fn();
        await expect(
            handleUtilityCurrency(params({ from: "USD", to: "EUR" }), { fetch: fetchMock })
        ).resolves.toMatchObject({
            ok: false,
            kind: "currency",
            error: "Enter a positive amount to convert.",
        });
        await expect(
            handleUtilityCurrency(params({ amount: "100", to: "EUR" }), { fetch: fetchMock })
        ).resolves.toMatchObject({
            ok: false,
            error: "Choose both source and target currencies.",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns identity conversion without upstream when from === to", async () => {
        const fetchMock = vi.fn();
        await expect(
            handleUtilityCurrency(params({ amount: "50", from: "USD", to: "USD" }), {
                fetch: fetchMock,
            })
        ).resolves.toEqual({
            ok: true,
            kind: "currency",
            amount: 50,
            from: "USD",
            to: "USD",
            converted: 50,
            rate: 1,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("proxies Frankfurter and returns converted amount + rate (no date)", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            expect(url).toBe("https://api.frankfurter.dev/v2/rate/USD/EUR");
            return new Response(
                JSON.stringify({
                    date: "2026-08-12",
                    base: "USD",
                    quote: "EUR",
                    rate: 0.8662,
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        });

        const result = await handleUtilityCurrency(
            params({ amount: "100", from: "USD", to: "EUR" }),
            { fetch: fetchMock }
        );

        expect(result).toEqual({
            ok: true,
            kind: "currency",
            amount: 100,
            from: "USD",
            to: "EUR",
            converted: 86.62,
            rate: 0.8662,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result).not.toHaveProperty("date");
        expect(JSON.stringify(result)).not.toMatch(/frankfurter|attribution|ecb/i);
    });

    it("converts PKR to PLN from v2 unit rate", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            expect(url).toBe("https://api.frankfurter.dev/v2/rate/PKR/PLN");
            return new Response(
                JSON.stringify({
                    date: "2026-08-13",
                    base: "PKR",
                    quote: "PLN",
                    rate: 0.01339,
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        });

        await expect(
            handleUtilityCurrency(params({ amount: "1000", from: "PKR", to: "PLN" }), {
                fetch: fetchMock,
            })
        ).resolves.toEqual({
            ok: true,
            kind: "currency",
            amount: 1000,
            from: "PKR",
            to: "PLN",
            converted: 13.39,
            rate: 0.01339,
        });
    });

    it("maps provider HTTP failure to error + examples", async () => {
        const fetchMock = vi.fn(
            async () => new Response("nope", { status: 503, statusText: "Unavailable" })
        );

        const result = await handleUtilityCurrency(
            params({ amount: "10", from: "USD", to: "EUR" }),
            { fetch: fetchMock }
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain("503");
        expect(result.examples).toEqual(["100 usd to eur", "5 eur to usd"]);
    });
});
