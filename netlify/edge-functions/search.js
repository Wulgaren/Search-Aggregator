// Netlify Edge Function for search - runs at the edge for lower latency

// In-memory cache for Google access token (persists across requests in same isolate)
let googleAccessToken = null;
let googleTokenExpiry = 0;

export default async (request, context) => {
    const url = new URL(request.url);
    
    // Only allow GET requests
    if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    const query = url.searchParams.get("q");
    const page = parseInt(url.searchParams.get("page")) || 1;
    const source = url.searchParams.get("source");

    if (!query || query.trim() === "") {
        return new Response(
            JSON.stringify({ error: 'Query parameter "q" is required' }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const searchQuery = query.trim();
    const resultsPerPage = 10;

    // Handle infobox request
    if (source === "infobox") {
        const infobox = await fetchWikipediaInfobox(searchQuery);
        return new Response(JSON.stringify({ infobox }), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=3600",
            },
        });
    }

    // Handle image search
    const imageSource = url.searchParams.get("imageSource");

    if (source === "images") {
        let images = [];
        let hasMore = true;

        if (imageSource === "google") {
            const googleImages = await fetchGoogleImages(searchQuery, page);
            images = googleImages;
            hasMore = page < 10;
        } else if (imageSource === "brave") {
            const braveImages = await fetchBraveImages(searchQuery, page);
            images = braveImages;
            hasMore = page < 3;
        } else {
            const [braveImages, googleImages] = await Promise.allSettled([
                fetchBraveImages(searchQuery, page),
                fetchGoogleImages(searchQuery, page),
            ]);

            const allImages = [
                ...(braveImages.status === "fulfilled" ? braveImages.value : []),
                ...(googleImages.status === "fulfilled" ? googleImages.value : []),
            ];

            const seenUrls = new Set();
            images = allImages.filter((img) => {
                const normalizedUrl = img.full
                    .replace(/^https?:\/\//, "")
                    .replace(/\/$/, "");
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
                "Cache-Control": "public, max-age=300",
            },
        });
    }

    // Determine which sources to fetch
    const fetchBravePromise =
        !source || source === "brave"
            ? fetchBrave(searchQuery, page, resultsPerPage)
            : Promise.resolve(null);

    const fetchGooglePromise =
        !source || source === "google"
            ? fetchGoogle(searchQuery, page, resultsPerPage)
            : Promise.resolve(null);

    const fetchMarginaliaPromise =
        !source || source === "marginalia"
            ? fetchMarginalia(searchQuery, page, resultsPerPage)
            : Promise.resolve(null);

    // Fetch APIs in parallel
    const [braveResults, googleResults, marginaliaResults] =
        await Promise.allSettled([
            fetchBravePromise,
            fetchGooglePromise,
            fetchMarginaliaPromise,
        ]);

    const response = { page };

    if (!source || source === "brave") {
        response.brave =
            braveResults.status === "fulfilled" && braveResults.value
                ? braveResults.value
                : {
                    error: braveResults.reason?.message || "Failed to fetch Brave results",
                    results: [],
                };
    }

    if (!source || source === "google") {
        response.google =
            googleResults.status === "fulfilled" && googleResults.value
                ? googleResults.value
                : {
                    error: googleResults.reason?.message || "Failed to fetch Google results",
                    results: [],
                };
    }

    if (!source || source === "marginalia") {
        response.marginalia =
            marginaliaResults.status === "fulfilled" && marginaliaResults.value
                ? marginaliaResults.value
                : {
                    error: marginaliaResults.reason?.message || "Failed to fetch Marginalia results",
                    results: [],
                };
    }

    return new Response(JSON.stringify(response), {
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
        },
    });
};

export const config = {
    path: "/api/search",
};

async function fetchBrave(query, page, resultsPerPage) {
    const apiKey = Deno.env.get("BRAVE_API_KEY");

    if (!apiKey) {
        throw new Error("Brave API key not configured");
    }

    const offset = page - 1;

    if (offset > 9) {
        return { results: [], hasMore: false, totalResults: "0" };
    }

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", resultsPerPage);
    url.searchParams.set("offset", offset);
    url.searchParams.set("result_filter", "web,news");

    const response = await fetch(url.toString(), {
        headers: {
            "X-Subscription-Token": apiKey,
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        if (response.status === 429) {
            throw new Error("Rate limited - too many requests");
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Brave API error: ${response.status}`);
    }

    const data = await response.json();
    const webResults = data.web?.results || [];

    const results = webResults.map((item) => ({
        title: item.title,
        url: item.url,
        displayUrl: item.meta_url?.hostname || new URL(item.url).hostname,
        snippet: item.description || "",
        source: "brave",
    }));

    return {
        results,
        hasMore: webResults.length === resultsPerPage && offset < 9,
        totalResults: String(data.web?.total || results.length),
    };
}

// Base64url encode for JWT
function base64UrlEncode(data) {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlEncodeString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    return base64UrlEncode(data);
}

// Import PEM private key for Web Crypto
async function importPrivateKey(pem) {
    // Remove PEM header/footer and decode
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

async function getGoogleAccessToken() {
    // Return cached token if still valid (with 60s buffer)
    if (googleAccessToken && Date.now() < googleTokenExpiry - 60000) {
        return googleAccessToken;
    }

    const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
    if (!serviceAccountJson) {
        throw new Error("Google service account not configured");
    }

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(serviceAccountJson);
    } catch (e) {
        throw new Error("Invalid Google service account JSON");
    }

    const { client_email, private_key } = serviceAccount;
    if (!client_email || !private_key) {
        throw new Error("Service account missing client_email or private_key");
    }

    // Create JWT header and payload
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

    // Sign with Web Crypto API
    const privateKey = await importPrivateKey(private_key);
    const encoder = new TextEncoder();
    const signatureBuffer = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        privateKey,
        encoder.encode(signatureInput)
    );
    const signature = base64UrlEncode(signatureBuffer);

    const jwt = `${signatureInput}.${signature}`;

    // Exchange JWT for access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(
            errorData.error_description || `Token exchange failed: ${tokenResponse.status}`
        );
    }

    const tokenData = await tokenResponse.json();
    googleAccessToken = tokenData.access_token;
    googleTokenExpiry = Date.now() + tokenData.expires_in * 1000;

    return googleAccessToken;
}

async function fetchGoogle(query, page, resultsPerPage) {
    const cx = Deno.env.get("GOOGLE_CX");

    if (!cx) {
        return { results: [], hasMore: false, totalResults: "0" };
    }

    if (!Deno.env.get("GOOGLE_SERVICE_ACCOUNT")) {
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
    url.searchParams.set("num", Math.min(resultsPerPage, 10));
    url.searchParams.set("start", startIndex);
    url.searchParams.set("fields", "items(title,link,displayLink,snippet),searchInformation/totalResults");

    const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Google API error: ${response.status}`);
    }

    const data = await response.json();
    const items = data.items || [];

    const results = items.map((item) => ({
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

async function fetchMarginalia(query, page, resultsPerPage) {
    const offset = (page - 1) * resultsPerPage;
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.marginalia.nu/public/search/${encodedQuery}?count=${resultsPerPage}&index=${offset}`;

    const response = await fetch(url, {
        headers: { 
            Accept: "application/json",
            "User-Agent": "Search-Aggregator/1.0 (https://github.com/Wulgaren/Search-Aggregator)"
        },
    });

    if (!response.ok) {
        throw new Error(`Marginalia API error: ${response.status}`);
    }

    const data = await response.json();
    const results = (data.results || []).map((item) => ({
        title: item.title || item.url,
        url: item.url,
        displayUrl: new URL(item.url).hostname,
        snippet: item.description || "",
        source: "marginalia",
    }));

    return {
        results,
        hasMore: results.length === resultsPerPage,
        totalResults: String(data.results?.length || 0),
    };
}

async function fetchBraveImages(query, page = 1) {
    const apiKey = Deno.env.get("BRAVE_API_KEY");

    if (!apiKey) {
        return [];
    }

    const offset = page - 1;
    if (offset > 2) {
        return [];
    }

    const url = new URL("https://api.search.brave.com/res/v1/images/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", 20);
    url.searchParams.set("offset", offset);

    const response = await fetch(url.toString(), {
        headers: {
            "X-Subscription-Token": apiKey,
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        console.error(`Brave images error: ${response.status}`);
        return [];
    }

    const data = await response.json();
    const results = data.results || [];

    return results
        .map((item) => ({
            thumbnail: item.thumbnail?.src || item.properties?.url,
            full: item.properties?.url || item.thumbnail?.src,
            title: item.title || "",
            sourceUrl: item.url || "",
            width: item.properties?.width,
            height: item.properties?.height,
            source: "brave",
        }))
        .filter((img) => img.thumbnail && img.full);
}

async function fetchGoogleImages(query, page = 1) {
    const cx = Deno.env.get("GOOGLE_CX");

    if (!cx || !Deno.env.get("GOOGLE_SERVICE_ACCOUNT")) {
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
        url.searchParams.set("num", 10);
        url.searchParams.set("start", startIndex);

        const response = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        const items = data.items || [];

        return items
            .map((item) => ({
                thumbnail: item.image?.thumbnailLink || item.link,
                full: item.link,
                title: item.title || "",
                sourceUrl: item.image?.contextLink || "",
                width: item.image?.width,
                height: item.image?.height,
                source: "google",
            }))
            .filter((img) => img.thumbnail && img.full);
    } catch (e) {
        return [];
    }
}

async function fetchWikipediaInfobox(query) {
    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&search=${encodeURIComponent(query)}&limit=5&origin=*`;

        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) return null;

        const searchData = await searchResponse.json();
        const pageTitles = searchData[1] || [];

        if (pageTitles.length === 0) return null;

        for (const pageTitle of pageTitles) {
            const result = await tryFetchPageInfobox(pageTitle);
            if (result) return result;
        }

        return null;
    } catch (e) {
        console.error("Wikipedia infobox error:", e);
        return null;
    }
}

async function tryFetchPageInfobox(pageTitle) {
    try {
        const pageUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(pageTitle)}&prop=extracts|pageimages|info|extlinks|categories&exintro=true&explaintext=true&exsentences=4&piprop=thumbnail|original&pithumbsize=300&inprop=url&cllimit=10&origin=*`;

        const pageResponse = await fetch(pageUrl);
        if (!pageResponse.ok) return null;

        const pageData = await pageResponse.json();
        const pages = pageData.query?.pages || {};
        const page = Object.values(pages)[0];

        if (!page || page.missing) return null;

        const extract = page.extract || "";
        if (extract.length < 50) return null;

        let wikidataId = null;
        const externalLinks = [];

        try {
            const wikidataUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(pageTitle)}&prop=pageprops&ppprop=wikibase_item&origin=*`;

            const wikidataResponse = await fetch(wikidataUrl);
            if (wikidataResponse.ok) {
                const wikidataData = await wikidataResponse.json();
                const wikidataPages = wikidataData.query?.pages || {};
                const wikidataPage = Object.values(wikidataPages)[0];
                wikidataId = wikidataPage?.pageprops?.wikibase_item;
            }

            if (wikidataId) {
                const claimsUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${wikidataId}&props=claims|sitelinks&origin=*`;

                const claimsResponse = await fetch(claimsUrl);
                if (claimsResponse.ok) {
                    const claimsData = await claimsResponse.json();
                    const entity = claimsData.entities?.[wikidataId];
                    const claims = entity?.claims || {};

                    const linkProperties = {
                        P856: { name: "Official website", icon: "🌐" },
                        P2002: { name: "Twitter", icon: "𝕏", urlPrefix: "https://twitter.com/" },
                        P2003: { name: "Instagram", icon: "📷", urlPrefix: "https://instagram.com/" },
                        P2013: { name: "Facebook", icon: "📘", urlPrefix: "https://facebook.com/" },
                        P2397: { name: "YouTube", icon: "▶️", urlPrefix: "https://youtube.com/channel/" },
                        P4264: { name: "LinkedIn", icon: "💼", urlPrefix: "https://linkedin.com/in/" },
                        P345: { name: "IMDb", icon: "🎬", urlPrefix: "https://imdb.com/name/" },
                        P1953: { name: "Discogs", icon: "💿", urlPrefix: "https://discogs.com/artist/" },
                        P434: { name: "MusicBrainz", icon: "🎵", urlPrefix: "https://musicbrainz.org/artist/" },
                        P1902: { name: "Spotify", icon: "🎧", urlPrefix: "https://open.spotify.com/artist/" },
                    };

                    for (const [prop, config] of Object.entries(linkProperties)) {
                        if (claims[prop] && claims[prop][0]?.mainsnak?.datavalue?.value) {
                            const value = claims[prop][0].mainsnak.datavalue.value;
                            let url;

                            if (typeof value === "string") {
                                url = config.urlPrefix ? config.urlPrefix + value : value;
                            } else {
                                continue;
                            }

                            if (!url.startsWith("http")) {
                                url = "https://" + url;
                            }

                            externalLinks.push({
                                name: config.name,
                                icon: config.icon,
                                url: url,
                            });
                        }
                    }
                }
            }
        } catch (e) {
            // Wikidata fetch failed, continue without external links
        }

        return {
            title: page.title,
            description: extract,
            image: page.thumbnail?.source || page.original?.source || null,
            imageWidth: page.thumbnail?.width,
            imageHeight: page.thumbnail?.height,
            url: page.fullurl,
            wikidataId,
            links: externalLinks.slice(0, 6),
        };
    } catch (e) {
        return null;
    }
}

