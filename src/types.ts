export type EarlyFetchKey = 'brave' | 'google' | 'tavily' | 'marginalia' | 'wiby' | 'images' | 'infobox' | 'utility';

export type EarlyFetchState = {
    query: string;
    google?: Promise<Response>;
    brave?: Promise<Response>;
    tavily?: Promise<Response>;
    marginalia?: Promise<Response>;
    wiby?: Promise<Response>;
    images?: Promise<Response>;
    infobox?: Promise<Response>;
    utility?: Promise<Response>;
};

export type AIElements = {
    aiBtn: HTMLButtonElement;
    aiPanel: HTMLElement;
    aiPanelClose: HTMLButtonElement;
    aiLoading: HTMLElement;
    aiAnswer: HTMLElement;
    aiPanelFooter: HTMLElement;
    aiSources: HTMLElement;
};

export type AIDeps = {
    apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
    escapeHtml: (text: string) => string;
};

export type AIState = {
    loading: boolean;
    abortController: AbortController | null;
};

export type AISource = {
    url: string;
    title: string;
};

export type AIStreamChunk = {
    content?: string;
    sources?: AISource[];
    error?: string;
};

export type ImageElements = {
    imageSection: HTMLElement;
    sliderTrack: HTMLElement;
    imagePreview: HTMLElement;
    previewImage: HTMLImageElement;
    previewInfo: HTMLElement;
    previewClose: HTMLButtonElement;
    previewOverlay: HTMLElement;
    previewPrev: HTMLButtonElement;
    previewNext: HTMLButtonElement;
    previewCounter: HTMLElement;
};

export type ImageDeps = {
    apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
    takeEarlyFetch: (key: 'images', query: string) => Promise<Response | null>;
    escapeHtml: (text: string) => string;
};

export type ImageItem = {
    thumbnail: string;
    full: string;
    title: string;
    sourceUrl?: string;
    sourceLinkText?: string;
    width?: number;
    height?: number;
    source?: string;
};

export type ImageState = {
    images: ImageItem[];
    loading: boolean;
    page: number;
    hasMore: boolean;
};

export type PreviewImage = {
    thumbnail: string;
    full: string;
    title: string;
    sourceUrl?: string;
    sourceLinkText?: string;
};

export type InfoboxLink = {
    url: string;
    icon?: string;
    name?: string;
};

export type InfoboxCastMember = {
    name: string;
    role?: string;
    image?: string;
    url: string;
};

export type InfoboxData = {
    title: string;
    description: string;
    image?: string;
    imageFull?: string;
    url: string;
    links?: InfoboxLink[];
    cast?: InfoboxCastMember[];
};

export type InfoboxElements = {
    infobox: HTMLElement;
    infoboxImage: HTMLImageElement;
    infoboxTitle: HTMLElement;
    infoboxDescription: HTMLElement;
    infoboxCast: HTMLElement;
    infoboxLinks: HTMLElement;
    infoboxSource: HTMLAnchorElement;
};

export type InfoboxDeps = {
    apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
    takeEarlyFetch: (key: 'infobox', query: string) => Promise<Response | null>;
    openImagePreview: (img: PreviewImage) => void;
};

export type InfoboxState = {
    data: InfoboxData | null;
    loading: boolean;
};

export type SearchResult = {
    title: string;
    url: string;
    displayUrl?: string;
    snippet?: string;
    source?: string;
};

export type SourcePayload = {
    error?: string;
    hasMore: boolean;
    results: SearchResult[];
    correctedQuery?: string;
    htmlCorrectedQuery?: string;
};

export type SearchApiResponse = {
    brave?: SourcePayload;
    google?: SourcePayload;
    tavily?: SourcePayload;
    marginalia?: SourcePayload;
    wiby?: SourcePayload;
};

export type SourceState = {
    page: number;
    hasMore: boolean;
    loading: boolean;
    results: SearchResult[];
    error: string | null;
};

export type MergedItem = {
    type: 'commercial' | 'noncommercial';
    result: SearchResult;
    urlKey: string;
};

export type SearchResultsElements = {
    commercialResults: HTMLElement;
    noncommercialResults: HTMLElement;
    mergedResults: HTMLElement;
    commercialCount: HTMLElement;
    noncommercialCount: HTMLElement;
};

export type SearchDeps = {
    apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
    takeEarlyFetch: (
        key: 'brave' | 'google' | 'tavily' | 'marginalia' | 'wiby',
        query: string
    ) => Promise<Response | null>;
    isMergedView: () => boolean;
    hasGoogleSearchConfigured: () => boolean;
    hasTavilySearchConfigured: () => boolean;
    openApiSettingsDialog: (message?: string) => void;
    onGoogleCorrection?: (query: string, correctedQuery: string) => void;
};

export type StoredGoogleToken = { accessToken: string; expiresAtMs: number };
export type ApiSecretsFields = { googleCx: string; googleServiceAccount: string; tavilyApiKey: string };
export type ApplyApiSecretsResult = { ok: true } | { ok: false; error: string };

export type ServiceAccountConfig = {
    client_email: string;
    private_key: string;
};
export type PartialServiceAccountConfig = {
    client_email?: string;
    private_key?: string;
};

export type OAuthTokenErrorData = { error_description?: string };
export type GoogleApiErrorData = { error?: { message?: string } };
export type GoogleWebItem = { title: string; link: string; displayLink: string; snippet?: string };
export type GoogleImageMeta = { thumbnailLink?: string; width?: number; height?: number; contextLink?: string };
export type GoogleImageItem = { title?: string; link?: string; image?: GoogleImageMeta };
export type GoogleImageCandidate = {
    thumbnail?: string;
    full?: string;
    title: string;
    sourceUrl?: string;
    width?: number;
    height?: number;
    source?: string;
};

export type SearchHandler = (request: Request) => Promise<Response>;

/** Utility card kinds (Issues 3–5). */
export type UtilityKind = 'currency' | 'translate' | 'timezone';

export type UtilityAnswerElements = {
    root: HTMLElement;
    title: HTMLElement;
    content: HTMLElement;
};

export type UtilityAnswerDeps = {
    apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
    takeEarlyFetch: (key: 'utility', query: string) => Promise<Response | null>;
};

/** Stable edge error / stub shape. */
export type UtilityStubPayload = {
    ok: false;
    error: string;
    examples: string[];
    kind?: UtilityKind | null;
};

export type UtilityErrorView = {
    message: string;
    examples: string[];
};

export type UtilityTranslateSuccessView = {
    text: string;
    from: string;
    to: string;
    translatedText: string;
};

/** Issue 3: currency success view (no as-of date / attribution). */
export type UtilityCurrencySuccessView = {
    amount: number;
    from: string;
    to: string;
    converted: number;
    rate: number;
};

export type UtilityTimezoneZoneView = {
    id: string;
    label: string;
    localTime: string;
    offset: string;
};

export type UtilityTimezoneSuccessView = {
    country: string;
    countryLabel: string;
    zones: UtilityTimezoneZoneView[];
};

declare global {
    interface Window {
        __earlyFetch?: EarlyFetchState;
        scrollObservers?: Record<string, IntersectionObserver>;
        sentinels?: Record<string, HTMLElement>;
    }
}
