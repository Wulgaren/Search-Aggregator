// Shared handler for Vercel Edge `/api/search` + `/api/ai`.

import { asArray, asRecord, isRecord, readArray, readNumber, readRecord, readString } from "./unknown.ts";

/** CDN + browser caching for JSON search responses (repeat queries, offline resilience) */
const SEARCH_JSON_CACHE =
    "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

type SearchResultItem = {
    title: string;
    url: string;
    displayUrl: string;
    snippet: string;
    source: string;
};

type SearchSourcePayload = {
    results: SearchResultItem[];
    hasMore: boolean;
    totalResults: string;
};

type SearchImageItem = {
    thumbnail: string;
    full: string;
    title: string;
    sourceUrl: string;
    width?: number;
    height?: number;
    source: string;
};

type CastEntry = { id: string; role: string | null };

type CastMember = {
    name: string;
    url: string;
    role?: string;
    image?: string;
};

type ExternalLinkConfig = {
    name: string;
    icon: string;
    urlPrefix?: string;
};

type InfoboxResult = {
    title: string | undefined;
    description: string;
    image: string | null;
    imageWidth?: number;
    imageHeight?: number;
    url: string | undefined;
    wikidataId: string | null;
    links: { name: string; icon: string; url: string }[];
    cast?: CastMember[];
};

type GroqSearchHit = {
    title?: string;
    url?: string;
    content?: string;
};

type GroqSearchResults = {
    results: GroqSearchHit[];
};

function settledErrorMessage(
    result: PromiseSettledResult<unknown>,
    fallback: string
): string {
    if (result.status !== "rejected") return fallback;
    const reason: unknown = result.reason;
    if (reason instanceof Error) return reason.message;
    if (typeof reason === "string") return reason;
    return fallback;
}

function firstPageRecord(
    pages: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
    if (!pages) return undefined;
    const values = Object.values(pages);
    const first = values[0];
    return asRecord(first);
}

function parsePagesMap(query: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    const pages = query ? query["pages"] : undefined;
    if (!isRecord(pages)) return undefined;
    return pages;
}

function readDataValue(snak: Record<string, unknown> | undefined): unknown {
    const datavalue = snak ? readRecord(snak, "datavalue") : undefined;
    return datavalue ? datavalue["value"] : undefined;
}

function parseGroqSearchResults(value: unknown): GroqSearchResults | null {
    const record = asRecord(value);
    if (!record) return null;
    const resultsRaw = readArray(record, "results");
    if (!resultsRaw) return null;
    const results: GroqSearchHit[] = resultsRaw.flatMap((raw) => {
        const item = asRecord(raw);
        if (!item) return [];
        const hit: GroqSearchHit = {};
        const title = readString(item, "title");
        const url = readString(item, "url");
        const content = readString(item, "content");
        if (title !== undefined) hit.title = title;
        if (url !== undefined) hit.url = url;
        if (content !== undefined) hit.content = content;
        return [hit];
    });
    return { results };
}

export async function aggregateEdgeRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Route to AI handler for /api/ai
    if (url.pathname === "/api/ai") {
        return handleAI(request);
    }

    // Only allow GET requests for search
    if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    const query = url.searchParams.get("q");
    const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
    const source = url.searchParams.get("source");
    const imageSource = url.searchParams.get("imageSource");

    const reqId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (!query || query.trim() === "") {
        return new Response(
            JSON.stringify({ error: 'Query parameter "q" is required' }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const searchQuery = query.trim();
    const resultsPerPage = 10;
    const requestKey = `q=${searchQuery}&page=${page}&source=${source ?? ""}&imageSource=${imageSource ?? ""}`;

    // Helps confirm whether multiple Brave requests hit during "first whole site load".
    // Group by `requestKey` and time (deploy logs).
    console.log("[edge-search] api/search request", {
        reqId,
        requestKey,
        source: source ?? null,
        page,
        q: searchQuery,
        imageSource: imageSource ?? null,
        clientIp:
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-forwarded-for") ||
            null,
    });

    if (source === "google") {
        return new Response(
            JSON.stringify({ error: "Google Custom Search runs in the browser (configure cx + service account in the site settings)." }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    // Handle infobox request
    if (source === "infobox") {
        const infobox = await fetchWikipediaInfobox(searchQuery);
        return new Response(JSON.stringify({ infobox }), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control":
                    "public, max-age=7200, s-maxage=7200, stale-while-revalidate=86400",
            },
        });
    }

    if (source === "images") {
        if (imageSource === "google" || !imageSource) {
            return new Response(
                JSON.stringify({
                    error: "Google and combined image search are handled in the browser",
                }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        const braveImages = await fetchBraveImages(
            searchQuery,
            page,
            reqId,
            requestKey
        );
        return new Response(
            JSON.stringify({ images: braveImages, hasMore: page < 3 }),
            {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": SEARCH_JSON_CACHE,
                },
            }
        );
    }

    // Determine which sources to fetch
    const fetchBravePromise =
        !source || source === "brave"
            ? fetchBrave(searchQuery, page, resultsPerPage, reqId, requestKey)
            : Promise.resolve(null);

    const fetchMarginaliaPromise =
        !source || source === "marginalia"
            ? fetchMarginalia(searchQuery, page, resultsPerPage)
            : Promise.resolve(null);

    const fetchWibyPromise =
        !source || source === "wiby" ? fetchWiby(searchQuery, page) : Promise.resolve(null);

    const [braveResults, marginaliaResults, wibyResults] = await Promise.allSettled([
        fetchBravePromise,
        fetchMarginaliaPromise,
        fetchWibyPromise,
    ]);

    const response: {
        page: number;
        brave?: SearchSourcePayload | { error: string; results: SearchResultItem[] };
        marginalia?: SearchSourcePayload | { error: string; results: SearchResultItem[] };
        wiby?: SearchSourcePayload | { error: string; results: SearchResultItem[] };
    } = { page };

    if (!source || source === "brave") {
        response.brave =
            braveResults.status === "fulfilled" && braveResults.value
                ? braveResults.value
                : {
                    error: settledErrorMessage(braveResults, "Failed to fetch Brave results"),
                    results: [],
                };
    }

    if (!source || source === "marginalia") {
        response.marginalia =
            marginaliaResults.status === "fulfilled" && marginaliaResults.value
                ? marginaliaResults.value
                : {
                    error: settledErrorMessage(
                        marginaliaResults,
                        "Failed to fetch Marginalia results"
                    ),
                    results: [],
                };
    }

    if (!source || source === "wiby") {
        response.wiby =
            wibyResults.status === "fulfilled" && wibyResults.value
                ? wibyResults.value
                : {
                    error: settledErrorMessage(wibyResults, "Failed to fetch Wiby results"),
                    results: [],
                };
    }

    return new Response(JSON.stringify(response), {
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": SEARCH_JSON_CACHE,
        },
    });
}

async function fetchBrave(
    query: string,
    page: number,
    resultsPerPage: number,
    reqId: string,
    requestKey: string
): Promise<SearchSourcePayload> {
    const apiKey = process.env["BRAVE_API_KEY"];

    if (!apiKey) {
        console.error("[edge-search] Brave API key not configured");
        throw new Error("Brave API key not configured");
    }

    const offset = page - 1;

    if (offset > 9) {
        return { results: [], hasMore: false, totalResults: "0" };
    }

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(resultsPerPage));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("result_filter", "web,news");

    console.log("[edge-search] Brave API call", {
        reqId,
        requestKey,
        q: query,
        page,
        offset,
        resultsPerPage,
    });

    const response = await fetch(url.toString(), {
        headers: {
            "X-Subscription-Token": apiKey,
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        if (response.status === 429) {
            console.error("[edge-search] Brave rate limited", {
                status: response.status,
                page,
                reqId,
                requestKey,
            });
            throw new Error("Rate limited - too many requests");
        }
        const errorData: unknown = await response.json().catch(() => ({}));
        const message = isRecord(errorData) ? readString(errorData, "message") : undefined;
        console.error("[edge-search] Brave request failed", {
            status: response.status,
            message,
            page,
            reqId,
            requestKey,
        });
        throw new Error(message || `Brave API error: ${response.status}`);
    }

    let data: unknown;
    try {
        data = await response.json();
    } catch (e: unknown) {
        console.error("[edge-search] Brave response JSON parse failed", {
            page,
            error: e instanceof Error ? e.message : String(e),
        });
        throw e;
    }
    const dataRecord = asRecord(data);
    const web = dataRecord ? readRecord(dataRecord, "web") : undefined;
    const webResults = web ? (readArray(web, "results") ?? []) : [];

    const results: SearchResultItem[] = webResults.flatMap((raw) => {
        const item = asRecord(raw);
        if (!item) return [];
        const itemUrl = readString(item, "url");
        if (!itemUrl) return [];
        let displayUrl: string;
        try {
            const metaUrl = readRecord(item, "meta_url");
            displayUrl = (metaUrl ? readString(metaUrl, "hostname") : undefined) || new URL(itemUrl).hostname;
        } catch {
            return [];
        }
        return [
            {
                title: readString(item, "title") || itemUrl,
                url: itemUrl,
                displayUrl,
                snippet: readString(item, "description") || "",
                source: "brave",
            },
        ];
    });

    const total = web ? web["total"] : undefined;
    const totalResults =
        typeof total === "number" || typeof total === "string" ? String(total) : String(results.length);

    return {
        results,
        hasMore: webResults.length === resultsPerPage && offset < 9,
        totalResults,
    };
}

async function fetchMarginalia(
    query: string,
    page: number,
    resultsPerPage: number
): Promise<SearchSourcePayload> {
    const count = Math.min(100, Math.max(1, resultsPerPage));
    const url = new URL("https://api2.marginalia-search.com/search");
    url.searchParams.set("query", query);
    url.searchParams.set("count", String(count));
    url.searchParams.set("page", String(page));

    const apiKey = process.env["MARGINALIA_API_KEY"] ?? "public";

    const response = await fetch(url.toString(), {
        headers: {
            Accept: "application/json",
            "API-Key": apiKey,
            "User-Agent": "Search-Aggregator/1.0 (https://github.com/Wulgaren/Search-Aggregator)",
        },
    });

    if (!response.ok) {
        console.error("[edge-search] Marginalia request failed", {
            status: response.status,
            page,
        });
        throw new Error(`Marginalia API error: ${response.status}`);
    }

    let data: unknown;
    try {
        data = await response.json();
    } catch (e: unknown) {
        console.error("[edge-search] Marginalia response JSON parse failed", {
            page,
            error: e instanceof Error ? e.message : String(e),
        });
        throw e;
    }
    const dataRecord = asRecord(data);
    const rawResults = dataRecord ? (readArray(dataRecord, "results") ?? []) : [];
    const results: SearchResultItem[] = rawResults.flatMap((raw) => {
        const item = asRecord(raw);
        if (!item) return [];
        const itemUrl = readString(item, "url");
        if (!itemUrl) return [];
        let displayUrl: string;
        try {
            displayUrl = new URL(itemUrl).hostname;
        } catch {
            return [];
        }
        return [
            {
                title: readString(item, "title") || itemUrl,
                url: itemUrl,
                displayUrl,
                snippet: readString(item, "description") || "",
                source: "marginalia",
            },
        ];
    });

    const pageNum = dataRecord ? readNumber(dataRecord, "page") : undefined;
    const pagesNum = dataRecord ? readNumber(dataRecord, "pages") : undefined;
    const hasMore =
        typeof pagesNum === "number" && typeof pageNum === "number"
            ? pageNum < pagesNum
            : results.length === count;

    return {
        results,
        hasMore,
        totalResults: String(rawResults.length),
    };
}

async function fetchWiby(query: string, page: number): Promise<SearchSourcePayload> {
    const url = new URL("https://wiby.me/json/");
    url.searchParams.set("q", query);
    url.searchParams.set("p", String(Math.max(1, page)));

    const response = await fetch(url.toString(), {
        headers: {
            Accept: "application/json",
            "User-Agent": "Search-Aggregator/1.0 (https://github.com/Wulgaren/Search-Aggregator)",
        },
    });

    if (!response.ok) {
        console.error("[edge-search] Wiby request failed", {
            status: response.status,
            page,
        });
        throw new Error(`Wiby API error: ${response.status}`);
    }

    let data: unknown;
    try {
        data = await response.json();
    } catch (e: unknown) {
        console.error("[edge-search] Wiby response JSON parse failed", {
            page,
            error: e instanceof Error ? e.message : String(e),
        });
        throw e;
    }

    const list = asArray(data);
    if (!list) {
        throw new Error("Wiby API returned unexpected JSON shape");
    }

    const results: SearchResultItem[] = [];
    for (const raw of list) {
        const item = asRecord(raw);
        if (!item) continue;
        const href = readString(item, "URL") || readString(item, "url");
        if (!href) continue;
        let displayUrl = href;
        try {
            displayUrl = new URL(href).hostname;
        } catch {
            continue;
        }
        const title = readString(item, "Title") || readString(item, "title") || href;
        const snippet = readString(item, "Snippet") || readString(item, "Description") || "";
        results.push({
            title,
            url: href,
            displayUrl,
            snippet,
            source: "wiby",
        });
    }

    return {
        results,
        hasMore: results.length > 0,
        totalResults: String(results.length),
    };
}

async function fetchBraveImages(
    query: string,
    page = 1,
    reqId?: string,
    requestKey?: string
): Promise<SearchImageItem[]> {
    const apiKey = process.env["BRAVE_API_KEY"];

    if (!apiKey) {
        console.error("[edge-search] Brave API key not configured for images");
        return [];
    }

    const offset = page - 1;
    if (offset > 2) {
        return [];
    }

    const url = new URL("https://api.search.brave.com/res/v1/images/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "20");
    url.searchParams.set("offset", String(offset));

    console.log("[edge-search] Brave images API call", {
        reqId,
        requestKey,
        q: query,
        page,
        offset,
    });

    const response = await fetch(url.toString(), {
        headers: {
            "X-Subscription-Token": apiKey,
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        console.error("[edge-search] Brave images request failed", {
            status: response.status,
            page,
            reqId,
            requestKey,
        });
        return [];
    }

    let data: unknown;
    try {
        data = await response.json();
    } catch (e: unknown) {
        console.error("[edge-search] Brave images response JSON parse failed", {
            page,
            error: e instanceof Error ? e.message : String(e),
        });
        return [];
    }
    const dataRecord = asRecord(data);
    const rawResults = dataRecord ? (readArray(dataRecord, "results") ?? []) : [];

    return rawResults.flatMap((raw): SearchImageItem[] => {
        const item = asRecord(raw);
        if (!item) return [];
        const thumbnailObj = readRecord(item, "thumbnail");
        const properties = readRecord(item, "properties");
        const thumbnail =
            (thumbnailObj ? readString(thumbnailObj, "src") : undefined) ||
            (properties ? readString(properties, "url") : undefined);
        const full =
            (properties ? readString(properties, "url") : undefined) ||
            (thumbnailObj ? readString(thumbnailObj, "src") : undefined);
        if (!thumbnail || !full) return [];
        const mapped: SearchImageItem = {
            thumbnail,
            full,
            title: readString(item, "title") || "",
            sourceUrl: readString(item, "url") || "",
            source: "brave",
        };
        const width = properties ? readNumber(properties, "width") : undefined;
        const height = properties ? readNumber(properties, "height") : undefined;
        if (width !== undefined) mapped.width = width;
        if (height !== undefined) mapped.height = height;
        return [mapped];
    });
}

async function fetchWikipediaInfobox(query: string): Promise<InfoboxResult | null> {
    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&search=${encodeURIComponent(query)}&limit=5&origin=*`;

        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) return null;

        const searchData: unknown = await searchResponse.json();
        const searchList = asArray(searchData);
        if (!searchList || searchList.length < 2) return null;
        const titlesRaw = asArray(searchList[1]);
        if (!titlesRaw) return null;
        const pageTitles = titlesRaw.filter((t): t is string => typeof t === "string");

        if (pageTitles.length === 0) return null;

        for (const pageTitle of pageTitles) {
            const result = await tryFetchPageInfobox(pageTitle);
            if (result) return result;
        }

        return null;
    } catch (e: unknown) {
        console.error("[edge-search] Wikipedia infobox fetch failed", {
            error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
}

/** Wikidata Commons image (P18) → thumbnail URL */
function commonsThumbnailUrl(filename: string, width = 128): string | null {
    if (!filename || typeof filename !== "string") return null;
    const segment = filename.replace(/ /g, "_");
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(segment)}?width=${width}`;
}

function wikidataQualifierText(
    statement: Record<string, unknown>,
    propertyId: string
): string | null {
    const qualsRaw = readRecord(statement, "qualifiers");
    const quals = qualsRaw ? readArray(qualsRaw, propertyId) : undefined;
    if (!quals?.length) return null;
    const snak = asRecord(quals[0]);
    if (!snak || readString(snak, "snaktype") !== "value") return null;
    const v = readDataValue(snak);
    if (typeof v === "string") return v;
    if (isRecord(v)) {
        const text = readString(v, "text");
        if (text !== undefined) return text;
    }
    return null;
}

function wikidataEntityLabel(entity: Record<string, unknown>): string | null {
    const labels = readRecord(entity, "labels");
    if (!labels) return null;
    const en = readRecord(labels, "en");
    const enValue = en ? readString(en, "value") : undefined;
    if (enValue) return enValue;
    const firstKey = Object.keys(labels)[0];
    if (!firstKey) return null;
    const first = readRecord(labels, firstKey);
    return (first ? readString(first, "value") : undefined) || null;
}

function wikipediaTitleFromSitelink(entity: Record<string, unknown>): string | null {
    const sitelinks = readRecord(entity, "sitelinks");
    const enwiki = sitelinks ? readRecord(sitelinks, "enwiki") : undefined;
    const title = enwiki ? readString(enwiki, "title") : undefined;
    return title || null;
}

function wikipediaArticleUrl(title: string | null): string | null {
    if (!title) return null;
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

/** Extract cast member Q-ids from film entity claims (P161), preserving order, deduped */
function extractCastMemberIds(claims: Record<string, unknown>): CastEntry[] {
    const list = readArray(claims, "P161");
    if (!list) return [];
    const seen = new Set<string>();
    const out: CastEntry[] = [];
    for (const raw of list) {
        const st = asRecord(raw);
        if (!st) continue;
        const snak = readRecord(st, "mainsnak");
        if (!snak || readString(snak, "snaktype") !== "value") continue;
        const datavalue = readRecord(snak, "datavalue");
        if (!datavalue || readString(datavalue, "type") !== "wikibase-entityid") continue;
        const value = datavalue["value"];
        const id = isRecord(value) ? readString(value, "id") : undefined;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, role: wikidataQualifierText(st, "P453") });
        if (out.length >= 36) break;
    }
    return out;
}

async function fetchWikidataCastMembers(castEntries: CastEntry[]): Promise<CastMember[]> {
    if (!castEntries.length) return [];

    const batches: CastEntry[][] = [];
    for (let i = 0; i < castEntries.length; i += 40) {
        batches.push(castEntries.slice(i, i + 40));
    }

    const members: CastMember[] = [];

    for (const batch of batches) {
        const ids = batch.map((e) => e.id).join("|");
        const url =
            `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${ids}` +
            "&props=labels|claims|sitelinks&languages=en&origin=*";

        const res = await fetch(url);
        if (!res.ok) continue;

        let data: unknown;
        try {
            data = await res.json();
        } catch {
            continue;
        }

        const dataRecord = asRecord(data);
        const entities = dataRecord ? readRecord(dataRecord, "entities") : undefined;
        if (!entities) continue;

        for (const { id, role } of batch) {
            const entity = readRecord(entities, id);
            if (!entity || entity["missing"] === "") continue;

            const name = wikidataEntityLabel(entity);
            if (!name) continue;

            let image: string | null = null;
            const claims = readRecord(entity, "claims");
            const p18List = claims ? readArray(claims, "P18") : undefined;
            const p18Statement = p18List ? asRecord(p18List[0]) : undefined;
            const p18 = p18Statement ? readRecord(p18Statement, "mainsnak") : undefined;
            if (p18 && readString(p18, "snaktype") === "value") {
                const filename = readDataValue(p18);
                if (typeof filename === "string") {
                    image = commonsThumbnailUrl(filename, 128);
                }
            }

            const wpTitle = wikipediaTitleFromSitelink(entity);
            const articleUrl = wikipediaArticleUrl(wpTitle) || `https://www.wikidata.org/wiki/${id}`;

            const member: CastMember = {
                name,
                url: articleUrl,
            };
            if (role) member.role = role;
            if (image) member.image = image;
            members.push(member);
        }
    }

    return members.slice(0, 24);
}

async function tryFetchPageInfobox(pageTitle: string): Promise<InfoboxResult | null> {
    try {
        const pageUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(pageTitle)}&prop=extracts|pageimages|info|extlinks|categories&exintro=true&explaintext=true&exsentences=4&piprop=thumbnail|original&pithumbsize=300&inprop=url&cllimit=10&origin=*`;

        const pageResponse = await fetch(pageUrl);
        if (!pageResponse.ok) return null;

        const pageData: unknown = await pageResponse.json();
        const pageDataRecord = asRecord(pageData);
        const query = pageDataRecord ? readRecord(pageDataRecord, "query") : undefined;
        const page = firstPageRecord(parsePagesMap(query));

        if (!page || page["missing"] !== undefined) return null;

        const extract = readString(page, "extract") || "";
        if (extract.length < 50) return null;

        let wikidataId: string | null = null;
        const externalLinks: { name: string; icon: string; url: string }[] = [];
        let cast: CastMember[] = [];

        try {
            const wikidataUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(pageTitle)}&prop=pageprops&ppprop=wikibase_item&origin=*`;

            const wikidataResponse = await fetch(wikidataUrl);
            if (wikidataResponse.ok) {
                const wikidataData: unknown = await wikidataResponse.json();
                const wikidataRecord = asRecord(wikidataData);
                const wikidataQuery = wikidataRecord ? readRecord(wikidataRecord, "query") : undefined;
                const wikidataPage = firstPageRecord(parsePagesMap(wikidataQuery));
                const pageprops = wikidataPage ? readRecord(wikidataPage, "pageprops") : undefined;
                wikidataId = (pageprops ? readString(pageprops, "wikibase_item") : undefined) ?? null;
            }

            if (wikidataId) {
                const claimsUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${wikidataId}&props=claims|sitelinks&origin=*`;

                const claimsResponse = await fetch(claimsUrl);
                if (claimsResponse.ok) {
                    const claimsData: unknown = await claimsResponse.json();
                    const claimsRecord = asRecord(claimsData);
                    const entities = claimsRecord ? readRecord(claimsRecord, "entities") : undefined;
                    const entity = entities ? readRecord(entities, wikidataId) : undefined;
                    const claims = (entity ? readRecord(entity, "claims") : undefined) || {};

                    const linkProperties: Record<string, ExternalLinkConfig> = {
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
                        const claimList = readArray(claims, prop);
                        const claim = claimList ? asRecord(claimList[0]) : undefined;
                        const mainsnak = claim ? readRecord(claim, "mainsnak") : undefined;
                        const value = readDataValue(mainsnak);
                        if (typeof value !== "string") continue;

                        let linkUrl = config.urlPrefix ? config.urlPrefix + value : value;

                        if (!linkUrl.startsWith("http")) {
                            linkUrl = "https://" + linkUrl;
                        }

                        externalLinks.push({
                            name: config.name,
                            icon: config.icon,
                            url: linkUrl,
                        });
                    }

                    const castEntries = extractCastMemberIds(claims);
                    if (castEntries.length > 0) {
                        cast = await fetchWikidataCastMembers(castEntries);
                    }
                }
            }
        } catch (e: unknown) {
            console.error("[edge-search] Wikidata enrichment failed", {
                pageTitle,
                error: e instanceof Error ? e.message : String(e),
            });
            // Wikidata fetch failed, continue without external links
        }

        const thumbnail = readRecord(page, "thumbnail");
        const original = readRecord(page, "original");
        const infobox: InfoboxResult = {
            title: readString(page, "title"),
            description: extract,
            image: (thumbnail ? readString(thumbnail, "source") : undefined) ||
                (original ? readString(original, "source") : undefined) ||
                null,
            url: readString(page, "fullurl"),
            wikidataId,
            links: externalLinks.slice(0, 6),
        };
        const thumbWidth = thumbnail ? readNumber(thumbnail, "width") : undefined;
        const thumbHeight = thumbnail ? readNumber(thumbnail, "height") : undefined;
        if (thumbWidth !== undefined) infobox.imageWidth = thumbWidth;
        if (thumbHeight !== undefined) infobox.imageHeight = thumbHeight;
        if (cast.length > 0) {
            infobox.cast = cast;
        }
        return infobox;
    } catch (e: unknown) {
        console.error("[edge-search] tryFetchPageInfobox failed", {
            pageTitle,
            error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
}

// AI Answer Handler with Groq streaming
async function handleAI(request: Request): Promise<Response> {
    // Only allow POST requests
    if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    const groqApiKey = process.env["GROQ_API_KEY"];
    if (!groqApiKey) {
        console.error("[edge-search] Groq API key not configured");
        return new Response(JSON.stringify({ error: "Groq API key not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    let bodyRaw: unknown;
    try {
        bodyRaw = await request.json();
    } catch (e: unknown) {
        console.error("[edge-search] Invalid JSON body for AI request", {
            error: e instanceof Error ? e.message : String(e),
        });
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const body = asRecord(bodyRaw);
    const query = body ? readString(body, "query") : undefined;

    if (!query || query.trim() === "") {
        return new Response(JSON.stringify({ error: "Query is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const systemPrompt = `You are a helpful AI assistant integrated into a search engine. Provide concise, direct answers in a Google AI Overview style.

Guidelines:
- DECIDE whether web search is needed: Only use web search for queries requiring current/real-time information, recent events, or information beyond your training data. For general knowledge questions you can answer confidently, use your training data instead.
- Write like Google AI Overview: concise, direct, conversational. Avoid essay-style structure (no "First, Second, Third" or numbered points).
- Use simple paragraphs with **bold** for key terms only. NO tables, NO headers, NO lists, NO structured formatting.
- Be brief and scannable - get to the point quickly
- Write naturally, not formally - like explaining to a friend
- Keep paragraphs short (2-3 sentences max)
- Cite sources naturally when using web search results`;

    const userMessage = query;

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${groqApiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "groq/compound-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage },
                ],
                stream: true,
                max_tokens: 1024,
                temperature: 0.5,
            }),
        });

        if (!response.ok) {
            const errorData: unknown = await response.json().catch(() => ({}));
            const errObj = isRecord(errorData) ? readRecord(errorData, "error") : undefined;
            const message = errObj ? readString(errObj, "message") : undefined;
            console.error("[edge-search] Groq request failed", {
                status: response.status,
                message,
            });
            throw new Error(message || `Groq API error: ${response.status}`);
        }

        // Stream the response back to the client
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();
        const bodyStream = response.body;
        if (!bodyStream) {
            throw new Error("Groq API returned empty body");
        }

        // Process the stream in the background
        void (async () => {
            const reader = bodyStream.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let searchResults: GroqSearchResults | null = null;

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === "data: [DONE]") continue;
                        if (!trimmed.startsWith("data: ")) continue;

                        try {
                            const parsed: unknown = JSON.parse(trimmed.slice(6));
                            const json = asRecord(parsed);
                            if (!json) continue;

                            const choices = readArray(json, "choices");
                            const choice = choices ? asRecord(choices[0]) : undefined;
                            const delta = choice ? readRecord(choice, "delta") : undefined;
                            const message = (choice ? readRecord(choice, "message") : undefined) || delta;

                            const content = delta ? readString(delta, "content") : undefined;
                            if (content) {
                                await writer.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                            }

                            const executedTools = message ? readArray(message, "executed_tools") : undefined;
                            if (executedTools) {
                                for (const toolRaw of executedTools) {
                                    const tool = asRecord(toolRaw);
                                    if (!tool) continue;
                                    const sr = parseGroqSearchResults(tool["search_results"]);
                                    if (sr) searchResults = sr;
                                }
                            }
                        } catch {
                            // Skip malformed JSON
                        }
                    }
                }

                // Send search results if we found any
                if (searchResults && searchResults.results.length > 0) {
                    const sources = searchResults.results.map((result, index) => ({
                        title: result.title,
                        url: result.url,
                        snippet: result.content || "",
                        index: index + 1,
                    }));
                    await writer.write(encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`));
                }

                // Send done signal
                await writer.write(encoder.encode("data: [DONE]\n\n"));
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error("[edge-search] Groq streaming handler failed", {
                    error: msg,
                });
                await writer.write(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
            } finally {
                await writer.close();
            }
        })();

        return new Response(readable, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[edge-search] handleAI failed", { error: msg });
        return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
