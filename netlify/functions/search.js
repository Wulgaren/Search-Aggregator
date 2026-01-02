// Netlify serverless function to query Brave, Google, and Marginalia

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
    const source = event.queryStringParameters?.source; // 'brave', 'google', 'marginalia', or undefined (all)

    if (!query || query.trim() === '') {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Query parameter "q" is required' })
        };
    }

    const searchQuery = query.trim();
    const resultsPerPage = 10;

    // Determine which sources to fetch
    const fetchBravePromise = (!source || source === 'brave')
        ? fetchBrave(searchQuery, page, resultsPerPage)
        : Promise.resolve(null);

    const fetchGooglePromise = (!source || source === 'google')
        ? fetchGoogle(searchQuery, page, resultsPerPage)
        : Promise.resolve(null);

    const fetchMarginaliaPromise = (!source || source === 'marginalia')
        ? fetchMarginalia(searchQuery, page, resultsPerPage)
        : Promise.resolve(null);

    // Fetch APIs in parallel
    const [braveResults, googleResults, marginaliaResults] = await Promise.allSettled([
        fetchBravePromise,
        fetchGooglePromise,
        fetchMarginaliaPromise
    ]);

    const response = { page };

    if (!source || source === 'brave') {
        response.brave = braveResults.status === 'fulfilled' && braveResults.value
            ? braveResults.value
            : { error: braveResults.reason?.message || 'Failed to fetch Brave results', results: [] };
    }

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
            'Cache-Control': 'public, max-age=300'
        },
        body: JSON.stringify(response)
    };
}

async function fetchBrave(query, page, resultsPerPage) {
    const apiKey = process.env.BRAVE_API_KEY;

    if (!apiKey) {
        throw new Error('Brave API key not configured');
    }

    // Brave's offset is page number (0-indexed), max 9
    const offset = page - 1;

    if (offset > 9) {
        return { results: [], hasMore: false, totalResults: '0' };
    }

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
        snippet: item.description || '',
        source: 'brave'
    }));

    return {
        results,
        hasMore: webResults.length === resultsPerPage && offset < 9,
        totalResults: String(data.web?.total || results.length)
    };
}

async function fetchGoogle(query, page, resultsPerPage) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;

    if (!apiKey || !cx) {
        // Google not configured, skip silently
        return { results: [], hasMore: false, totalResults: '0' };
    }

    // Google CSE uses 'start' parameter (1-indexed)
    const startIndex = (page - 1) * resultsPerPage + 1;

    // Google CSE limits to 100 results total
    if (startIndex > 91) {
        return { results: [], hasMore: false, totalResults: '0' };
    }

    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', Math.min(resultsPerPage, 10)); // Google max is 10 per request
    url.searchParams.set('start', startIndex);

    const response = await fetch(url.toString());

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Google API error: ${response.status}`);
    }

    const data = await response.json();
    const items = data.items || [];

    const results = items.map(item => ({
        title: item.title,
        url: item.link,
        displayUrl: item.displayLink,
        snippet: item.snippet || '',
        source: 'google'
    }));

    const totalResults = parseInt(data.searchInformation?.totalResults) || 0;
    const hasMore = startIndex + results.length - 1 < totalResults && startIndex < 91;

    return {
        results,
        hasMore: hasMore && results.length === Math.min(resultsPerPage, 10),
        totalResults: String(totalResults)
    };
}

async function fetchMarginalia(query, page, resultsPerPage) {
    const offset = (page - 1) * resultsPerPage;
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.marginalia.nu/public/search/${encodedQuery}?count=${resultsPerPage}&index=${offset}`;

    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
        throw new Error(`Marginalia API error: ${response.status}`);
    }

    const data = await response.json();
    const results = (data.results || []).map(item => ({
        title: item.title || item.url,
        url: item.url,
        displayUrl: new URL(item.url).hostname,
        snippet: item.description || '',
        source: 'marginalia'
    }));

    return {
        results,
        hasMore: results.length === resultsPerPage,
        totalResults: String(data.results?.length || 0)
    };
}
