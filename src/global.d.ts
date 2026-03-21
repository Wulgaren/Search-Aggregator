/** Augment globals used across the client bundle */

interface Window {
  __earlyFetch?: {
    query: string;
    batch?: Promise<Response>;
  };
  scrollObservers?: Record<string, IntersectionObserver>;
  sentinels?: Record<string, HTMLElement>;
}
