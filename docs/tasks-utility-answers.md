# Tasks for #1: Utility intent detector

Parent issue: #1  
Parent PRD: `docs/prd-utility-answers.md`

## Tasks

### 1. Add `detectUtilityIntent` module + types

**Type**: WRITE  
**Output**: `src/utility-intent.ts` (and types in `src/types.ts` if needed) exporting a pure detector and result union  
**Depends on**: none

Implement classification for currency, translate, timezone (country only), and keyword-empty kinds. Follow the pure-parse style of `src/query-bangs.ts`. City time queries must return none. Prefer shared normalization helpers for currency codes and country names used later by Issues 3–4.

---

### 2. Vitest coverage for intent detector

**Type**: TEST  
**Output**: `src/utility-intent.test.ts` passing under `npm test`  
**Depends on**: 1

Cover PRD examples: currency patterns + common phrasings, translate phrasings, country timezone + multi-zone country still timezone, `time in tokyo` → none, bare keywords, unrelated queries → none.

---

# Tasks for #2: Utility card shell + edge stub

Parent issue: #2  
Parent PRD: `docs/prd-utility-answers.md`

## Tasks

### 1. HTML mount + CSS panel

**Type**: WRITE  
**Output**: `#utility-answer` (or agreed id) in `index.html` / built public HTML path used by the app; styles in `src/style.css` matching infobox/AI panel  
**Depends on**: none

Place the mount above results near `#infobox`. Reuse panel tokens/gradient/accent bar; do not invent a new card system.

---

### 2. Types + `createUtilityAnswer` factory stub

**Type**: WRITE  
**Output**: factory in `src/utility-answer.ts` with `reset`, empty-kind render, error+examples render; element/deps types in `src/types.ts`  
**Depends on**: 1

Mirror `src/infobox.ts` patterns (request-id race guard structure ok even if fetch is stubbed). No real provider calls.

---

### 3. Edge `source=utility` stub + wire reset in search

**Type**: WRITE  
**Output**: branch in `api/lib/search-route.ts` for `source=utility` returning stable stub/error JSON; `performSearch` resets utility card; `vercel.json` unchanged unless new entry file is required  
**Depends on**: 2

Keep handlers thin; real Frankfurter/MyMemory/timezone logic belongs in Issues 3–5.

---

### 4. Tests for shell + stub route

**Type**: TEST  
**Output**: `src/utility-answer.test.ts` + cases in `api/lib/search-route.test.ts` (or dedicated utility test) passing  
**Depends on**: 2, 3

Assert reset/hide, error+examples UI, and stub JSON from `aggregateEdgeRequest`.

---
