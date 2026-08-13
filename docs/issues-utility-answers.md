# Issues: Utility answers

Parent PRD: `docs/prd-utility-answers.md`

---

## Issue 1: Utility intent detector

**Type**: AFK  
**Blocked by**: None — can start immediately

### Parent PRD

`docs/prd-utility-answers.md`

### What to build

Pure client/shared module that classifies a query into currency, translate, timezone (country), or keyword-empty (`language` | `currency` | `timezone`), or none. Cover strict patterns and common phrasings from the PRD. City time queries must return none. No network I/O.

### How to verify

- **Automated**: Vitest cases for each kind, keyword-only, city time → none, unrelated query → none, multi-zone country still detected as timezone intent with country id.
- **Manual**: N/A (pure module).

### Acceptance criteria

- [ ] Given `100 usd to eur`, when detected, then kind is currency with amount/from/to.
- [ ] Given `how much is 5 euros in dollars`, when detected, then currency intent.
- [ ] Given `translate hello to french` (and similar), then translate intent with text + langs when present.
- [ ] Given `time in japan` / `what time is it in usa`, then timezone intent with country.
- [ ] Given `time in tokyo`, then none.
- [ ] Given exact `language` / `currency` / `timezone`, then empty-tool intent for that kind.
- [ ] Given normal web queries, then none.

### User stories addressed

- User stories 1–8, 17 (detection side)

---

## Issue 2: Utility card shell + edge `source=utility` stub

**Type**: AFK  
**Blocked by**: None — can start immediately (parallel with Issue 1)

### Parent PRD

`docs/prd-utility-answers.md`

### What to build

End-to-end skeleton: HTML mount point above results (near infobox), CSS panel matching infobox/AI, types + `createUtilityAnswer` factory with `reset` / empty-kind render / error+examples state, and edge branch `source=utility` returning a typed stub/error JSON. Wire reset into `performSearch` but do not call real providers yet. No Frankfurter/MyMemory/timezone logic.

### How to verify

- **Manual**: Force-show empty currency/translate/timezone via temporary test hook or intent stub; confirm layout above results; trigger error state UI.
- **Automated**: Factory tests for reset, empty render, error+examples; router test for `source=utility` stub response.

### Acceptance criteria

- [ ] Given a new search, when performSearch runs, then utility card resets/hides if no intent wiring yet (safe no-op).
- [ ] Given error payload, then card shows message + 1–2 example queries.
- [ ] Given `source=utility` without provider impl, then edge returns stable JSON shape (stub or explicit not-implemented error).
- [ ] Card chrome matches existing panel aesthetics (not a new card system).

### User stories addressed

- User stories 9, 10 (layout coexistence hooks), 15 (error UI)

---

## Issue 3: Currency conversion vertical slice

**Type**: AFK  
**Blocked by**: Issues 1, 2

### Parent PRD

`docs/prd-utility-answers.md`

### What to build

Full currency path: intent → edge proxies Frankfurter → card shows amount + rate, editable fields, locale defaults for empty `currency` keyword, search+infobox still run. Browser never calls Frankfurter directly.

### How to verify

- **Manual**: Search `100 usd to eur` and `currency`; edit amount; confirm results underneath.
- **Automated**: Edge handler with mocked Frankfurter; intent→UI happy path + failure→error+examples.

### Acceptance criteria

- [ ] Given currency intent, when fetch succeeds, then card shows converted amount and rate (no date, no attribution).
- [ ] Given provider failure, then error + examples in card.
- [ ] Given bare `currency`, then empty editable tool with locale-ish defaults.
- [ ] Fiat only; web search still runs.

### User stories addressed

- User stories 1, 2, 7–9, 11, 13–16

---

## Issue 4: Country timezone vertical slice

**Type**: AFK  
**Blocked by**: Issues 1, 2

### Parent PRD

`docs/prd-utility-answers.md`

### What to build

Country→major IANA zones data; edge computes local times (Intl/IANA, no third-party time API required); card lists one or many zones; empty `timezone` keyword opens country picker; city queries never activate. Editable country after first answer.

### How to verify

- **Manual**: `time in japan`, `time in usa`, `timezone`; confirm `time in tokyo` has no card.
- **Automated**: Country lookup multi-zone; edge/timezone unit tests with fixed Instant if needed.

### Acceptance criteria

- [ ] Given single-zone country, then one time row.
- [ ] Given multi-zone country (USA), then several major zones.
- [ ] Given city time query, then no utility card.
- [ ] Given bare `timezone`, then empty country tool with locale default.

### User stories addressed

- User stories 4–8, 11, 15–17

---

## Issue 5: Translate vertical slice

**Type**: AFK  
**Blocked by**: Issues 1, 2

### Parent PRD

`docs/prd-utility-answers.md`

### What to build

Translate path via edge→MyMemory; both language pickers required; empty `language` keyword opens empty tool; editable after answer; failure shows error+examples. No source auto-detect.

### How to verify

- **Manual**: `translate hello to french`, bare `language`; change langs/text in card.
- **Automated**: Mock MyMemory in edge tests; UI render/edit tests.

### Acceptance criteria

- [ ] Given translate intent, when success, then translated text shown; source+target both user-selectable.
- [ ] Given bare `language`, then empty tool with locale-prefilled langs.
- [ ] Given MyMemory failure, then error + examples.
- [ ] Browser does not call MyMemory directly.

### User stories addressed

- User stories 3, 7–9, 11–12, 15–16

---

## Issue 6: Early fetch + search integration polish

**Type**: AFK  
**Blocked by**: Issues 3, 4, 5 (at least one; complete when all three land)

### Parent PRD

`docs/prd-utility-answers.md`

### What to build

Early-client-fetch starts utility request only when intent ≠ none; `performSearch` consumes early fetch; ensure Wikipedia/images/AI behavior unchanged; no extra utility request on normal queries.

### How to verify

- **Manual**: Hard-refresh with `?q=100+usd+to+eur` vs `?q=cats`; network panel shows utility call only for intent.
- **Automated**: early-fetch tests for intent gating; regression that non-intent skips utility key.

### Acceptance criteria

- [ ] Given intent query on load, then utility uses early fetch when present.
- [ ] Given non-intent query, then no utility early fetch.
- [ ] Infobox/images/AI paths unchanged for normal queries.

### User stories addressed

- User stories 9, 10, 17

---
