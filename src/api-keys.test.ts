import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./google-search', () => ({
    clearGoogleClientCaches: vi.fn(),
    invalidateGoogleSearchCache: vi.fn(),
}));

vi.mock('./tavily-search', () => ({
    invalidateTavilySearchCache: vi.fn(),
    primeTavilyConnection: vi.fn(),
}));

import {
    LS_KEYS,
    applyApiSecretsFromFields,
    clearStoredGoogleAccessToken,
    getApiSecret,
    getApiSecretsFields,
    getStoredGoogleAccessToken,
    getStoredGoogleTokenState,
    hasGoogleSearchConfigured,
    hasTavilySearchConfigured,
    setApiSecrets,
    setStoredGoogleAccessToken,
} from './api-keys';

const MIN_SA = JSON.stringify({
    type: 'service_account',
    client_email: 'bot@example.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n',
});

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
});

describe('getApiSecret / setApiSecrets', () => {
    it('returns empty string when unset', () => {
        expect(getApiSecret('GOOGLE_CX')).toBe('');
        expect(getApiSecret('GOOGLE_SERVICE_ACCOUNT')).toBe('');
    });

    it('stores trimmed values', () => {
        setApiSecrets({ GOOGLE_CX: '  cx-123  ', GOOGLE_SERVICE_ACCOUNT: `  ${MIN_SA}  ` });
        expect(getApiSecret('GOOGLE_CX')).toBe('cx-123');
        expect(getApiSecret('GOOGLE_SERVICE_ACCOUNT')).toBe(MIN_SA);
        expect(localStorage.getItem(LS_KEYS.GOOGLE_CX)).toBe('cx-123');
    });

    it('empty string clears the key', () => {
        setApiSecrets({ GOOGLE_CX: 'cx-123', GOOGLE_SERVICE_ACCOUNT: MIN_SA });
        setApiSecrets({ GOOGLE_CX: '', GOOGLE_SERVICE_ACCOUNT: '   ' });
        expect(getApiSecret('GOOGLE_CX')).toBe('');
        expect(getApiSecret('GOOGLE_SERVICE_ACCOUNT')).toBe('');
        expect(localStorage.getItem(LS_KEYS.GOOGLE_CX)).toBeNull();
        expect(localStorage.getItem(LS_KEYS.GOOGLE_SERVICE_ACCOUNT)).toBeNull();
    });

    it('ignores undefined entries', () => {
        setApiSecrets({ GOOGLE_CX: 'keep-me' });
        setApiSecrets({ GOOGLE_CX: undefined, GOOGLE_SERVICE_ACCOUNT: MIN_SA });
        expect(getApiSecret('GOOGLE_CX')).toBe('keep-me');
        expect(getApiSecret('GOOGLE_SERVICE_ACCOUNT')).toBe(MIN_SA);
    });
});

describe('Google OAuth token cache', () => {
    it('getStoredGoogleTokenState returns valid unexpired token', () => {
        const expiresAtMs = Date.now() + 10 * 60_000;
        localStorage.setItem(
            LS_KEYS.GOOGLE_OAUTH_TOKEN,
            JSON.stringify({ accessToken: 'tok-valid', expiresAtMs })
        );
        expect(getStoredGoogleTokenState()).toEqual({
            accessToken: 'tok-valid',
            expiresAtMs,
        });
        expect(getStoredGoogleAccessToken()).toBe('tok-valid');
    });

    it('returns null when expired or within buffer', () => {
        vi.useFakeTimers();
        const now = 1_700_000_000_000;
        vi.setSystemTime(now);

        localStorage.setItem(
            LS_KEYS.GOOGLE_OAUTH_TOKEN,
            JSON.stringify({ accessToken: 'tok-old', expiresAtMs: now - 1 })
        );
        expect(getStoredGoogleTokenState()).toBeNull();

        localStorage.setItem(
            LS_KEYS.GOOGLE_OAUTH_TOKEN,
            JSON.stringify({ accessToken: 'tok-soon', expiresAtMs: now + 30_000 })
        );
        expect(getStoredGoogleTokenState()).toBeNull();
    });

    it('returns null for missing, invalid JSON, or incomplete shape', () => {
        expect(getStoredGoogleTokenState()).toBeNull();

        localStorage.setItem(LS_KEYS.GOOGLE_OAUTH_TOKEN, '{not-json');
        expect(getStoredGoogleTokenState()).toBeNull();

        localStorage.setItem(
            LS_KEYS.GOOGLE_OAUTH_TOKEN,
            JSON.stringify({ accessToken: '', expiresAtMs: Date.now() + 120_000 })
        );
        expect(getStoredGoogleTokenState()).toBeNull();

        localStorage.setItem(
            LS_KEYS.GOOGLE_OAUTH_TOKEN,
            JSON.stringify({ accessToken: 'tok', expiresAtMs: 'nope' })
        );
        expect(getStoredGoogleTokenState()).toBeNull();
    });

    it('setStoredGoogleAccessToken writes token; clearStoredGoogleAccessToken removes it', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);

        setStoredGoogleAccessToken('tok-set', 3600);
        expect(getStoredGoogleAccessToken()).toBe('tok-set');
        expect(getStoredGoogleTokenState()?.expiresAtMs).toBe(1_700_000_000_000 + 3600 * 1000);

        clearStoredGoogleAccessToken();
        expect(localStorage.getItem(LS_KEYS.GOOGLE_OAUTH_TOKEN)).toBeNull();
        expect(getStoredGoogleAccessToken()).toBeNull();
        expect(getStoredGoogleTokenState()).toBeNull();
    });
});

describe('hasGoogleSearchConfigured', () => {
    it('requires both service account and cx', () => {
        expect(hasGoogleSearchConfigured()).toBe(false);

        setApiSecrets({ GOOGLE_CX: 'cx-only' });
        expect(hasGoogleSearchConfigured()).toBe(false);

        setApiSecrets({ GOOGLE_SERVICE_ACCOUNT: MIN_SA });
        expect(hasGoogleSearchConfigured()).toBe(true);

        setApiSecrets({ GOOGLE_CX: '' });
        expect(hasGoogleSearchConfigured()).toBe(false);
    });
});

describe('getApiSecretsFields / applyApiSecretsFromFields', () => {
    it('pretty-prints valid SA JSON; passes through invalid SA raw', () => {
        setApiSecrets({
            GOOGLE_CX: 'cx-1',
            GOOGLE_SERVICE_ACCOUNT: '{"type":"service_account","client_email":"a@b.c"}',
        });
        const pretty = getApiSecretsFields();
        expect(pretty.googleCx).toBe('cx-1');
        expect(pretty.googleServiceAccount).toContain('\n');
        expect(JSON.parse(pretty.googleServiceAccount)).toEqual({
            type: 'service_account',
            client_email: 'a@b.c',
        });

        setApiSecrets({ GOOGLE_SERVICE_ACCOUNT: 'not-json{' });
        expect(getApiSecretsFields().googleServiceAccount).toBe('not-json{');
    });

    it('applies minimal fixtures and clears with empty fields', () => {
        const ok = applyApiSecretsFromFields({
            googleCx: '  my-cx  ',
            googleServiceAccount: `  ${MIN_SA}  `,
            tavilyApiKey: '  tvly-test  ',
        });
        expect(ok).toEqual({ ok: true });
        expect(getApiSecret('GOOGLE_CX')).toBe('my-cx');
        expect(getApiSecret('GOOGLE_SERVICE_ACCOUNT')).toBe(MIN_SA);
        expect(getApiSecret('TAVILY_API_KEY')).toBe('tvly-test');
        expect(hasTavilySearchConfigured()).toBe(true);

        const cleared = applyApiSecretsFromFields({
            googleCx: '',
            googleServiceAccount: '',
            tavilyApiKey: '',
        });
        expect(cleared).toEqual({ ok: true });
        expect(getApiSecret('GOOGLE_CX')).toBe('');
        expect(getApiSecret('GOOGLE_SERVICE_ACCOUNT')).toBe('');
        expect(getApiSecret('TAVILY_API_KEY')).toBe('');
        expect(hasTavilySearchConfigured()).toBe(false);
    });

    it('rejects non-object-looking SA that is not valid JSON', () => {
        const bad = applyApiSecretsFromFields({
            googleCx: 'cx',
            googleServiceAccount: 'not-a-json-object',
            tavilyApiKey: '',
        });
        expect(bad).toEqual({
            ok: false,
            error: 'googleServiceAccount must be valid JSON (service account object).',
        });
        expect(getApiSecret('GOOGLE_CX')).toBe('');
    });

    it('accepts SA JSON that starts with { without re-validating shape', () => {
        const result = applyApiSecretsFromFields({
            googleCx: 'cx',
            googleServiceAccount: '{ "type": "service_account" }',
            tavilyApiKey: '',
        });
        expect(result).toEqual({ ok: true });
        expect(getApiSecret('GOOGLE_SERVICE_ACCOUNT')).toBe('{ "type": "service_account" }');
    });
});

describe('hasTavilySearchConfigured', () => {
    it('is true only when a Tavily API key is stored', () => {
        expect(hasTavilySearchConfigured()).toBe(false);
        setApiSecrets({ TAVILY_API_KEY: 'tvly-abc' });
        expect(hasTavilySearchConfigured()).toBe(true);
        setApiSecrets({ TAVILY_API_KEY: '' });
        expect(hasTavilySearchConfigured()).toBe(false);
    });
});
