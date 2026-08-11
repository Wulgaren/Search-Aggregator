import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    dedupeImages,
    fetchGoogle,
    fetchGoogleImages,
    isGoogleConfigured,
} from './google-search';

const originalEnv = { ...process.env };

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
    const private_key = `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
    return JSON.stringify({
        client_email: `vitest-${Date.now()}@example.iam.gserviceaccount.com`,
        private_key,
    });
}

describe('google-search lib', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        process.env = { ...originalEnv };
        delete process.env.GOOGLE_CX;
        delete process.env.GOOGLE_SERVICE_ACCOUNT;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.unstubAllGlobals();
    });

    it('isGoogleConfigured is false when CX or SA unset', () => {
        expect(isGoogleConfigured()).toBe(false);
        process.env.GOOGLE_CX = 'cx';
        expect(isGoogleConfigured()).toBe(false);
        delete process.env.GOOGLE_CX;
        process.env.GOOGLE_SERVICE_ACCOUNT = '{"client_email":"a","private_key":"b"}';
        expect(isGoogleConfigured()).toBe(false);
    });

    it('fetchGoogle returns empty when GOOGLE_CX unset', async () => {
        process.env.GOOGLE_SERVICE_ACCOUNT = await generateServiceAccountJson();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchGoogle('cats', 1, 10)).resolves.toEqual({
            results: [],
            hasMore: false,
            totalResults: '0',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetchGoogle returns empty when not configured', async () => {
        await expect(fetchGoogle('cats', 1, 10)).resolves.toEqual({
            results: [],
            hasMore: false,
            totalResults: '0',
        });
    });

    it('fetchGoogleImages returns [] when unset / not configured', async () => {
        await expect(fetchGoogleImages('cats')).resolves.toEqual([]);
        process.env.GOOGLE_CX = 'cx-only';
        await expect(fetchGoogleImages('cats')).resolves.toEqual([]);
    });

    it('token exchange + CSE via mocked fetch when configured', async () => {
        process.env.GOOGLE_CX = 'test-cx';
        process.env.GOOGLE_SERVICE_ACCOUNT = await generateServiceAccountJson();

        const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
            const url = String(input);
            if (url.includes('oauth2.googleapis.com/token')) {
                return new Response(
                    JSON.stringify({ access_token: 'ya29.test-token', expires_in: 3600 }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            if (url.includes('googleapis.com/customsearch/v1')) {
                expect(url).toContain('cx=test-cx');
                expect(url).toContain('q=cats');
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
            throw new Error(`Unexpected fetch: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchGoogle('cats', 1, 10);
        expect(result.results).toEqual([
            {
                title: 'Cats',
                url: 'https://example.com/cats',
                displayUrl: 'example.com',
                snippet: 'About cats',
                source: 'google',
            },
        ]);
        expect(result.totalResults).toBe('1');
        expect(fetchMock).toHaveBeenCalled();

        const tokenCall = fetchMock.mock.calls.find((c) =>
            String(c[0]).includes('oauth2.googleapis.com/token')
        );
        expect(tokenCall).toBeTruthy();

        const cseCall = fetchMock.mock.calls.find((c) =>
            String(c[0]).includes('customsearch/v1')
        );
        expect(cseCall).toBeTruthy();
        expect(cseCall![1]).toMatchObject({
            headers: { Authorization: 'Bearer ya29.test-token' },
        });
    });

    it('fetchGoogleImages uses token + image searchType when configured', async () => {
        process.env.GOOGLE_CX = 'test-cx';
        // Unique SA so module token cache resets
        process.env.GOOGLE_SERVICE_ACCOUNT = await generateServiceAccountJson();

        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('oauth2.googleapis.com/token')) {
                return new Response(
                    JSON.stringify({ access_token: 'ya29.img-token', expires_in: 3600 }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            if (url.includes('searchType=image')) {
                return new Response(
                    JSON.stringify({
                        items: [
                            {
                                title: 'Cat pic',
                                link: 'https://example.com/full.jpg',
                                image: {
                                    thumbnailLink: 'https://example.com/thumb.jpg',
                                    contextLink: 'https://example.com/page',
                                    width: 10,
                                    height: 10,
                                },
                            },
                        ],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        const images = await fetchGoogleImages('cats', 1);
        expect(images).toEqual([
            {
                thumbnail: 'https://example.com/thumb.jpg',
                full: 'https://example.com/full.jpg',
                title: 'Cat pic',
                sourceUrl: 'https://example.com/page',
                width: 10,
                height: 10,
                source: 'google',
            },
        ]);
    });

    it('dedupeImages collapses http(s) and trailing slash variants', () => {
        expect(
            dedupeImages([
                { full: 'https://example.com/a/' },
                { full: 'http://example.com/a' },
                { full: 'https://example.com/b' },
            ])
        ).toEqual([{ full: 'https://example.com/a/' }, { full: 'https://example.com/b' }]);
    });
});
