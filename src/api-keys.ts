/** Google Custom Search + Tavily credentials + OAuth token cache (localStorage). */
import { clearGoogleClientCaches, invalidateGoogleSearchCache } from './google-search';
import { invalidateTavilySearchCache, primeTavilyConnection } from './tavily-search';
import type { ApiSecretsFields, ApplyApiSecretsResult, StoredGoogleToken } from './types';
import { asRecord, isRecord, readNumber, readString } from './unknown';

export const LS_KEYS = {
    GOOGLE_SERVICE_ACCOUNT: 'searchApiGoogleServiceAccount',
    GOOGLE_CX: 'searchApiGoogleCx',
    GOOGLE_OAUTH_TOKEN: 'searchGoogleOAuthToken',
    TAVILY_API_KEY: 'searchApiTavilyApiKey',
} as const;

const GOOGLE_TOKEN_BUFFER_MS = 60_000;

export type ApiSecretId = Exclude<keyof typeof LS_KEYS, 'GOOGLE_OAUTH_TOKEN'>;

const API_SECRET_IDS: ApiSecretId[] = ['GOOGLE_SERVICE_ACCOUNT', 'GOOGLE_CX', 'TAVILY_API_KEY'];

export function getApiSecret(id: ApiSecretId): string {
    try {
        return localStorage.getItem(LS_KEYS[id])?.trim() ?? '';
    } catch {
        return '';
    }
}

export function setApiSecrets(values: { [K in ApiSecretId]?: string | undefined }): void {
    for (const id of API_SECRET_IDS) {
        if (!Object.prototype.hasOwnProperty.call(values, id)) continue;
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

function parseStoredGoogleToken(value: unknown): StoredGoogleToken | null {
    if (!isRecord(value)) return null;
    const accessToken = readString(value, 'accessToken');
    const expiresAtMs = readNumber(value, 'expiresAtMs');
    if (!accessToken || expiresAtMs === undefined) return null;
    return { accessToken, expiresAtMs };
}

export function getStoredGoogleTokenState(): StoredGoogleToken | null {
    try {
        const raw = localStorage.getItem(LS_KEYS.GOOGLE_OAUTH_TOKEN);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        const token = parseStoredGoogleToken(parsed);
        if (!token) return null;
        if (Date.now() >= token.expiresAtMs - GOOGLE_TOKEN_BUFFER_MS) {
            return null;
        }
        return token;
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

export function getApiSecretsFields(): ApiSecretsFields {
    const saRaw = getApiSecret('GOOGLE_SERVICE_ACCOUNT');
    let googleServiceAccount = '';
    if (saRaw) {
        try {
            const parsed: unknown = JSON.parse(saRaw);
            googleServiceAccount = JSON.stringify(asRecord(parsed) ?? parsed, null, 2);
        } catch {
            googleServiceAccount = saRaw;
        }
    }
    return {
        googleCx: getApiSecret('GOOGLE_CX'),
        googleServiceAccount,
        tavilyApiKey: getApiSecret('TAVILY_API_KEY'),
    };
}

export function applyApiSecretsFromFields(fields: ApiSecretsFields): ApplyApiSecretsResult {
    const googleCx = fields.googleCx.trim();
    const googleServiceAccount = fields.googleServiceAccount.trim();
    const tavilyApiKey = fields.tavilyApiKey.trim();

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
        TAVILY_API_KEY: tavilyApiKey,
    });

    return { ok: true };
}

const SS_MISSING_COMMERCIAL = 'searchApiMissingCommercialPrompted';

export function hasGoogleSearchConfigured(): boolean {
    return Boolean(getApiSecret('GOOGLE_SERVICE_ACCOUNT')) && Boolean(getApiSecret('GOOGLE_CX'));
}

export function hasTavilySearchConfigured(): boolean {
    return Boolean(getApiSecret('TAVILY_API_KEY'));
}

function hasCommercialApiKeys(): boolean {
    return hasGoogleSearchConfigured() && hasTavilySearchConfigured();
}

function getElById(id: string): HTMLElement | null {
    const el = document.getElementById(id);
    return el instanceof HTMLElement ? el : null;
}

function getInputById(id: string): HTMLInputElement | null {
    const el = document.getElementById(id);
    return el instanceof HTMLInputElement ? el : null;
}

function getTextAreaById(id: string): HTMLTextAreaElement | null {
    const el = document.getElementById(id);
    return el instanceof HTMLTextAreaElement ? el : null;
}

function getDialogById(id: string): HTMLDialogElement | null {
    const el = document.getElementById(id);
    return el instanceof HTMLDialogElement ? el : null;
}

function loadApiSettingsFields() {
    const f = getApiSecretsFields();
    const cx = getInputById('api-settings-google-cx');
    const sa = getTextAreaById('api-settings-google-sa');
    const tavily = getInputById('api-settings-tavily-key');
    if (cx) cx.value = f.googleCx;
    if (sa) sa.value = f.googleServiceAccount;
    if (tavily) tavily.value = f.tavilyApiKey;
}

function openApiSettingsDialog(contextMessage?: string) {
    const dialog = getDialogById('api-settings-dialog');
    const contextEl = getElById('api-settings-context');
    const errEl = getElById('api-settings-json-error');
    if (!dialog || dialog.open) return;
    if (errEl) {
        errEl.textContent = '';
        errEl.hidden = true;
    }
    if (contextEl) {
        if (contextMessage) {
            contextEl.textContent = contextMessage;
            contextEl.hidden = false;
        } else {
            contextEl.textContent = '';
            contextEl.hidden = true;
        }
    }
    loadApiSettingsFields();
    dialog.showModal();
}

function maybeNotifyMissingCommercialKeys() {
    if (hasCommercialApiKeys()) return;
    if (sessionStorage.getItem(SS_MISSING_COMMERCIAL) === '1') return;
    sessionStorage.setItem(SS_MISSING_COMMERCIAL, '1');
    openApiSettingsDialog(
        'Add Google Custom Search credentials (cx + service account JSON) and a Tavily API key for commercial results. Brave, Marginalia, and Groq use Vercel environment variables (BRAVE_API_KEY, MARGINALIA_API_KEY, GROQ_API_KEY).'
    );
}

function setupApiSettingsPanel() {
    const dialog = getDialogById('api-settings-dialog');
    const cxField = getInputById('api-settings-google-cx');
    const saField = getTextAreaById('api-settings-google-sa');
    const tavilyField = getInputById('api-settings-tavily-key');
    const errEl = getElById('api-settings-json-error');
    const closeBtn = getElById('api-settings-close');
    const saveBtn = getElById('api-settings-save');
    const clearGoogleBtn = getElById('api-settings-clear-google-token');
    if (!dialog || !cxField || !saField || !closeBtn || !saveBtn) return;
    closeBtn.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
    });
    saveBtn.addEventListener('click', () => {
        const beforeSa = getApiSecret('GOOGLE_SERVICE_ACCOUNT');
        const beforeCx = getApiSecret('GOOGLE_CX');
        const beforeTavily = getApiSecret('TAVILY_API_KEY');
        const result = applyApiSecretsFromFields({
            googleCx: cxField.value,
            googleServiceAccount: saField.value,
            tavilyApiKey: tavilyField?.value ?? '',
        });
        if (result.ok === false) {
            if (errEl) {
                errEl.textContent = result.error;
                errEl.hidden = false;
            }
            return;
        }
        if (errEl) {
            errEl.textContent = '';
            errEl.hidden = true;
        }
        if (getApiSecret('GOOGLE_SERVICE_ACCOUNT') !== beforeSa || getApiSecret('GOOGLE_CX') !== beforeCx) {
            clearGoogleClientCaches();
        }
        void invalidateGoogleSearchCache();
        if (getApiSecret('TAVILY_API_KEY') !== beforeTavily) {
            void invalidateTavilySearchCache();
        }
        if (hasTavilySearchConfigured()) {
            primeTavilyConnection();
        }
        sessionStorage.removeItem(SS_MISSING_COMMERCIAL);
        dialog.close();
    });
    clearGoogleBtn?.addEventListener('click', () => {
        clearGoogleClientCaches();
        void invalidateGoogleSearchCache();
    });
}

export const apiSettings = {
    setupApiSettingsPanel,
    maybeNotifyMissingCommercialKeys,
    openApiSettingsDialog,
};
