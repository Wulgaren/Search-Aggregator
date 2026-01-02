// Netlify serverless function to query Brave Search and Marginalia in parallel

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
    const source = event.queryStringParameters?.source; // 'commercial', 'noncommercial', or undefined (both)

    if (!query || query.trim() === '') {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Query parameter "q" is required' })
        };
    }

    const searchQuery = query.trim();
    const resultsPerPage = 10;

    // Determine which sources to fetch
    const fetchCommercialPromise = (!source || source === 'commercial')
        ? fetchBrave(searchQuery, page, resultsPerPage)
        : Promise.resolve(null);

    const fetchNoncommercialPromise = (!source || source === 'noncommercial')
        ? fetchMarginalia(searchQuery, page, resultsPerPage)
        : Promise.resolve(null);

    // Fetch APIs in parallel
    const [commercialResults, noncommercialResults] = await Promise.allSettled([
        fetchCommercialPromise,
        fetchNoncommercialPromise
    ]);

    const response = {
        page
    };

    if (!source || source === 'commercial') {
        response.commercial = commercialResults.status === 'fulfilled' && commercialResults.value
            ? commercialResults.value
            : { error: commercialResults.reason?.message || 'Failed to fetch Brave results', results: [] };
    }

    if (!source || source === 'noncommercial') {
        response.noncommercial = noncommercialResults.status === 'fulfilled' && noncommercialResults.value
            ? noncommercialResults.value
            : { error: noncommercialResults.reason?.message || 'Failed to fetch Marginalia results', results: [] };
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

async function fetchBrave(query, page, resultsPerPage) {
    const apiKey = process.env.BRAVE_API_KEY;

    if (!apiKey) {
        throw new Error('Brave API key not configured');
    }

    // Brave uses 'offset' for pagination (0-indexed)
    const offset = (page - 1) * resultsPerPage;

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', resultsPerPage);
    url.searchParams.set('offset', offset);

    const response = await fetch(url.toString(), {
        headers: {
            'X-Subscription-Token': apiKey,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Brave API error: ${response.status}`);
    }

    const data = await response.json();
    const webResults = data.web?.results || [];

    const results = webResults.map(item => ({
        title: item.title,
        url: item.url,
        displayUrl: item.meta_url?.hostname || new URL(item.url).hostname,
        snippet: item.description || ''
    }));

    // Check if there are more results
    const hasMore = webResults.length === resultsPerPage && offset + resultsPerPage < 200; // Brave limits offset to 200

    return {
        results,
        hasMore,
        totalResults: String(data.web?.total || results.length)
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
