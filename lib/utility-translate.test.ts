import { afterEach, describe, expect, it, vi } from "vitest";
import { handleUtilityTranslate } from "./utility-translate.ts";

function params(entries: Record<string, string>): URLSearchParams {
    return new URLSearchParams(entries);
}

describe("handleUtilityTranslate", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns error when text or langs missing", async () => {
        const fetchMock = vi.fn();
        await expect(
            handleUtilityTranslate(params({ from: "en", to: "fr" }), { fetch: fetchMock })
        ).resolves.toMatchObject({
            ok: false,
            kind: "translate",
            error: "Missing text to translate.",
        });
        await expect(
            handleUtilityTranslate(params({ text: "hello", to: "fr" }), { fetch: fetchMock })
        ).resolves.toMatchObject({
            ok: false,
            error: "Choose both source and target languages.",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("proxies MyMemory and returns normalized success JSON", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            expect(url).toContain("api.mymemory.translated.net/get");
            expect(url).toContain("q=hello");
            expect(url).toContain(encodeURIComponent("en|fr"));
            return new Response(
                JSON.stringify({
                    responseData: { translatedText: "bonjour", match: 1 },
                    responseStatus: 200,
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        });

        const result = await handleUtilityTranslate(
            params({ text: "hello", from: "en", to: "fr" }),
            { fetch: fetchMock }
        );

        expect(result).toEqual({
            ok: true,
            kind: "translate",
            text: "hello",
            from: "en",
            to: "fr",
            translatedText: "bonjour",
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("maps provider HTTP failure to error + examples", async () => {
        const fetchMock = vi.fn(
            async () => new Response("nope", { status: 503, statusText: "Unavailable" })
        );

        const result = await handleUtilityTranslate(
            params({ text: "hello", from: "en", to: "fr" }),
            { fetch: fetchMock }
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain("503");
        expect(result.examples).toEqual([
            "translate hello to french",
            "how do you say goodbye in german",
        ]);
    });

    it("maps MyMemory invalid language pair payload to error", async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        responseData: {
                            translatedText: "INVALID LANGUAGE PAIR SPECIFIED. EXAMPLE: LANGPAIR=EN|IT USING 2 LETTER ISO OR RFC3066 LIKE ZH-CN. ALMOST ALL LANGUAGES SUPPORTED BUT SOME LIKE ZH-CN OR ZH-TW MAY BE A BIT DIFFERENT",
                        },
                        responseStatus: 200,
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } }
                )
        );

        const result = await handleUtilityTranslate(
            params({ text: "hi", from: "xx", to: "yy" }),
            { fetch: fetchMock }
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.toLowerCase()).toContain("invalid");
    });
});
