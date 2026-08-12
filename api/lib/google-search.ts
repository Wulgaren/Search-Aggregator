// Google Custom Search on Vercel Edge — OAuth via service account (env vars).

import { asRecord, isRecord, readArray, readNumber, readRecord, readString } from "./unknown.ts";

type ServiceAccountConfig = { client_email: string; private_key: string };

let serviceAccountConfig: ServiceAccountConfig | null = null;
let privateCryptoKey: CryptoKey | null = null;
let lastServiceAccountJson = "";
let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

const TOKEN_BUFFER_MS = 60_000;

export function isGoogleConfigured(): boolean {
    const cx = process.env["GOOGLE_CX"]?.trim();
    const sa = process.env["GOOGLE_SERVICE_ACCOUNT"]?.trim();
    return Boolean(cx && sa);
}

function base64UrlEncode(data: Uint8Array | ArrayBuffer): string {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    // Chunk: large PKCS8/JWT payloads blow `String.fromCharCode(...bytes)` stack.
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlEncodeString(str: string): string {
    return base64UrlEncode(new TextEncoder().encode(str));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
    const pemContents = pem
        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
        .replace(/-----END PRIVATE KEY-----/g, "")
        .replace(/-----BEGIN RSA PRIVATE KEY-----/g, "")
        .replace(/-----END RSA PRIVATE KEY-----/g, "")
        .replace(/\s/g, "");

    const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    return crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );
}

async function getGoogleAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAtMs - TOKEN_BUFFER_MS) {
        return cachedToken.accessToken;
    }

    const serviceAccountJson = process.env["GOOGLE_SERVICE_ACCOUNT"]?.trim();
    if (!serviceAccountJson) {
        throw new Error("Google service account not configured");
    }

    if (serviceAccountJson !== lastServiceAccountJson) {
        lastServiceAccountJson = serviceAccountJson;
        serviceAccountConfig = null;
        privateCryptoKey = null;
        cachedToken = null;
    }

    if (!serviceAccountConfig) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(serviceAccountJson);
        } catch {
            throw new Error("Invalid Google service account JSON");
        }

        const record = asRecord(parsed);
        const client_email = record ? readString(record, "client_email") : undefined;
        const private_key = record ? readString(record, "private_key") : undefined;
        if (!client_email || !private_key) {
            throw new Error("Service account missing client_email or private_key");
        }

        serviceAccountConfig = { client_email, private_key };
    }

    const { client_email, private_key } = serviceAccountConfig;
    const now = Math.floor(Date.now() / 1000);
    const headerEncoded = base64UrlEncodeString(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payloadEncoded = base64UrlEncodeString(
        JSON.stringify({
            iss: client_email,
            scope: "https://www.googleapis.com/auth/cse",
            aud: "https://oauth2.googleapis.com/token",
            iat: now,
            exp: now + 3600,
        })
    );
    const signatureInput = `${headerEncoded}.${payloadEncoded}`;

    if (!privateCryptoKey) {
        privateCryptoKey = await importPrivateKey(private_key);
    }

    const signatureBuffer = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        privateCryptoKey,
        new TextEncoder().encode(signatureInput)
    );
    const jwt = `${signatureInput}.${base64UrlEncode(signatureBuffer)}`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenResponse.ok) {
        const errorData: unknown = await tokenResponse.json().catch(() => ({}));
        const description = isRecord(errorData) ? readString(errorData, "error_description") : undefined;
        throw new Error(description || `Token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData: unknown = await tokenResponse.json();
    const tokenRecord = asRecord(tokenData);
    const accessToken = tokenRecord ? readString(tokenRecord, "access_token") : undefined;
    if (!accessToken) {
        throw new Error("Token exchange returned no access_token");
    }
    const expiresIn = (tokenRecord ? readNumber(tokenRecord, "expires_in") : undefined) || 3600;
    cachedToken = { accessToken, expiresAtMs: Date.now() + expiresIn * 1000 };

    return accessToken;
}

type GoogleSearchResult = {
    title: string;
    url: string;
    displayUrl: string;
    snippet: string;
    source: string;
};

type GoogleImageResult = {
    thumbnail: string;
    full: string;
    title: string;
    sourceUrl: string;
    width?: number;
    height?: number;
    source: string;
};

type GoogleSearchPayload = {
    results: GoogleSearchResult[];
    hasMore: boolean;
    totalResults: string;
    correctedQuery?: string;
    htmlCorrectedQuery?: string;
};

export async function fetchGoogle(query: string, page: number, resultsPerPage: number): Promise<GoogleSearchPayload> {
    const empty: GoogleSearchPayload = { results: [], hasMore: false, totalResults: "0" };
    const cx = process.env["GOOGLE_CX"]?.trim();
    if (!cx || !isGoogleConfigured()) {
        return empty;
    }

    const startIndex = (page - 1) * resultsPerPage + 1;
    if (startIndex > 91) {
        return empty;
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
    });

    if (!response.ok) {
        const errorData: unknown = await response.json().catch(() => ({}));
        const errObj = isRecord(errorData) ? readRecord(errorData, "error") : undefined;
        const message = errObj ? readString(errObj, "message") : undefined;
        throw new Error(message || `Google API error: ${response.status}`);
    }

    const data: unknown = await response.json();
    const dataRecord = asRecord(data);
    const items = dataRecord ? (readArray(dataRecord, "items") ?? []) : [];

    const results = items.flatMap((raw) => {
        const item = asRecord(raw);
        if (!item) return [];
        const title = readString(item, "title");
        const link = readString(item, "link");
        if (!title || !link) return [];
        const displayLink = readString(item, "displayLink");
        let displayUrl = displayLink?.trim() || "";
        if (!displayUrl) {
            try {
                displayUrl = new URL(link).hostname;
            } catch {
                displayUrl = link;
            }
        }
        return [
            {
                title,
                url: link,
                displayUrl,
                snippet: readString(item, "snippet") || "",
                source: "google",
            },
        ];
    });

    const searchInfo = dataRecord ? readRecord(dataRecord, "searchInformation") : undefined;
    const totalResults = parseInt((searchInfo ? readString(searchInfo, "totalResults") : undefined) ?? "", 10) || 0;
    const hasMore = startIndex + results.length - 1 < totalResults && startIndex < 91;
    const spelling = dataRecord ? readRecord(dataRecord, "spelling") : undefined;
    const correctedQuery = spelling ? readString(spelling, "correctedQuery") : undefined;
    const htmlCorrectedQuery = spelling ? readString(spelling, "htmlCorrectedQuery") : undefined;

    const out: GoogleSearchPayload = {
        results,
        hasMore: hasMore && results.length === Math.min(resultsPerPage, 10),
        totalResults: String(totalResults),
    };
    if (correctedQuery !== undefined) out.correctedQuery = correctedQuery;
    if (htmlCorrectedQuery !== undefined) out.htmlCorrectedQuery = htmlCorrectedQuery;
    return out;
}

export async function fetchGoogleImages(query: string, page = 1): Promise<GoogleImageResult[]> {
    const cx = process.env["GOOGLE_CX"]?.trim();
    if (!cx || !isGoogleConfigured()) {
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

        const data: unknown = await response.json();
        const dataRecord = asRecord(data);
        const items = dataRecord ? (readArray(dataRecord, "items") ?? []) : [];

        return items.flatMap((raw): GoogleImageResult[] => {
            const item = asRecord(raw);
            if (!item) return [];
            const image = readRecord(item, "image");
            const link = readString(item, "link");
            const thumbnail = (image ? readString(image, "thumbnailLink") : undefined) || link;
            const full = link;
            if (!thumbnail || !full) return [];
            const mapped: GoogleImageResult = {
                thumbnail,
                full,
                title: readString(item, "title") || "",
                sourceUrl: (image ? readString(image, "contextLink") : undefined) || "",
                source: "google",
            };
            const width = image ? readNumber(image, "width") : undefined;
            const height = image ? readNumber(image, "height") : undefined;
            if (width !== undefined) mapped.width = width;
            if (height !== undefined) mapped.height = height;
            return [mapped];
        });
    } catch {
        return [];
    }
}

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
