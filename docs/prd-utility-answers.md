# PRD: Utility answers (translate, timezone, currency)

## Problem Statement

Searchers often want a quick conversion or translation (e.g. currency amounts, time in another country, short text translation). Today the product only returns web results plus Wikipedia/images/AI. There is no first-class utility answer, so users leave the engine for a calculator or translator.

## Solution

When a query matches translate, timezone, or currency intent—or the keywords `language`, `timezone`, or `currency`—show an interactive utility card above the normal results. Web search still runs; Wikipedia may still show. The card is editable after the first answer. All third-party calls go through the edge proxy using free, no-key APIs only.

## User Stories

1. As a searcher, I want `100 usd to eur` to show a conversion card above results, so that I get the answer without leaving search.
2. As a searcher, I want common phrasings like `how much is 5 euros in dollars` to trigger currency conversion, so that I do not need a rigid syntax.
3. As a searcher, I want `translate hello to french` (and similar phrasings) to open a translation card, so that short phrases are translated in place.
4. As a searcher, I want `time in japan` / `what time is it in usa` to show country time(s), so that I can check the clock without another site.
5. As a searcher, I want multi-zone countries (e.g. USA) to list several major zones, so that one country query is still useful.
6. As a searcher, I want `time in tokyo` to behave like a normal search (no utility card), so that city queries are not falsely claimed as supported.
7. As a searcher, I want typing only `language`, `currency`, or `timezone` to open an empty interactive tool, so that keywords act as shortcuts.
8. As a searcher, I want the card to stay editable after a one-shot answer, so that I can change amount, currencies, languages, or country without a new search.
9. As a searcher, I want web results to still load under the card, so that I can continue researching.
10. As a searcher, I want the Wikipedia panel to still appear when relevant, so that utility answers do not kill knowledge panels.
11. As a searcher, I want empty-tool defaults from my browser locale, so that the first open feels local.
12. As a searcher, I want to pick both source and target languages for translate, so that behavior is predictable.
13. As a searcher, I want currency answers to show converted amount and rate (no as-of date, no API credit line), so that the card stays clean but informative.
14. As a searcher, I want fiat-only conversion, so that rates stay on free central-bank data.
15. As a searcher, I want a clear in-card error plus 1–2 example queries when the proxy/API fails, so that failure is understandable.
16. As a privacy-conscious user, I want the browser to talk only to this product’s edge for utilities, so that Frankfurter/MyMemory do not see my IP directly.
17. As a searcher, I want non-matching queries to look exactly as today, so that utilities never slow or clutter normal search.

## Implementation Decisions

- Trigger: natural intent + common phrasings; keyword shortcuts `language` | `currency` | `timezone` open empty tools.
- Family: one shared utility-answer UI with three kinds.
- Cost: free / no API keys only.
- Layout: utility card above results; search always continues; Wikipedia not suppressed.
- Detection: patterns + common phrasings; not aggressive false positives.
- Timezone: countries only; multi-zone countries show several major zones; no city support / no city alias map.
- Currency: fiat via Frankfurter (or equivalent free no-key ECB-style API); show amount + rate; no date; no attribution footer.
- Translate: MyMemory (or equivalent free no-key); user always selects source and target.
- Defaults: `navigator.language` / locale-derived currency and country when opening empty tools.
- Networking: Vercel edge proxy (same stack as existing `/api/search`); browser never calls utility providers directly.
- Routing preference: `GET /api/search?source=utility&kind=…` (or dedicated `/api/utility`) mirroring infobox `source=` pattern.
- Client: intent module (pure) + utility card component factory patterned on infobox; wire in `performSearch` and early fetch only when intent ≠ none.
- Failure: keep card visible; error copy + 1–2 examples.

## Module Design

- **Name**: Utility intent  
  **Responsibility**: Parse query into `none` | `currency` | `translate` | `timezone` | keyword-empty kinds with structured fields.  
  **Interface**: `detectUtilityIntent(q) → Intent | null`; pure; no I/O.  
  **Tested**: yes

- **Name**: Utility edge handlers  
  **Responsibility**: Proxy currency/translate/timezone requests; normalize JSON; map provider errors.  
  **Interface**: kind + params in → success payload or error shape; no browser CORS to third parties.  
  **Tested**: yes

- **Name**: Country timezone data  
  **Responsibility**: Country → list of major IANA zones + labels; resolve “time in {country}” names/aliases.  
  **Interface**: lookup by normalized country string; multi-zone lists for USA/etc.  
  **Tested**: yes

- **Name**: Utility answer UI  
  **Responsibility**: Mount card, render each kind, editable controls, error+examples, reset on new search.  
  **Interface**: factory with `reset`, `showEmpty(kind)`, `fetchFromIntent(intent)`, request-id race guard.  
  **Tested**: yes

- **Name**: Search integration  
  **Responsibility**: Call intent + utility alongside existing search/infobox/images; early-fetch when intent hits.  
  **Interface**: hooks in performSearch / early-client-fetch only.  
  **Tested**: yes (integration-style where practical)

## Testing Decisions

- Prefer pure unit tests for intent and country lookup (like `query-bangs.test.ts`).
- Edge handlers: call router with mocked `fetch` (like `search-route.test.ts`).
- UI factory: jsdom + mocked `apiFetch` / early fetch (like `infobox.test.ts`).
- Assert external behaviour: correct card kind, amounts/rates fields, multi-zone rows, error+examples, no card on city time queries / non-intent queries.

## Out of Scope

- City-based timezone (`time in tokyo`)
- Crypto currencies
- Paid translation (DeepL/Google)
- Visible API attribution
- As-of date on FX rates
- Replacing or suppressing Wikipedia when utility matches
- Utility results without running web search
- Historical FX charts
- Auto-detect source language for translate

## Open Questions

- None blocking v1. Provider hostnames may be swapped if a free endpoint dies; keep adapter boundaries.

## Further Notes

- Settled in design grill (2026-08-12): mix triggers; all three tools; free-only; card+search; empty keyword tools; editable; Wikipedia stays; common phrasings; edge proxy; countries+multi-zone; locale defaults; amount+rate; no credit line; countries-only time; both language pickers.
- Stack note: repo uses Vercel Edge (`api/*.ts`), not Netlify edge functions.
