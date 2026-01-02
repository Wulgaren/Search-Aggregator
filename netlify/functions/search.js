// Netlify serverless function to query Google Custom Search and Marginalia in parallel

// Simple JWT signing for Google Service Account
async function createSignedJWT(serviceAccount) {
    const header = {
        alg: 'RS256',
        typ: 'JWT'
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/cse',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600 // 1 hour
    };

    const base64Header = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const base64Payload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const unsignedToken = `${base64Header}.${base64Payload}`;

    // Import the private key and sign
    const privateKey = serviceAccount.private_key;
    const pemContents = privateKey.replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s/g, '');

    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        binaryKey,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        encoder.encode(unsignedToken)
    );

    const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    return `${unsignedToken}.${base64Signature}`;
}

// Get access token from service account
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(serviceAccount) {
    // Return cached token if still valid (with 5 min buffer)
    if (cachedToken && Date.now() < tokenExpiry - 300000) {
        return cachedToken;
    }

    const jwt = await createSignedJWT(serviceAccount);

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Token error: ${error.error_description || response.status}`);
    }

    const data = await response.json();
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);

    return cachedToken;
}

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
    // Parse service account from environment variable
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT;
    const cx = process.env.GOOGLE_CX;

    if (!serviceAccountJson || !cx) {
        throw new Error('Google credentials not configured');
    }

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
        throw new Error('Invalid service account JSON');
    }

    // Get access token
    const accessToken = await getAccessToken(serviceAccount);

    // Calculate start index (1-indexed, 1-10, 11-20, etc.)
    const startIndex = (page - 1) * resultsPerPage + 1;

    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', resultsPerPage);
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
    const results = (data.items || []).map(item => ({
        title: item.title,
        url: item.link,
        displayUrl: item.displayLink,
        snippet: item.snippet
    }));

    // Google CSE returns totalResults, check if we have more pages
    const totalResults = parseInt(data.searchInformation?.totalResults) || 0;
    const hasMore = startIndex + results.length - 1 < totalResults && startIndex < 91; // Google limits to 100 results

    return {
        results,
        hasMore: hasMore && results.length === resultsPerPage,
        totalResults: String(totalResults)
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
