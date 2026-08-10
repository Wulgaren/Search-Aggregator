# Broad Vitest coverage plan

Environment: Vitest + jsdom. Run: `npm test`.

Colocate as `*.test.ts` next to sources (`src/…`, `api/…`). Prefer testing exported functions/factories; mock `fetch`, timers, and deps interfaces. Do not load `src/script.ts` as a suite entry (side-effect boot). Do not change production APIs unless a tiny export is required for testability—prefer dependency injection already on factories.

## Workstreams (subagent chunks)

### A — Query bangs + API keys
- Files: `src/query-bangs.ts`, `src/api-keys.ts`
- Cases: detectBang; strip `!g`; resolve redirect vs search; `__DISABLE_GOOGLE_BANG__` paths; localStorage get/set/clear for keys; invalid JSON handling

### B — Images slider states
- File: `src/images.ts`
- Cases: page-1 skeleton tiles; empty → `No images`; hard fail → error status; success renders thumbs; dedupe by full URL; request-id race (stale response ignored); pagination append; reset hides section

### C — AI panel streaming
- File: `src/ai.ts`
- Cases: opens panel + loading; streams content into answer; error keeps panel + error UI; abort closes cleanly; sources footer when citations present; toggleWhenLoading false aborts in-flight instead of close

### D — Infobox
- File: `src/infobox.ts`
- Cases: hide when no data; render title/desc/links; cast row when present; image error → no-image fallback; stale request ignored; reset

### E — Search results / merge / skeletons
- File: `src/search-results.ts`
- Cases: startSearch shows skeletons; error/empty states; commercial vs noncommercial render; merged mobile path if testable; infinite-scroll page bump mocked via deps; google correction callback

### F — Client fetch / Google browser / early fetch
- Files: `src/search-fetch.ts`, `src/google-search.ts`, `src/early-client-fetch.ts`
- Cases: cache hit/miss/expiry if present; apiFetch behavior; google CSE URL/params with mocked token; early-fetch bootstrap registers promises without throwing

### G — Edge API libs
- Files: `api/lib/search-route.ts`, `api/lib/google-search.ts` (+ thin tests around `api/search.ts` / `api/ai.ts` handlers if exportable)
- Cases: missing `q` → 400; source routing; google token/cache helpers with mocked `fetch`/`env`; graceful empty when Google unset; AI handler rejects bad body (mock Groq)

## Conventions
- `describe`/`it` from `vitest`; assert with `expect`
- Shared DOM fixtures in test file or tiny helper—no new prod modules unless needed
- Keep tests deterministic: fake timers for delayed Brave images (2s)
- After each stream: `npm test` green for that folder
