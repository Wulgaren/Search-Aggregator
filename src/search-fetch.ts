/** Shared fetch for `/api/search` and other same-origin API routes (edge). */
export async function searchApiFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = new URL(path, window.location.origin);
    return fetch(url.toString(), init);
}
