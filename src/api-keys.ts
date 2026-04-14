/** Google Custom Search credentials + OAuth token cache (localStorage). */
import { clearGoogleClientCaches, invalidateGoogleSearchCache } from './google-search';
import type { ApiSecretsFields, ApplyApiSecretsResult, StoredGoogleToken } from './types';

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

export function getApiSecretsFields(): ApiSecretsFields {
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

export function applyApiSecretsFromFields(fields: ApiSecretsFields): ApplyApiSecretsResult {
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

const SS_MISSING_COMMERCIAL = 'searchApiMissingCommercialPrompted';

function hasCommercialApiKeys(): boolean {
    return Boolean(getApiSecret('GOOGLE_SERVICE_ACCOUNT')) && Boolean(getApiSecret('GOOGLE_CX'));
}

function loadApiSettingsFields() {
    const f = getApiSecretsFields();
    const cx = document.getElementById('api-settings-google-cx') as HTMLInputElement | null;
    const sa = document.getElementById('api-settings-google-sa') as HTMLTextAreaElement | null;
    if (cx) cx.value = f.googleCx;
    if (sa) sa.value = f.googleServiceAccount;
}

function openApiSettingsDialog(contextMessage?: string) {
    const dialog = document.getElementById('api-settings-dialog') as HTMLDialogElement | null;
    const contextEl = document.getElementById('api-settings-context');
    const errEl = document.getElementById('api-settings-json-error');
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
    // Google Custom Search keys are optional: Brave + Marginalia work without them (e.g. Netlify previews).
    // Avoid auto-opening the settings dialog on every load.
}

function setupApiSettingsPanel() {
    const dialog = document.getElementById('api-settings-dialog') as HTMLDialogElement | null;
    const cxField = document.getElementById('api-settings-google-cx') as HTMLInputElement | null;
    const saField = document.getElementById('api-settings-google-sa') as HTMLTextAreaElement | null;
    const errEl = document.getElementById('api-settings-json-error');
    const closeBtn = document.getElementById('api-settings-close');
    const saveBtn = document.getElementById('api-settings-save');
    const clearGoogleBtn = document.getElementById('api-settings-clear-google-token');
    if (!dialog || !cxField || !saField || !closeBtn || !saveBtn) return;
    closeBtn.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
    });
    saveBtn.addEventListener('click', () => {
        const beforeSa = getApiSecret('GOOGLE_SERVICE_ACCOUNT');
        const beforeCx = getApiSecret('GOOGLE_CX');
        const result = applyApiSecretsFromFields({ googleCx: cxField.value, googleServiceAccount: saField.value });
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
