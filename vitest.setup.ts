/**
 * Node 25+ can leave `localStorage` undefined (or block jsdom). Ensure Storage exists.
 */
function createMemoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        clear() {
            map.clear();
        },
        getItem(key: string) {
            return map.has(key) ? map.get(key)! : null;
        },
        key(index: number) {
            return [...map.keys()][index] ?? null;
        },
        removeItem(key: string) {
            map.delete(key);
        },
        setItem(key: string, value: string) {
            map.set(String(key), String(value));
        },
    };
}

function needsStoragePolyfill(storage: Storage | undefined): boolean {
    return storage == null || typeof storage.getItem !== 'function';
}

function installStorage(name: 'localStorage' | 'sessionStorage'): void {
    const current = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
    if (!needsStoragePolyfill(current)) return;
    const stub = createMemoryStorage();
    const target = typeof window !== 'undefined' ? window : globalThis;
    Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        value: stub,
        writable: true,
    });
    if (target !== globalThis) {
        Object.defineProperty(globalThis, name, {
            configurable: true,
            enumerable: true,
            value: stub,
            writable: true,
        });
    }
}

installStorage('localStorage');
installStorage('sessionStorage');
