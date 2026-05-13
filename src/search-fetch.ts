import {
    createCachedGoogleSearchGet,
    handleGoogleSearchRequest,
    isGoogleClientSearchUrl,
} from './google-search';

const cachedGoogleSearchGet = createCachedGoogleSearchGet((request) => handleGoogleSearchRequest(request));

/** Shared fetch for `/api/search` routes; Google-backed URLs use browser cache + client handler (not edge only). */
export async function searchApiFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = new URL(path, window.location.origin);
    if (url.pathname === '/api/search' && (!init?.method || init.method === 'GET')) {
        if (isGoogleClientSearchUrl(url)) return cachedGoogleSearchGet(url.pathname + url.search);
        return fetch(url.toString());
    }
    return fetch(url.toString(), init);
}
