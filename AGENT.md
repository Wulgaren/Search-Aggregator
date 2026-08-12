# Agent learnings

## Struggle / Resolution

### Node ≥25 `localStorage` breaks Vitest + jsdom
- **Struggle:** On Node 25+, native Web Storage shadows jsdom. Bare `localStorage.clear()` throws (`undefined`), and `api-keys` tests fail. Top-level `test.execArgv` is Vitest 4-only.
- **Resolution:** Use `pool: 'forks'` + `poolOptions.forks.execArgv: ['--no-webstorage']` (gate on `nodeMajor >= 25`). Optionally `environmentOptions.jsdom.url: 'http://localhost/'` for opaque-origin SecurityError. `NODE_OPTIONS=--no-webstorage` also works as a fallback.

### Google Cache Storage in jsdom
- **Struggle:** jsdom has no `caches` API; `createCachedGoogleSearchGet` needs hit/miss/expiry coverage.
- **Resolution:** Stub `caches` with an in-memory Map keyed by request URL; set `X-Search-Cache-Expires` via fake timers for expiry. Seed `localStorage` OAuth token to skip JWT/`crypto.subtle` when testing CSE fetch.

### ESLint `assertionStyle: never` + `noPropertyAccessFromIndexSignature`
- **Struggle:** Replacing `as` casts with `Record<string, unknown>` narrowing still fails `tsc` on `obj.prop` (index signature) and `exactOptionalPropertyTypes` when assigning `T | undefined` into optional fields.
- **Resolution:** Use `src/unknown.ts` helpers (`isRecord`, `readString`/`read*` with bracket access). Build optionals by mutating a typed object only when the value is defined (or spread conditionals). DOM: `instanceof` / ctor checks instead of `as T`.

### `Array.isArray(unknown)` → `any[]` (unsafe assignment)
- **Struggle:** After `Array.isArray(x)` on `unknown`, TS often narrows to `any[]`, so indexing/assigning trips `@typescript-eslint/no-unsafe-assignment`.
- **Resolution:** Prefer `asArray()` from `unknown.ts` (returns `unknown[] | undefined`). Same for `JSON.parse` / `response.json()`: bind as `unknown`, then narrow with helpers — never `as T`.

### Parallel utility vertical slices (currency / timezone / translate)
- **Struggle:** Three agents edit `search-route.ts` + `utility-answer.ts` at once; full-file Write overwrites sibling kind UI.
- **Resolution:** Keep provider logic in dedicated modules (`api/lib/utility-*.ts`). In shared files use clear `kind ===` branches only. Prefer StrReplace / merge over Write for `utility-answer.ts`. Recover sibling UI from agent transcripts if stomped.

### Parallel agents overwrite shared utility client
- **Struggle:** Issues 3–5 all edit `src/utility-answer.ts` / `search-route.ts`; a later agent can wipe another kind’s UI.
- **Resolution:** Prefer dedicated `api/lib/utility-*.ts` handlers; in shared files use clear `--- Issue N ---` section comments and re-merge by kind (`currency` / `translate` / `timezone`) instead of rewriting the whole factory.

### `delete window.__earlyFetch` mid-test → `utility` on `never`
- **Struggle:** After `delete window.__earlyFetch`, CFA keeps the property narrowed; a later `bootstrapEarlyFetch()` side-effect is invisible to `tsc`, so `window.__earlyFetch?.utility` errors (`Property 'utility' does not exist on type 'never'`).
- **Resolution:** One scenario per `it` (rely on `beforeEach` cleanup) instead of delete + re-bootstrap in the same test.
