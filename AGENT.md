# Agent learnings

## Struggle / Resolution

### Node ≥25 `localStorage` breaks Vitest + jsdom
- **Struggle:** On Node 25+, native Web Storage shadows jsdom. Bare `localStorage.clear()` throws (`undefined`), and `api-keys` tests fail. Top-level `test.execArgv` is Vitest 4-only.
- **Resolution:** Use `pool: 'forks'` + `poolOptions.forks.execArgv: ['--no-webstorage']` (gate on `nodeMajor >= 25`). Optionally `environmentOptions.jsdom.url: 'http://localhost/'` for opaque-origin SecurityError. `NODE_OPTIONS=--no-webstorage` also works as a fallback.

### Google Cache Storage in jsdom
- **Struggle:** (Historical) Client Google CSE used Cache Storage; jsdom has no `caches` API.
- **Resolution:** Google CSE runs on Vercel Node `iad1` (`api/google.ts` + `api/lib/google-search.ts`); Edge `/api/search` proxies web/images. Client Cache API path removed. Tests mock `fetch` (`/api/google` from Edge; googleapis from Node lib).

### Edge vs Node Google CSE
- **Struggle:** Regional Node Google without pulling OAuth into the Edge bundle or changing client URLs.
- **Resolution:** Edge keeps `/api/search?source=google|images`; Node owns CSE at `/api/google?kind=web|images` with `preferredRegion: 'iad1'`. Image merge helpers live in `api/lib/image-merge.ts` so Edge does not import OAuth.

### ESLint `assertionStyle: never` + `noPropertyAccessFromIndexSignature`
- **Struggle:** Replacing `as` casts with `Record<string, unknown>` narrowing still fails `tsc` on `obj.prop` (index signature) and `exactOptionalPropertyTypes` when assigning `T | undefined` into optional fields.
- **Resolution:** Use `src/unknown.ts` helpers (`isRecord`, `readString`/`read*` with bracket access). Build optionals by mutating a typed object only when the value is defined (or spread conditionals). DOM: `instanceof` / ctor checks instead of `as T`.

### `Array.isArray(unknown)` → `any[]` (unsafe assignment)
- **Struggle:** After `Array.isArray(x)` on `unknown`, TS often narrows to `any[]`, so indexing/assigning trips `@typescript-eslint/no-unsafe-assignment`.
- **Resolution:** Prefer `asArray()` from `unknown.ts` (returns `unknown[] | undefined`). Same for `JSON.parse` / `response.json()`: bind as `unknown`, then narrow with helpers — never `as T`.

### Edge `api/` + unknown helpers
- **Struggle:** Vercel edge `includeFiles` is `api/lib/**`; sharing `../../src/unknown.ts` is awkward for deploy tracing.
- **Resolution:** Keep a small local `api/lib/unknown.ts` mirror of `src/unknown.ts` for edge handlers.
