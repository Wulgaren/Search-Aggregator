// Netlify Edge Function for search - runs at the edge for lower latency

/** CDN + browser caching for JSON search responses (repeat queries, offline resilience) */
const SEARCH_JSON_CACHE =
    "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

export default async (request: Request, context: unknown): Promise<Response> => {
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
    const page = parseInt(url.searchParams.get("page")) || 1;
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
    // Group by `requestKey` and time (Netlify log viewer).
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

    const [braveResults, marginaliaResults] = await Promise.allSettled([
        fetchBravePromise,
        fetchMarginaliaPromise,
    ]);

    const response: {
        page: number;
        brave?: unknown;
        marginalia?: unknown;
    } = { page };

    if (!source || source === "brave") {
        response.brave =
            braveResults.status === "fulfilled" && braveResults.value
                ? braveResults.value
                : {
                    error:
                        (braveResults.reason as Error)?.message ||
                        "Failed to fetch Brave results",
                    results: [],
                };
    }

    if (!source || source === "marginalia") {
        response.marginalia =
            marginaliaResults.status === "fulfilled" && marginaliaResults.value
                ? marginaliaResults.value
                : {
                    error:
                        (marginaliaResults.reason as Error)?.message ||
                        "Failed to fetch Marginalia results",
                    results: [],
                };
    }

    return new Response(JSON.stringify(response), {
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": SEARCH_JSON_CACHE,
        },
    });
};

async function fetchBrave(query, page, resultsPerPage, reqId: string, requestKey: string) {
    const apiKey = Deno.env.get("BRAVE_API_KEY");

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
    url.searchParams.set("count", resultsPerPage);
    url.searchParams.set("offset", offset);
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
        const errorData = await response.json().catch(() => ({}));
        console.error("[edge-search] Brave request failed", {
            status: response.status,
            message: errorData.message,
            page,
            reqId,
            requestKey,
        });
        throw new Error(errorData.message || `Brave API error: ${response.status}`);
    }

    let data: any;
    try {
        data = await response.json();
    } catch (e) {
        console.error("[edge-search] Brave response JSON parse failed", {
            page,
            error: e instanceof Error ? e.message : String(e),
        });
        throw e;
    }
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
        console.error("[edge-search] Marginalia request failed", {
            status: response.status,
            page,
        });
        throw new Error(`Marginalia API error: ${response.status}`);
    }

    let data: any;
    try {
        data = await response.json();
    } catch (e) {
        console.error("[edge-search] Marginalia response JSON parse failed", {
            page,
            error: e instanceof Error ? e.message : String(e),
        });
        throw e;
    }
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

async function fetchBraveImages(
    query,
    page = 1,
    reqId?: string,
    requestKey?: string
) {
    const apiKey = Deno.env.get("BRAVE_API_KEY");

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
    url.searchParams.set("count", 20);
    url.searchParams.set("offset", offset);

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

    let data: any;
    try {
        data = await response.json();
    } catch (e) {
        console.error("[edge-search] Brave images response JSON parse failed", {
            page,
            error: e instanceof Error ? e.message : String(e),
        });
        return [];
    }
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
        console.error("[edge-search] Wikipedia infobox fetch failed", {
            error: e instanceof Error ? e.message : String(e),
        });
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
            console.error("[edge-search] Wikidata enrichment failed", {
                pageTitle,
                error: e instanceof Error ? e.message : String(e),
            });
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
        console.error("[edge-search] tryFetchPageInfobox failed", {
            pageTitle,
            error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
}

// AI Answer Handler with Groq streaming
async function handleAI(request) {
    // Only allow POST requests
    if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) {
        console.error("[edge-search] Groq API key not configured");
        return new Response(JSON.stringify({ error: "Groq API key not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    let body;
    try {
        body = await request.json();
    } catch (e) {
        console.error("[edge-search] Invalid JSON body for AI request", {
            error: e instanceof Error ? e.message : String(e),
        });
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const { query } = body;

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
            const errorData = await response.json().catch(() => ({}));
            console.error("[edge-search] Groq request failed", {
                status: response.status,
                message: errorData.error?.message,
            });
            throw new Error(errorData.error?.message || `Groq API error: ${response.status}`);
        }

        // Stream the response back to the client
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Process the stream in the background
        (async () => {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let searchResults = null;

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
                            const json = JSON.parse(trimmed.slice(6));
                            
                            // Extract content for streaming
                            const content = json.choices?.[0]?.delta?.content;
                            if (content) {
                                await writer.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                            }
                            
                            // Extract search results from message (could be in delta or message)
                            const choice = json.choices?.[0];
                            const message = choice?.message || choice?.delta;
                            
                            if (message?.executed_tools) {
                                for (const tool of message.executed_tools) {
                                    if (tool.search_results) {
                                        searchResults = tool.search_results;
                                    }
                                }
                            }
                            
                            // Also check for tool_calls in delta
                            if (choice?.delta?.tool_calls) {
                                // Tool calls might be in progress, wait for final message
                            }
                        } catch (e) {
                            // Skip malformed JSON
                        }
                    }
                }

                // Send search results if we found any
                if (searchResults?.results && searchResults.results.length > 0) {
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
            } catch (e) {
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
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[edge-search] handleAI failed", { error: msg });
        return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}

