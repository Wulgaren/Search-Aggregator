/**
 * Google Custom Search (web + images) in the browser. Credentials from localStorage (see api-keys.ts).
 * Brave / Marginalia / Groq are handled by Netlify edge `search.ts`.
 */

import {
    clearStoredGoogleAccessToken,
    getApiSecret,
    getStoredGoogleAccessToken,
    setStoredGoogleAccessToken,
} from "./api-keys";

type Timings = Record<string, number>;

type ServiceAccountConfig = {
    client_email: string;
    private_key: string;
};

let googleServiceAccountConfig: ServiceAccountConfig | null = null;
let googlePrivateCryptoKey: CryptoKey | null = null;
let lastServiceAccountJson = "";

/** Call after user changes Google service account / CX in settings */
export function clearGoogleClientCaches() {
    googleServiceAccountConfig = null;
    googlePrivateCryptoKey = null;
    lastServiceAccountJson = "";
    clearStoredGoogleAccessToken();
}

const SEARCH_JSON_CACHE =
    "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

function buildServerTimingHeader(timings: Timings): string {
    return Object.entries(timings)
        .filter(([, duration]) => Number.isFinite(duration))
        .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
        .join(", ");
}

async function withTiming<T>(
    name: string,
    fn: () => Promise<T>,
    timings: Timings
): Promise<T> {
    const start = performance.now();
    try {
        return await fn();
    } finally {
        timings[name] = performance.now() - start;
    }
}

function base64UrlEncode(data: Uint8Array | ArrayBuffer) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlEncodeString(str: string) {
    const encoder = new TextEncoder();
    return base64UrlEncode(encoder.encode(str));
}

async function importPrivateKey(pem: string) {
    const pemContents = pem
        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
        .replace(/-----END PRIVATE KEY-----/g, "")
        .replace(/-----BEGIN RSA PRIVATE KEY-----/g, "")
        .replace(/-----END RSA PRIVATE KEY-----/g, "")
        .replace(/\s/g, "");

    const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    return await crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );
}

async function getGoogleAccessToken(): Promise<string> {
    const stored = getStoredGoogleAccessToken();
    if (stored) {
        return stored;
    }

    const serviceAccountJson = getApiSecret("GOOGLE_SERVICE_ACCOUNT");
    if (serviceAccountJson !== lastServiceAccountJson) {
        lastServiceAccountJson = serviceAccountJson;
        googleServiceAccountConfig = null;
        googlePrivateCryptoKey = null;
    }

    if (!googleServiceAccountConfig) {
        if (!serviceAccountJson) {
            throw new Error("Google service account not configured");
        }

        let serviceAccount: { client_email?: string; private_key?: string };
        try {
            serviceAccount = JSON.parse(serviceAccountJson);
        } catch {
            throw new Error("Invalid Google service account JSON");
        }

        const { client_email, private_key } = serviceAccount;
        if (!client_email || !private_key) {
            throw new Error("Service account missing client_email or private_key");
        }

        googleServiceAccountConfig = { client_email, private_key };
    }

    const { client_email, private_key } = googleServiceAccountConfig;
    if (!client_email || !private_key) {
        throw new Error("Service account missing client_email or private_key");
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
        iss: client_email,
        scope: "https://www.googleapis.com/auth/cse",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
    };

    const headerEncoded = base64UrlEncodeString(JSON.stringify(header));
    const payloadEncoded = base64UrlEncodeString(JSON.stringify(payload));
    const signatureInput = `${headerEncoded}.${payloadEncoded}`;

    if (!googlePrivateCryptoKey) {
        googlePrivateCryptoKey = await importPrivateKey(private_key);
    }
    const encoder = new TextEncoder();
    const signatureBuffer = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        googlePrivateCryptoKey,
        encoder.encode(signatureInput)
    );
    const signature = base64UrlEncode(new Uint8Array(signatureBuffer));

    const jwt = `${signatureInput}.${signature}`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(
            (errorData as { error_description?: string }).error_description ||
                `Token exchange failed: ${tokenResponse.status}`
        );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token as string;
    const expiresIn = Number(tokenData.expires_in) || 3600;
    setStoredGoogleAccessToken(accessToken, expiresIn);

    return accessToken;
}

async function fetchGoogle(query: string, page: number, resultsPerPage: number) {
    const cx = getApiSecret("GOOGLE_CX");

    if (!cx) {
        return { results: [], hasMore: false, totalResults: "0" };
    }

    if (!getApiSecret("GOOGLE_SERVICE_ACCOUNT")) {
        return { results: [], hasMore: false, totalResults: "0" };
    }

    const startIndex = (page - 1) * resultsPerPage + 1;

    if (startIndex > 91) {
        return { results: [], hasMore: false, totalResults: "0" };
    }

    const accessToken = await getGoogleAccessToken();

    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("cx", cx);
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(resultsPerPage, 10)));
    url.searchParams.set("start", String(startIndex));
    url.searchParams.set("fields", "items(title,link,displayLink,snippet),searchInformation/totalResults");

    const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
            (errorData as { error?: { message?: string } }).error?.message ||
                `Google API error: ${response.status}`
        );
    }

    const data = await response.json();
    const items = data.items || [];

    const results = items.map((item: { title: string; link: string; displayLink: string; snippet?: string }) => ({
        title: item.title,
        url: item.link,
        displayUrl: item.displayLink,
        snippet: item.snippet || "",
        source: "google",
    }));

    const totalResults = parseInt(data.searchInformation?.totalResults) || 0;
    const hasMore = startIndex + results.length - 1 < totalResults && startIndex < 91;

    return {
        results,
        hasMore: hasMore && results.length === Math.min(resultsPerPage, 10),
        totalResults: String(totalResults),
    };
}

async function fetchGoogleImages(query: string, page = 1) {
    const cx = getApiSecret("GOOGLE_CX");

    if (!cx || !getApiSecret("GOOGLE_SERVICE_ACCOUNT")) {
        return [];
    }

    const startIndex = (page - 1) * 10 + 1;
    if (startIndex > 91) {
        return [];
    }

    try {
        const accessToken = await getGoogleAccessToken();

        const url = new URL("https://www.googleapis.com/customsearch/v1");
        url.searchParams.set("cx", cx);
        url.searchParams.set("q", query);
        url.searchParams.set("searchType", "image");
        url.searchParams.set("num", "10");
        url.searchParams.set("start", String(startIndex));

        const response = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        const items = data.items || [];

        return items
            .map(
                (item: {
                    title?: string;
                    link?: string;
                    image?: { thumbnailLink?: string; width?: number; height?: number; contextLink?: string };
                }) => ({
                    thumbnail: item.image?.thumbnailLink || item.link,
                    full: item.link,
                    title: item.title || "",
                    sourceUrl: item.image?.contextLink || "",
                    width: item.image?.width,
                    height: item.image?.height,
                    source: "google",
                })
            )
            .filter((img: { thumbnail?: string; full?: string }) => img.thumbnail && img.full);
    } catch {
        return [];
    }
}

async function fetchBraveImagesViaEdge(
    searchQuery: string,
    page: number,
    origin: string
): Promise<
    Array<{
        thumbnail: string;
        full: string;
        title: string;
        sourceUrl: string;
        width?: number;
        height?: number;
        source: string;
    }>
> {
    const u = new URL("/api/search", origin);
    u.searchParams.set("q", searchQuery);
    u.searchParams.set("source", "images");
    u.searchParams.set("imageSource", "brave");
    u.searchParams.set("page", String(page));
    const response = await fetch(u.toString());
    if (!response.ok) return [];
    const data = await response.json();
    return data.images || [];
}

/** GET /api/search requests that need Google in the browser (edge handles the rest). */
export function isGoogleClientSearchUrl(url: URL): boolean {
    if (url.pathname !== "/api/search") return false;
    const source = url.searchParams.get("source");
    const imageSource = url.searchParams.get("imageSource");
    if (source === "google") return true;
    if (source === "images") {
        if (imageSource === "google") return true;
        if (!imageSource) return true;
    }
    return false;
}

export async function handleGoogleSearchRequest(request: Request): Promise<Response> {
    const requestStart = performance.now();
    const timings: Timings = {};
    const url = new URL(request.url);

    if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    const query = url.searchParams.get("q");
    const page = parseInt(url.searchParams.get("page") ?? "", 10) || 1;
    const source = url.searchParams.get("source");

    if (!query || query.trim() === "") {
        return new Response(
            JSON.stringify({ error: 'Query parameter "q" is required' }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const searchQuery = query.trim();
    const resultsPerPage = 10;
    const origin = url.origin;

    const imageSource = url.searchParams.get("imageSource");

    if (source === "images") {
        let images: Array<Record<string, unknown>> = [];
        let hasMore = true;

        if (imageSource === "google") {
            const googleImages = await withTiming(
                "google_images",
                () => fetchGoogleImages(searchQuery, page),
                timings
            );
            images = googleImages;
            hasMore = page < 10;
        } else {
            const [braveImages, googleImages] = await Promise.allSettled([
                withTiming("brave_images", () => fetchBraveImagesViaEdge(searchQuery, page, origin), timings),
                withTiming("google_images", () => fetchGoogleImages(searchQuery, page), timings),
            ]);

            const allImages = [
                ...(braveImages.status === "fulfilled" ? braveImages.value : []),
                ...(googleImages.status === "fulfilled" ? googleImages.value : []),
            ];

            const seenUrls = new Set<string>();
            images = allImages.filter((img) => {
                const full = String(img.full || "");
                const normalizedUrl = full.replace(/^https?:\/\//, "").replace(/\/$/, "");
                if (seenUrls.has(normalizedUrl)) {
                    return false;
                }
                seenUrls.add(normalizedUrl);
                return true;
            });

            hasMore = page < 3;
        }

        timings.total = performance.now() - requestStart;
        return new Response(JSON.stringify({ images, hasMore }), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": SEARCH_JSON_CACHE,
                "Server-Timing": buildServerTimingHeader(timings),
            },
        });
    }

    if (source === "google") {
        try {
            const google = await withTiming(
                "google",
                () => fetchGoogle(searchQuery, page, resultsPerPage),
                timings
            );
            timings.total = performance.now() - requestStart;
            return new Response(JSON.stringify({ page, google }), {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": SEARCH_JSON_CACHE,
                    "Server-Timing": buildServerTimingHeader(timings),
                },
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            timings.total = performance.now() - requestStart;
            return new Response(
                JSON.stringify({
                    page,
                    google: { error: msg, results: [] },
                }),
                {
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": SEARCH_JSON_CACHE,
                        "Server-Timing": buildServerTimingHeader(timings),
                    },
                }
            );
        }
    }

    return new Response(JSON.stringify({ error: "Not a Google client route" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
    });
}
