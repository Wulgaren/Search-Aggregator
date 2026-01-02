// Netlify serverless function to query Google Custom Search and Marginalia in parallel

export async function handler(event) {
    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const query = event.queryStringParameters?.q;
    
    if (!query || query.trim() === '') {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Query parameter "q" is required' })
        };
    }

    const encodedQuery = encodeURIComponent(query.trim());

    // Fetch both APIs in parallel
    const [googleResults, marginaliaResults] = await Promise.allSettled([
        fetchGoogle(encodedQuery),
        fetchMarginalia(encodedQuery)
    ]);

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
        },
        body: JSON.stringify({
            google: googleResults.status === 'fulfilled' 
                ? googleResults.value 
                : { error: googleResults.reason?.message || 'Failed to fetch Google results' },
            marginalia: marginaliaResults.status === 'fulfilled' 
                ? marginaliaResults.value 
                : { error: marginaliaResults.reason?.message || 'Failed to fetch Marginalia results' }
        })
    };
}

async function fetchGoogle(query) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;

    if (!apiKey || !cx) {
        throw new Error('Google API credentials not configured');
    }

    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${query}&num=10`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Google API error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
        results: (data.items || []).map(item => ({
            title: item.title,
            url: item.link,
            displayUrl: item.displayLink,
            snippet: item.snippet
        })),
        totalResults: data.searchInformation?.totalResults || '0'
    };
}

async function fetchMarginalia(query) {
    // Marginalia Search API - free and open
    const url = `https://api.marginalia.nu/public/search/${query}?count=10`;
    
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json'
        }
    });
    
    if (!response.ok) {
        throw new Error(`Marginalia API error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
        results: (data.results || []).map(item => ({
            title: item.title || item.url,
            url: item.url,
            displayUrl: new URL(item.url).hostname,
            snippet: item.description || ''
        })),
        totalResults: String(data.results?.length || 0)
    };
}

