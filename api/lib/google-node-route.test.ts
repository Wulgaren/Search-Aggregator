import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googleNodeRequest } from './google-node-route';

const originalEnv = { ...process.env };

function urlOf(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

async function generateServiceAccountJson(): Promise<string> {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['sign', 'verify']
    );
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
    const wrapped = (b64.match(/.{1,64}/g) || [b64]).join('\n');
    return JSON.stringify({
        client_email: `vitest-node-${Date.now()}@example.iam.gserviceaccount.com`,
        private_key: `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`,
    });
}

describe('googleNodeRequest', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        process.env = { ...originalEnv };
        delete process.env["GOOGLE_CX"];
        delete process.env["GOOGLE_SERVICE_ACCOUNT"];
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.unstubAllGlobals();
    });

    it('returns 405 for non-GET', async () => {
        const res = await googleNodeRequest(
            new Request('https://example.com/api/google?q=cats', { method: 'POST' })
        );
        expect(res.status).toBe(405);
        await expect(res.json()).resolves.toEqual({ error: 'Method not allowed' });
    });

    it('returns 400 when q missing', async () => {
        const res = await googleNodeRequest(new Request('https://example.com/api/google'));
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({
            error: 'Query parameter "q" is required',
        });
    });

    it('kind=web without env returns quiet empty google payload', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const res = await googleNodeRequest(
            new Request('https://example.com/api/google?q=cats&kind=web')
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({
            page: 1,
            google: { results: [], hasMore: false, totalResults: '0' },
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('kind=images without env returns empty images', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const res = await googleNodeRequest(
            new Request('https://example.com/api/google?q=cats&kind=images')
        );
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ images: [] });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('kind=web surfaces CSE errors on google.error', async () => {
        process.env["GOOGLE_CX"] = 'test-cx';
        process.env["GOOGLE_SERVICE_ACCOUNT"] = await generateServiceAccountJson();

        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = urlOf(input);
            if (url.includes('oauth2.googleapis.com/token')) {
                return new Response(
                    JSON.stringify({ access_token: 'ya29.fail', expires_in: 3600 }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            if (url.includes('customsearch/v1')) {
                return new Response(
                    JSON.stringify({ error: { message: 'CSE quota exceeded' } }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        const res = await googleNodeRequest(
            new Request('https://example.com/api/google?q=cats&kind=web&page=1')
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.google).toMatchObject({
            error: 'CSE quota exceeded',
            results: [],
            hasMore: false,
        });
    });

    it('kind=web returns CSE results when configured', async () => {
        process.env["GOOGLE_CX"] = 'test-cx';
        process.env["GOOGLE_SERVICE_ACCOUNT"] = await generateServiceAccountJson();

        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = urlOf(input);
            if (url.includes('oauth2.googleapis.com/token')) {
                return new Response(
                    JSON.stringify({ access_token: 'ya29.ok', expires_in: 3600 }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            if (url.includes('customsearch/v1') && !url.includes('searchType=image')) {
                return new Response(
                    JSON.stringify({
                        items: [
                            {
                                title: 'Cats',
                                link: 'https://example.com/cats',
                                displayLink: 'example.com',
                                snippet: 'About cats',
                            },
                        ],
                        searchInformation: { totalResults: '1' },
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        const res = await googleNodeRequest(
            new Request('https://example.com/api/google?q=cats&kind=web')
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.google.results).toEqual([
            expect.objectContaining({ title: 'Cats', source: 'google' }),
        ]);
    });

    it('rejects invalid kind', async () => {
        const res = await googleNodeRequest(
            new Request('https://example.com/api/google?q=cats&kind=other')
        );
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({
            error: 'Invalid kind; use "web" or "images"',
        });
    });
});
