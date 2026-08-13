// Node serverless handler for Google CSE (web + images). Called by Edge `/api/search`.

import { fetchGoogle, fetchGoogleImages } from "./google-search.ts";

/** CDN + browser caching for JSON search responses */
const SEARCH_JSON_CACHE =
    "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

export async function googleNodeRequest(request: Request): Promise<Response> {
    if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    const url = new URL(request.url);
    const query = url.searchParams.get("q");
    const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
    const kind = url.searchParams.get("kind") ?? "web";
    const resultsPerPage = parseInt(url.searchParams.get("num") ?? "10", 10) || 10;

    if (!query || query.trim() === "") {
        return new Response(
            JSON.stringify({ error: 'Query parameter "q" is required' }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const searchQuery = query.trim();

    if (kind === "images") {
        const images = await fetchGoogleImages(searchQuery, page);
        return new Response(JSON.stringify({ images }), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": SEARCH_JSON_CACHE,
            },
        });
    }

    if (kind !== "web") {
        return new Response(
            JSON.stringify({ error: 'Invalid kind; use "web" or "images"' }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    try {
        const google = await fetchGoogle(searchQuery, page, resultsPerPage);
        return new Response(JSON.stringify({ page, google }), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": SEARCH_JSON_CACHE,
            },
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[node-google] Google web search failed", { error: msg, q: searchQuery, page });
        return new Response(
            JSON.stringify({
                page,
                google: { error: msg, results: [], hasMore: false },
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
