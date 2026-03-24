/** Browser-only API secrets and Google OAuth token persistence (localStorage). */

export const LS_KEYS = {
    BRAVE_API_KEY: 'searchApiBraveKey',
    GOOGLE_SERVICE_ACCOUNT: 'searchApiGoogleServiceAccount',
    GOOGLE_CX: 'searchApiGoogleCx',
    GROQ_API_KEY: 'searchApiGroqKey',
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

export function setApiSecrets(
    values: Partial<Record<ApiSecretId, string>>
): void {
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

export function setStoredGoogleAccessToken(
    accessToken: string,
    expiresInSec: number
): void {
    const expiresAtMs = Date.now() + expiresInSec * 1000;
    try {
        localStorage.setItem(
            LS_KEYS.GOOGLE_OAUTH_TOKEN,
            JSON.stringify({ accessToken, expiresAtMs })
        );
    } catch {
        // ignore quota / private mode
    }
}

export function clearStoredGoogleAccessToken(): void {
    try {
        localStorage.removeItem(LS_KEYS.GOOGLE_OAUTH_TOKEN);
    } catch {
        // ignore
    }
}

/** Shape for the single JSON editor (all keys in one object). */
export type ApiConfigFile = {
    braveApiKey?: string;
    googleCx?: string;
    /** Full Google service account JSON (object) or a JSON string */
    googleServiceAccount?: string | Record<string, unknown>;
    groqApiKey?: string;
};

/** Values for the individual API settings inputs (from localStorage). */
export function getApiSecretsFields(): {
    braveApiKey: string;
    googleCx: string;
    googleServiceAccount: string;
    groqApiKey: string;
} {
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
        braveApiKey: getApiSecret('BRAVE_API_KEY'),
        googleCx: getApiSecret('GOOGLE_CX'),
        googleServiceAccount,
        groqApiKey: getApiSecret('GROQ_API_KEY'),
    };
}

/** Pretty JSON for the settings dialog textarea (from current localStorage). */
export function getApiConfigJsonText(): string {
    const saRaw = getApiSecret('GOOGLE_SERVICE_ACCOUNT');
    let googleServiceAccount: string | Record<string, unknown> = '';
    if (saRaw) {
        try {
            googleServiceAccount = JSON.parse(saRaw) as Record<string, unknown>;
        } catch {
            googleServiceAccount = saRaw;
        }
    }
    const obj: ApiConfigFile = {
        braveApiKey: getApiSecret('BRAVE_API_KEY') || undefined,
        googleCx: getApiSecret('GOOGLE_CX') || undefined,
        googleServiceAccount: googleServiceAccount || undefined,
        groqApiKey: getApiSecret('GROQ_API_KEY') || undefined,
    };
    const cleaned = Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v !== undefined && v !== '')
    );
    return JSON.stringify(Object.keys(cleaned).length ? cleaned : {}, null, 2);
}

export function applyApiConfigJsonText(
    raw: string
): { ok: true } | { ok: false; error: string } {
    const trimmed = raw.trim();
    if (trimmed === '') {
        setApiSecrets({
            BRAVE_API_KEY: '',
            GOOGLE_CX: '',
            GOOGLE_SERVICE_ACCOUNT: '',
            GROQ_API_KEY: '',
        });
        return { ok: true };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch (e) {
        return { ok: false, error: 'Invalid JSON: ' + (e instanceof Error ? e.message : String(e)) };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'Configuration must be a JSON object, e.g. { "braveApiKey": "..." }.' };
    }

    const o = parsed as Record<string, unknown>;
    const allowed = new Set([
        'braveApiKey',
        'googleCx',
        'googleServiceAccount',
        'groqApiKey',
    ]);
    for (const k of Object.keys(o)) {
        if (!allowed.has(k)) {
            return { ok: false, error: `Unknown key "${k}". Use: braveApiKey, googleCx, googleServiceAccount, groqApiKey.` };
        }
    }

    const braveApiKey = typeof o.braveApiKey === 'string' ? o.braveApiKey.trim() : '';
    const googleCx = typeof o.googleCx === 'string' ? o.googleCx.trim() : '';

    let googleServiceAccount = '';
    const gsa = o.googleServiceAccount;
    if (gsa !== undefined && gsa !== null) {
        if (typeof gsa === 'string') {
            googleServiceAccount = gsa.trim();
        } else if (typeof gsa === 'object') {
            googleServiceAccount = JSON.stringify(gsa);
        } else {
            return { ok: false, error: 'googleServiceAccount must be a JSON object or string.' };
        }
    }

    const groqApiKey = typeof o.groqApiKey === 'string' ? o.groqApiKey.trim() : '';

    return applyApiSecretsFromFields({
        braveApiKey,
        googleCx,
        googleServiceAccount,
        groqApiKey,
    });
}

/** Persist API secrets from individual form fields (same rules as JSON import). */
export function applyApiSecretsFromFields(fields: {
    braveApiKey: string;
    googleCx: string;
    googleServiceAccount: string;
    groqApiKey: string;
}): { ok: true } | { ok: false; error: string } {
    const braveApiKey = fields.braveApiKey.trim();
    const googleCx = fields.googleCx.trim();
    const googleServiceAccount = fields.googleServiceAccount.trim();
    const groqApiKey = fields.groqApiKey.trim();

    if (googleServiceAccount && !googleServiceAccount.startsWith('{')) {
        try {
            JSON.parse(googleServiceAccount);
        } catch {
            return { ok: false, error: 'googleServiceAccount must be valid JSON (service account object).' };
        }
    }

    setApiSecrets({
        BRAVE_API_KEY: braveApiKey,
        GOOGLE_CX: googleCx,
        GOOGLE_SERVICE_ACCOUNT: googleServiceAccount,
        GROQ_API_KEY: groqApiKey,
    });

    return { ok: true };
}
