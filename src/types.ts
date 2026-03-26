export type EarlyFetchKey = 'brave' | 'google' | 'marginalia' | 'images' | 'infobox';

export type EarlyFetchState = {
    query: string;
    google?: Promise<Response>;
    brave?: Promise<Response>;
    marginalia?: Promise<Response>;
    images?: Promise<Response>;
    infobox?: Promise<Response>;
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
    storeElementPositionBeforeContent: () => void;
    maintainMousePosition: () => void;
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

export type InfoboxData = {
    title: string;
    description: string;
    image?: string;
    imageFull?: string;
    url: string;
    links?: InfoboxLink[];
};

export type InfoboxElements = {
    infobox: HTMLElement;
    infoboxImage: HTMLImageElement;
    infoboxTitle: HTMLElement;
    infoboxDescription: HTMLElement;
    infoboxLinks: HTMLElement;
    infoboxSource: HTMLAnchorElement;
};

export type InfoboxDeps = {
    apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
    takeEarlyFetch: (key: 'infobox', query: string) => Promise<Response | null>;
    storeElementPositionBeforeContent: () => void;
    maintainMousePosition: () => void;
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
};

export type SearchApiResponse = {
    brave?: SourcePayload;
    google?: SourcePayload;
    marginalia?: SourcePayload;
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
    takeEarlyFetch: (key: 'brave' | 'google' | 'marginalia', query: string) => Promise<Response | null>;
    isMergedView: () => boolean;
    openApiSettingsDialog: (message?: string) => void;
};

export type StoredGoogleToken = { accessToken: string; expiresAtMs: number };
export type ApiSecretsFields = { googleCx: string; googleServiceAccount: string };
export type ApplyApiSecretsResult = { ok: true } | { ok: false; error: string };
export type ElementPositionBeforeContent = { element: Element; viewportTop: number };
export type MousePosition = { x: number | null; y: number | null; isInsideResults: boolean };

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

declare global {
    interface Window {
        __earlyFetch?: EarlyFetchState;
        scrollObservers?: Record<string, IntersectionObserver>;
        sentinels?: Record<string, HTMLElement>;
    }
}
