/** Google Custom Search credentials + OAuth token cache (localStorage). */

export const LS_KEYS = {
    GOOGLE_SERVICE_ACCOUNT: 'searchApiGoogleServiceAccount',
    GOOGLE_CX: 'searchApiGoogleCx',
    GOOGLE_OAUTH_TOKEN: 'searchGoogleOAuthToken',
} as const;

const GOOGLE_TOKEN_BUFFER_MS = 60_000;

export type ApiSecretId = Exclude<keyof typeof LS_KEYS, 'GOOGLE_OAUTH_TOKEN'>;

export function getApiSecret(id: ApiSecretId): string {
    try {
        return localStorage.getItem(LS_KEYS[id])?.trim() ?? '';
    } catch {
        return '';
    }
}

export function setApiSecrets(values: Partial<Record<ApiSecretId, string>>): void {
    for (const id of Object.keys(values) as ApiSecretId[]) {
        const v = values[id];
        if (v === undefined) continue;
        const trimmed = v.trim();
        if (trimmed === '') {
            localStorage.removeItem(LS_KEYS[id]);
        } else {
            localStorage.setItem(LS_KEYS[id], trimmed);
        }
    }
}

type StoredGoogleToken = { accessToken: string; expiresAtMs: number };

export function getStoredGoogleTokenState(): StoredGoogleToken | null {
    try {
        const raw = localStorage.getItem(LS_KEYS.GOOGLE_OAUTH_TOKEN);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredGoogleToken;
        if (!parsed?.accessToken || typeof parsed.expiresAtMs !== 'number') {
            return null;
        }
        if (Date.now() >= parsed.expiresAtMs - GOOGLE_TOKEN_BUFFER_MS) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function getStoredGoogleAccessToken(): string | null {
    return getStoredGoogleTokenState()?.accessToken ?? null;
}

export function setStoredGoogleAccessToken(accessToken: string, expiresInSec: number): void {
    const expiresAtMs = Date.now() + expiresInSec * 1000;
    try {
        localStorage.setItem(
            LS_KEYS.GOOGLE_OAUTH_TOKEN,
            JSON.stringify({ accessToken, expiresAtMs })
        );
    } catch {
        // ignore
    }
}

export function clearStoredGoogleAccessToken(): void {
    try {
        localStorage.removeItem(LS_KEYS.GOOGLE_OAUTH_TOKEN);
    } catch {
        // ignore
    }
}

export function getApiSecretsFields(): { googleCx: string; googleServiceAccount: string } {
    const saRaw = getApiSecret('GOOGLE_SERVICE_ACCOUNT');
    let googleServiceAccount = '';
    if (saRaw) {
        try {
            googleServiceAccount = JSON.stringify(JSON.parse(saRaw) as Record<string, unknown>, null, 2);
        } catch {
            googleServiceAccount = saRaw;
        }
    }
    return {
        googleCx: getApiSecret('GOOGLE_CX'),
        googleServiceAccount,
    };
}

export function applyApiSecretsFromFields(fields: {
    googleCx: string;
    googleServiceAccount: string;
}): { ok: true } | { ok: false; error: string } {
    const googleCx = fields.googleCx.trim();
    const googleServiceAccount = fields.googleServiceAccount.trim();

    if (googleServiceAccount && !googleServiceAccount.startsWith('{')) {
        try {
            JSON.parse(googleServiceAccount);
        } catch {
            return { ok: false, error: 'googleServiceAccount must be valid JSON (service account object).' };
        }
    }

    setApiSecrets({
        GOOGLE_CX: googleCx,
        GOOGLE_SERVICE_ACCOUNT: googleServiceAccount,
    });

    return { ok: true };
}
