/** Augment globals used across the client bundle */

interface Window {
  __earlyFetch?: {
    query: string;
    google?: Promise<Response>;
    brave?: Promise<Response>;
    marginalia?: Promise<Response>;
    images?: Promise<Response>;
    infobox?: Promise<Response>;
  };
  scrollObservers?: Record<string, IntersectionObserver>;
  sentinels?: Record<string, HTMLElement>;
}
