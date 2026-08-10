# Agent learnings

## Struggle / Resolution

### Node ≥25 `localStorage` breaks Vitest + jsdom
- **Struggle:** On Node 25+, native Web Storage shadows jsdom. Bare `localStorage.clear()` throws (`undefined`), and `api-keys` tests fail. Top-level `test.execArgv` is Vitest 4-only.
- **Resolution:** Use `pool: 'forks'` + `poolOptions.forks.execArgv: ['--no-webstorage']` (gate on `nodeMajor >= 25`). Optionally `environmentOptions.jsdom.url: 'http://localhost/'` for opaque-origin SecurityError. `NODE_OPTIONS=--no-webstorage` also works as a fallback.

### Google Cache Storage in jsdom
- **Struggle:** jsdom has no `caches` API; `createCachedGoogleSearchGet` needs hit/miss/expiry coverage.
- **Resolution:** Stub `caches` with an in-memory Map keyed by request URL; set `X-Search-Cache-Expires` via fake timers for expiry. Seed `localStorage` OAuth token to skip JWT/`crypto.subtle` when testing CSE fetch.
