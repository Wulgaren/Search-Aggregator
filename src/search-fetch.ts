import {
    createCachedGoogleSearchGet,
    handleGoogleSearchRequest,
    isGoogleClientSearchUrl,
} from './google-search';
import {
    createCachedTavilySearchGet,
    handleTavilySearchRequest,
    isTavilyClientSearchUrl,
} from './tavily-search';

const cachedGoogleSearchGet = createCachedGoogleSearchGet((request) => handleGoogleSearchRequest(request));
const cachedTavilySearchGet = createCachedTavilySearchGet((request) => handleTavilySearchRequest(request));

/** Shared fetch for `/api/search` routes; Google/Tavily URLs use browser cache + client handler (not edge). */
export async function searchApiFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = new URL(path, window.location.origin);
    if (url.pathname === '/api/search' && (!init?.method || init.method === 'GET')) {
        if (isGoogleClientSearchUrl(url)) return cachedGoogleSearchGet(url.pathname + url.search, init);
        if (isTavilyClientSearchUrl(url)) return cachedTavilySearchGet(url.pathname + url.search, init);
        return fetch(url.toString(), init);
    }
    return fetch(url.toString(), init);
}
