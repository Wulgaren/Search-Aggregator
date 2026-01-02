// Netlify serverless function to query Brave, Google, and Marginalia
import crypto from 'crypto';

// Cache for Google access token
let googleAccessToken = null;
let googleTokenExpiry = 0;

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
    const source = event.queryStringParameters?.source; // 'brave', 'google', 'marginalia', 'images', or undefined (all)

    if (!query || query.trim() === '') {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Query parameter "q" is required' })
        };
    }

    const searchQuery = query.trim();
    const resultsPerPage = 10;

    // Handle image search separately
    if (source === 'images') {
        const [braveImages, googleImages] = await Promise.allSettled([
            fetchBraveImages(searchQuery),
            fetchGoogleImages(searchQuery)
        ]);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300'
            },
            body: JSON.stringify({
                images: [
                    ...(braveImages.status === 'fulfilled' ? braveImages.value : []),
                    ...(googleImages.status === 'fulfilled' ? googleImages.value : [])
                ]
            })
        };
    }

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
        if (response.status === 429) {
            throw new Error('Rate limited - too many requests');
        }
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

async function getGoogleAccessToken() {
    // Return cached token if still valid (with 60s buffer)
    if (googleAccessToken && Date.now() < googleTokenExpiry - 60000) {
        return googleAccessToken;
    }

    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
        throw new Error('Google service account not configured');
    }

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(serviceAccountJson);
    } catch (e) {
        throw new Error('Invalid Google service account JSON');
    }

    const { client_email, private_key } = serviceAccount;
    if (!client_email || !private_key) {
        throw new Error('Service account missing client_email or private_key');
    }

    // Create JWT header and payload
    const now = Math.floor(Date.now() / 1000);
    const header = {
        alg: 'RS256',
        typ: 'JWT'
    };
    const payload = {
        iss: client_email,
        scope: 'https://www.googleapis.com/auth/cse',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600 // 1 hour
    };

    // Base64url encode
    const base64url = (obj) => {
        const json = JSON.stringify(obj);
        const base64 = Buffer.from(json).toString('base64');
        return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    };

    const headerEncoded = base64url(header);
    const payloadEncoded = base64url(payload);
    const signatureInput = `${headerEncoded}.${payloadEncoded}`;

    // Sign with RSA-SHA256
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(private_key, 'base64')
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const jwt = `${signatureInput}.${signature}`;

    // Exchange JWT for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(errorData.error_description || `Token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    googleAccessToken = tokenData.access_token;
    googleTokenExpiry = Date.now() + (tokenData.expires_in * 1000);

    return googleAccessToken;
}

async function fetchGoogle(query, page, resultsPerPage) {
    const cx = process.env.GOOGLE_CX;

    if (!cx) {
        // Google CX not configured, skip silently
        return { results: [], hasMore: false, totalResults: '0' };
    }

    // Check if service account is configured
    if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
        return { results: [], hasMore: false, totalResults: '0' };
    }

    // Google CSE uses 'start' parameter (1-indexed)
    const startIndex = (page - 1) * resultsPerPage + 1;

    // Google CSE limits to 100 results total
    if (startIndex > 91) {
        return { results: [], hasMore: false, totalResults: '0' };
    }

    // Get access token from service account
    const accessToken = await getGoogleAccessToken();

    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', Math.min(resultsPerPage, 10)); // Google max is 10 per request
    url.searchParams.set('start', startIndex);

    const response = await fetch(url.toString(), {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

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

async function fetchBraveImages(query) {
    const apiKey = process.env.BRAVE_API_KEY;

    if (!apiKey) {
        return [];
    }

    const url = new URL('https://api.search.brave.com/res/v1/images/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', 20);

    const response = await fetch(url.toString(), {
        headers: {
            'X-Subscription-Token': apiKey,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        console.error(`Brave images error: ${response.status}`);
        return [];
    }

    const data = await response.json();
    const results = data.results || [];

    return results.map(item => ({
        thumbnail: item.thumbnail?.src || item.properties?.url,
        full: item.properties?.url || item.thumbnail?.src,
        title: item.title || '',
        sourceUrl: item.url || '',
        width: item.properties?.width,
        height: item.properties?.height,
        source: 'brave'
    })).filter(img => img.thumbnail && img.full);
}

async function fetchGoogleImages(query) {
    const cx = process.env.GOOGLE_CX;

    if (!cx || !process.env.GOOGLE_SERVICE_ACCOUNT) {
        return [];
    }

    try {
        const accessToken = await getGoogleAccessToken();

        const url = new URL('https://www.googleapis.com/customsearch/v1');
        url.searchParams.set('cx', cx);
        url.searchParams.set('q', query);
        url.searchParams.set('searchType', 'image');
        url.searchParams.set('num', 10);

        const response = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        const items = data.items || [];

        return items.map(item => ({
            thumbnail: item.image?.thumbnailLink || item.link,
            full: item.link,
            title: item.title || '',
            sourceUrl: item.image?.contextLink || '',
            width: item.image?.width,
            height: item.image?.height,
            source: 'google'
        })).filter(img => img.thumbnail && img.full);
    } catch (e) {
        return [];
    }
}
