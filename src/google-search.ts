/**
 * Google Custom Search (web + images) in the browser. Credentials from localStorage (see api-keys.ts).
 * Brave / Marginalia / Groq are handled by Vercel Edge (`api/search.ts`, `api/ai.ts`).
 */

import {
    clearStoredGoogleAccessToken,
    getApiSecret,
    getStoredGoogleAccessToken,
    setStoredGoogleAccessToken,
} from "./api-keys";
import type {
    ImageItem,
    SearchHandler,
    ServiceAccountConfig,
} from "./types";
import { asArray, asRecord, isRecord, readArray, readNumber, readRecord, readString } from "./unknown";

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
const GOOGLE_SEARCH_CACHE_NAME = "search-api-google-v1";
const GOOGLE_SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GOOGLE_SEARCH_EXPIRES_HEADER = "X-Search-Cache-Expires";

async function openGoogleSearchCache(): Promise<Cache | null> {
    if (typeof caches === "undefined") return null;
    try {
        return await caches.open(GOOGLE_SEARCH_CACHE_NAME);
    } catch {
        return null;
    }
}

function withExpiryHeaders(res: Response, expiresAtMs: number): Response {
    const headers = new Headers(res.headers);
    headers.set(GOOGLE_SEARCH_EXPIRES_HEADER, String(expiresAtMs));
    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
    });
}

async function readFromGoogleSearchCache(cache: Cache, request: Request): Promise<Response | null> {
    const hit = await cache.match(request);
    if (!hit) return null;
    const exp = hit.headers.get(GOOGLE_SEARCH_EXPIRES_HEADER);
    if (!exp || Number(exp) <= Date.now()) {
        await cache.delete(request);
        return null;
    }
    return hit;
}

export async function invalidateGoogleSearchCache(): Promise<void> {
    if (typeof caches === "undefined") return;
    try {
        await caches.delete(GOOGLE_SEARCH_CACHE_NAME);
    } catch {
        // ignore
    }
}

/** Cache only Google-client /api/search GET routes in Cache Storage. */
export function createCachedGoogleSearchGet(
    handler: SearchHandler
): (path: string, init?: RequestInit) => Promise<Response> {
    return async function cachedGoogleSearchGet(path: string, init?: RequestInit): Promise<Response> {
        const url = new URL(path, window.location.origin);
        if (!isGoogleClientSearchUrl(url)) {
            return handler(new Request(url.toString(), init));
        }

        const request = new Request(url.toString(), {
            method: 'GET',
            ...(init?.signal != null ? { signal: init.signal } : {}),
        });
        const cache = await openGoogleSearchCache();
        if (cache) {
            const cached = await readFromGoogleSearchCache(cache, request);
            if (cached) return cached.clone();
        }

        const live = await handler(request);
        if (!live.ok || !cache) return live;
        const ct = live.headers.get("content-type") ?? "";
        if (!ct.includes("json")) return live;

        try {
            const body = await live.clone().arrayBuffer();
            const expiresAt = Date.now() + GOOGLE_SEARCH_CACHE_TTL_MS;
            const stored = withExpiryHeaders(
                new Response(body, {
                    status: live.status,
                    statusText: live.statusText,
                    headers: live.headers,
                }),
                expiresAt
            );
            await cache.put(request, stored);
            return stored.clone();
        } catch {
            // quota / private mode
        }

        return live;
    };
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

        let parsed: unknown;
        try {
            parsed = JSON.parse(serviceAccountJson);
        } catch {
            throw new Error("Invalid Google service account JSON");
        }

        const record = asRecord(parsed);
        const client_email = record ? readString(record, 'client_email') : undefined;
        const private_key = record ? readString(record, 'private_key') : undefined;
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
        const errorData: unknown = await tokenResponse.json().catch(() => ({}));
        const desc = isRecord(errorData) ? readString(errorData, 'error_description') : undefined;
        throw new Error(desc || `Token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData: unknown = await tokenResponse.json();
    const tokenRecord = asRecord(tokenData);
    const accessToken = tokenRecord ? readString(tokenRecord, 'access_token') : undefined;
    if (!accessToken) {
        throw new Error("Token exchange returned no access_token");
    }
    const expiresIn = (tokenRecord ? readNumber(tokenRecord, 'expires_in') : undefined) || 3600;
    setStoredGoogleAccessToken(accessToken, expiresIn);

    return accessToken;
}

type GoogleSearchPayload = {
    results: Array<{
        title: string;
        url: string;
        displayUrl: string;
        snippet: string;
        source: string;
    }>;
    hasMore: boolean;
    totalResults: string;
    correctedQuery?: string;
    htmlCorrectedQuery?: string;
};

async function fetchGoogle(
    query: string,
    page: number,
    resultsPerPage: number,
    signal?: AbortSignal
): Promise<GoogleSearchPayload> {
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
    url.searchParams.set(
        "fields",
        "items(title,link,displayLink,snippet),searchInformation/totalResults,spelling(correctedQuery,htmlCorrectedQuery)"
    );

    const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
        const errorData: unknown = await response.json().catch(() => ({}));
        const errObj = isRecord(errorData) ? readRecord(errorData, 'error') : undefined;
        const message = errObj ? readString(errObj, 'message') : undefined;
        throw new Error(message || `Google API error: ${response.status}`);
    }

    const data: unknown = await response.json();
    const dataRecord = asRecord(data);
    const items = dataRecord ? (readArray(dataRecord, 'items') ?? []) : [];

    const results = items.flatMap((raw) => {
        const item = asRecord(raw);
        if (!item) return [];
        const title = readString(item, 'title');
        const link = readString(item, 'link');
        const displayLink = readString(item, 'displayLink');
        if (!title || !link || !displayLink) return [];
        return [
            {
                title,
                url: link,
                displayUrl: displayLink,
                snippet: readString(item, 'snippet') || "",
                source: "google",
            },
        ];
    });

    const searchInfo = dataRecord ? readRecord(dataRecord, 'searchInformation') : undefined;
    const totalResults = parseInt((searchInfo ? readString(searchInfo, 'totalResults') : undefined) ?? "", 10) || 0;
    const hasMore = startIndex + results.length - 1 < totalResults && startIndex < 91;
    const spelling = dataRecord ? readRecord(dataRecord, 'spelling') : undefined;
    const correctedQuery = spelling ? readString(spelling, 'correctedQuery') : undefined;
    const htmlCorrectedQuery = spelling ? readString(spelling, 'htmlCorrectedQuery') : undefined;

    const payload: GoogleSearchPayload = {
        results,
        hasMore: hasMore && results.length === Math.min(resultsPerPage, 10),
        totalResults: String(totalResults),
    };
    if (correctedQuery !== undefined) payload.correctedQuery = correctedQuery;
    if (htmlCorrectedQuery !== undefined) payload.htmlCorrectedQuery = htmlCorrectedQuery;
    return payload;
}

async function fetchGoogleImages(query: string, page = 1, signal?: AbortSignal) {
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
            ...(signal ? { signal } : {}),
        });

        if (!response.ok) {
            return [];
        }

        const data: unknown = await response.json();
        const dataRecord = asRecord(data);
        const items = dataRecord ? (readArray(dataRecord, 'items') ?? []) : [];

        return items.flatMap((raw): ImageItem[] => {
            const item = asRecord(raw);
            const image = item ? readRecord(item, 'image') : undefined;
            const link = item ? readString(item, 'link') : undefined;
            const thumbnail = (image ? readString(image, 'thumbnailLink') : undefined) || link;
            const full = link;
            if (!thumbnail || !full) return [];
            const out: ImageItem = {
                thumbnail,
                full,
                title: (item ? readString(item, 'title') : undefined) || '',
                sourceUrl: (image ? readString(image, 'contextLink') : undefined) || '',
                source: 'google',
            };
            const width = image ? readNumber(image, 'width') : undefined;
            if (width !== undefined) out.width = width;
            const height = image ? readNumber(image, 'height') : undefined;
            if (height !== undefined) out.height = height;
            return [out];
        });
    } catch (e) {
        if (e instanceof Error && e.name === "AbortError") throw e;
        return [];
    }
}

type BraveSourcePayload = {
    error?: string;
    results: Array<Record<string, unknown>>;
    hasMore: boolean;
};

async function fetchBraveWebViaEdge(
    searchQuery: string,
    page: number,
    origin: string
): Promise<BraveSourcePayload | null> {
    const u = new URL("/api/search", origin);
    u.searchParams.set("q", searchQuery);
    u.searchParams.set("source", "brave");
    u.searchParams.set("page", String(page));
    const response = await fetch(u.toString());
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const braveRaw = isRecord(data) ? data['brave'] : undefined;
    const brave = parseBraveSourcePayload(braveRaw);
    if (!brave || brave.error || !brave.results.length) return null;
    return brave;
}

function parseBraveSourcePayload(value: unknown): BraveSourcePayload | null {
    if (!isRecord(value)) return null;
    const resultsRaw = readArray(value, 'results');
    if (!resultsRaw) return null;
    const payload: BraveSourcePayload = {
        results: resultsRaw.filter(isRecord),
        hasMore: Boolean(value['hasMore']),
    };
    const error = readString(value, 'error');
    if (error !== undefined) payload.error = error;
    return payload;
}

async function fetchBraveImagesViaEdge(
    searchQuery: string,
    page: number,
    origin: string,
    signal?: AbortSignal
): Promise<ImageItem[]> {
    const u = new URL("/api/search", origin);
    u.searchParams.set("q", searchQuery);
    u.searchParams.set("source", "images");
    u.searchParams.set("imageSource", "brave");
    u.searchParams.set("page", String(page));
    const response = await fetch(u.toString(), {
        ...(signal ? { signal } : {}),
    });
    if (!response.ok) return [];
    const data: unknown = await response.json();
    return parseImageItems(isRecord(data) ? data['images'] : undefined);
}

function parseImageItems(value: unknown): ImageItem[] {
    const items = asArray(value);
    if (!items) return [];
    return items.flatMap((raw) => {
        const item = asRecord(raw);
        if (!item) return [];
        const thumbnail = readString(item, 'thumbnail');
        const full = readString(item, 'full');
        if (!thumbnail || !full) return [];
        const out: ImageItem = { thumbnail, full, title: readString(item, 'title') || '' };
        const sourceUrl = readString(item, 'sourceUrl');
        if (sourceUrl !== undefined) out.sourceUrl = sourceUrl;
        const sourceLinkText = readString(item, 'sourceLinkText');
        if (sourceLinkText !== undefined) out.sourceLinkText = sourceLinkText;
        const width = readNumber(item, 'width');
        if (width !== undefined) out.width = width;
        const height = readNumber(item, 'height');
        if (height !== undefined) out.height = height;
        const source = readString(item, 'source');
        if (source !== undefined) out.source = source;
        return [out];
    });
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
        let images: ImageItem[] = [];
        let hasMore = true;
        const signal = request.signal;

        if (imageSource === "google") {
            const googleImages = await fetchGoogleImages(searchQuery, page, signal);
            images = googleImages;
            hasMore = page < 10;
            if (images.length === 0) {
                const braveImages = await fetchBraveImagesViaEdge(searchQuery, page, origin, signal);
                images = braveImages;
                hasMore = page < 3;
            }
        } else {
            const [braveImages, googleImages] = await Promise.allSettled([
                fetchBraveImagesViaEdge(searchQuery, page, origin, signal),
                fetchGoogleImages(searchQuery, page, signal),
            ]);

            const allImages = [
                ...(braveImages.status === "fulfilled" ? braveImages.value : []),
                ...(googleImages.status === "fulfilled" ? googleImages.value : []),
            ];

            const seenUrls = new Set<string>();
            images = allImages.filter((img) => {
                const full = img.full || "";
                const normalizedUrl = full.replace(/^https?:\/\//, "").replace(/\/$/, "");
                if (seenUrls.has(normalizedUrl)) {
                    return false;
                }
                seenUrls.add(normalizedUrl);
                return true;
            });

            hasMore = page < 3;
        }
        return new Response(JSON.stringify({ images, hasMore }), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": SEARCH_JSON_CACHE,
            },
        });
    }

    if (source === "google") {
        try {
            const google = await fetchGoogle(searchQuery, page, resultsPerPage, request.signal);
            return new Response(JSON.stringify({ page, google }), {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": SEARCH_JSON_CACHE,
                },
            });
        } catch (e) {
            if (e instanceof Error && e.name === "AbortError") throw e;
            const msg = e instanceof Error ? e.message : String(e);
            let brave: BraveSourcePayload | undefined;
            try {
                const braveFallback = await fetchBraveWebViaEdge(searchQuery, page, origin);
                if (braveFallback) brave = braveFallback;
            } catch {
                // Brave fallback is best-effort
            }
            return new Response(
                JSON.stringify({
                    page,
                    google: { error: msg, results: [], hasMore: false },
                    ...(brave ? { brave } : {}),
                }),
                {
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": SEARCH_JSON_CACHE,
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
