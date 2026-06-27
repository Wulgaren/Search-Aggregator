// Google Custom Search on Vercel Edge — OAuth via service account (env vars).

type ServiceAccountConfig = { client_email: string; private_key: string };

type GoogleWebItem = {
    title: string;
    link: string;
    displayLink: string;
    snippet?: string;
};

type GoogleImageItem = {
    title?: string;
    link: string;
    image?: {
        thumbnailLink?: string;
        contextLink?: string;
        width?: number;
        height?: number;
    };
};

let serviceAccountConfig: ServiceAccountConfig | null = null;
let privateCryptoKey: CryptoKey | null = null;
let lastServiceAccountJson = "";
let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

const TOKEN_BUFFER_MS = 60_000;

export function isGoogleConfigured(): boolean {
    const cx = process.env.GOOGLE_CX?.trim();
    const sa = process.env.GOOGLE_SERVICE_ACCOUNT?.trim();
    return Boolean(cx && sa);
}

function base64UrlEncode(data: Uint8Array | ArrayBuffer): string {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const base64 = btoa(String.fromCharCode(...bytes));
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

    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT?.trim();
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
        let parsed: Partial<ServiceAccountConfig>;
        try {
            parsed = JSON.parse(serviceAccountJson);
        } catch {
            throw new Error("Invalid Google service account JSON");
        }

        const { client_email, private_key } = parsed;
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
        const errorData = await tokenResponse.json().catch(() => ({}));
        const description =
            typeof errorData.error_description === "string"
                ? errorData.error_description
                : `Token exchange failed: ${tokenResponse.status}`;
        throw new Error(description);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token as string;
    const expiresIn = Number(tokenData.expires_in) || 3600;
    cachedToken = { accessToken, expiresAtMs: Date.now() + expiresIn * 1000 };

    return accessToken;
}

export async function fetchGoogle(query: string, page: number, resultsPerPage: number) {
    const cx = process.env.GOOGLE_CX?.trim();
    if (!cx || !isGoogleConfigured()) {
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
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message =
            typeof errorData?.error?.message === "string"
                ? errorData.error.message
                : `Google API error: ${response.status}`;
        throw new Error(message);
    }

    const data = await response.json();
    const items = data.items || [];
    const results = items.map((item: GoogleWebItem) => ({
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
        correctedQuery:
            typeof data.spelling?.correctedQuery === "string" ? data.spelling.correctedQuery : undefined,
        htmlCorrectedQuery:
            typeof data.spelling?.htmlCorrectedQuery === "string"
                ? data.spelling.htmlCorrectedQuery
                : undefined,
    };
}

export async function fetchGoogleImages(query: string, page = 1) {
    const cx = process.env.GOOGLE_CX?.trim();
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

        const data = await response.json();
        const items = data.items || [];

        return items
            .map((item: GoogleImageItem) => ({
                thumbnail: item.image?.thumbnailLink || item.link,
                full: item.link,
                title: item.title || "",
                sourceUrl: item.image?.contextLink || "",
                width: item.image?.width,
                height: item.image?.height,
                source: "google",
            }))
            .filter((img: { thumbnail?: string; full?: string }) => Boolean(img.thumbnail && img.full));
    } catch {
        return [];
    }
}

export function dedupeImages<T extends { full?: string }>(images: T[]): T[] {
    const seenUrls = new Set<string>();
    return images.filter((img) => {
        const full = String(img.full || "");
        const normalizedUrl = full.replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (seenUrls.has(normalizedUrl)) {
            return false;
        }
        seenUrls.add(normalizedUrl);
        return true;
    });
}
