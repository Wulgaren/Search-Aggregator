// Netlify serverless function to query Serper (Google) and Marginalia in parallel

export async function handler(event) {
    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const query = event.queryStringParameters?.q;
    const page = parseInt(event.queryStringParameters?.page) || 1;
    const source = event.queryStringParameters?.source; // 'google', 'marginalia', or undefined (both)

    if (!query || query.trim() === '') {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Query parameter "q" is required' })
        };
    }

    const searchQuery = query.trim();
    const resultsPerPage = 10;

    // Determine which sources to fetch
    const fetchGooglePromise = (!source || source === 'google')
        ? fetchGoogle(searchQuery, page, resultsPerPage)
        : Promise.resolve(null);

    const fetchMarginaliaPromise = (!source || source === 'marginalia')
        ? fetchMarginalia(searchQuery, page, resultsPerPage)
        : Promise.resolve(null);

    // Fetch APIs in parallel
    const [googleResults, marginaliaResults] = await Promise.allSettled([
        fetchGooglePromise,
        fetchMarginaliaPromise
    ]);

    const response = {
        page
    };

    if (!source || source === 'google') {
        response.google = googleResults.status === 'fulfilled' && googleResults.value
            ? googleResults.value
            : { error: googleResults.reason?.message || 'Failed to fetch Google results', results: [] };
    }

    if (!source || source === 'marginalia') {
        response.marginalia = marginaliaResults.status === 'fulfilled' && marginaliaResults.value
            ? marginaliaResults.value
            : { error: marginaliaResults.reason?.message || 'Failed to fetch Marginalia results', results: [] };
    }

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
        },
        body: JSON.stringify(response)
    };
}

async function fetchGoogle(query, page, resultsPerPage) {
    const apiKey = process.env.SERPER_API_KEY;

    if (!apiKey) {
        throw new Error('Serper API key not configured');
    }

    // Serper uses 'page' parameter (1-indexed)
    const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            q: query,
            num: resultsPerPage,
            page: page
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Serper API error: ${response.status}`);
    }

    const data = await response.json();
    const results = (data.organic || []).map(item => ({
        title: item.title,
        url: item.link,
        displayUrl: item.displayedLink || new URL(item.link).hostname,
        snippet: item.snippet
    }));

    return {
        results,
        hasMore: results.length === resultsPerPage,
        totalResults: String(data.searchInformation?.totalResults || results.length)
    };
}

async function fetchMarginalia(query, page, resultsPerPage) {
    // Marginalia Search API - free and open
    // Uses 'index' for pagination (0-indexed offset)
    const offset = (page - 1) * resultsPerPage;
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.marginalia.nu/public/search/${encodedQuery}?count=${resultsPerPage}&index=${offset}`;

    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Marginalia API error: ${response.status}`);
    }

    const data = await response.json();
    const results = (data.results || []).map(item => ({
        title: item.title || item.url,
        url: item.url,
        displayUrl: new URL(item.url).hostname,
        snippet: item.description || ''
    }));

    return {
        results,
        hasMore: results.length === resultsPerPage,
        totalResults: String(data.results?.length || 0)
    };
}
