# Search Engine Aggregator

A modern, privacy-focused search engine that aggregates results from multiple sources, providing both commercial and non-commercial search results side-by-side.

## Features

- **Multi-Source Search**: Combines results from Brave Search, Google Custom Search, and Marginalia Search
- **Dual Column Layout**: Desktop view shows commercial and non-commercial results side-by-side
- **Responsive Design**: Merged interleaved view on mobile devices
- **Image Search**: Integrated image search with slider and preview functionality
- **Knowledge Panel**: Wikipedia infobox with entity information and external links
- **DDG Bang Support**: DuckDuckGo-style bang syntax (e.g., `!g`, `!yt`) redirects to unduck.link
- **AI Answer**: Groq-powered streaming answers (optional API key)
- **Infinite Scroll**: Automatic pagination for seamless browsing
- **Dark Theme**: Modern, minimal dark interface
- **Fast Performance**: Search and AI requests run in the browser bundle with optional Cache Storage for repeat queries

## Tech Stack

- **Frontend**: TypeScript (compiled with Bun), HTML, CSS — sources in `src/`, minified bundles `script.js` / `style.css` at repo root
- **Hosting**: [Vercel](https://vercel.com/) — static files plus Edge routes under `api/` (`vercel.json` for build and headers)
- **APIs**:
  - [Brave Search API](https://brave.com/search/api/)
  - [Google Custom Search API](https://developers.google.com/custom-search)
  - [Marginalia Search API](https://about.marginalia-search.com/article/api/) (`api2.marginalia-search.com`)
  - [Wikipedia API](https://www.mediawiki.org/wiki/API:Main_page)

## Setup

### Prerequisites

- [Bun](https://bun.sh/) (for installing deps and building the client)
- Brave Search API key ([Get one here](https://brave.com/search/api/))
- Google Custom Search Engine ID and Service Account (optional, for Google results)
  - Create a [Custom Search Engine](https://programmablesearchengine.google.com/)
  - Create a [Service Account](https://console.cloud.google.com/iam-admin/serviceaccounts) with Custom Search API enabled

### Installation

1. Clone this repository:

```bash
git clone <repository-url>
cd Search
```

2. Install dependencies and build the client (TypeScript + minified CSS):

```bash
bun install
bun run build
```

This writes `script.js` and `style.css` at the project root. Vercel runs the same steps via `vercel.json`.

3. Deploy to Vercel:
   - Import the repo in the Vercel dashboard (or use `vercel link` / `vercel deploy`)
   - Set environment variables (see below)

### API keys (browser)

Google Custom Search credentials (`cx`, service account JSON) are stored in **localStorage** via **API configuration** in the app—not as Vercel secrets.

Optional keys you can also store in the browser: `braveApiKey`, `groqApiKey` (see `src/api-keys.ts`). Production setups usually rely on **server-side** env vars for Brave, Marginalia, and Groq so keys stay off the client.

**Security note:** Treat browser-stored credentials as a personal or trusted-user setup, not a hidden server-side secret store.

## Project Structure

```
.
├── index.html              # Main HTML file
├── script.js               # Built client bundle (run `bun run build`)
├── style.css               # Minified CSS (run `bun run build`)
├── api/
│   ├── search.ts           # Vercel Edge — GET /api/search
│   ├── ai.ts               # Vercel Edge — POST /api/ai
│   └── lib/search-route.ts # Shared Edge handler logic
├── src/
│   ├── script.ts           # UI, search state, API settings dialog
│   ├── api-keys.ts         # localStorage keys + JSON config helpers
│   ├── google-search.ts    # browser-side Google Custom Search handler
│   ├── search-cache.ts     # Cache Storage wrapper for GET /api/search JSON
│   ├── style.css           # Stylesheet source
│   └── global.d.ts         # DOM / window typings
├── scripts/
│   └── build.ts            # Bun build (JS + CSS minify)
├── vercel.json             # Vercel build + headers
└── README.md               # This file
```

## Configuration

### Vercel environment variables

Set these in **Project → Settings → Environment Variables** so `/api/search` and `/api/ai` work:

| Variable | Purpose |
| -------- | ------- |
| `BRAVE_API_KEY` | Brave web + image search |
| `MARGINALIA_API_KEY` | [Marginalia Search API v2](https://about.marginalia-search.com/article/api/) (`API-Key` header). If unset, the handler falls back to the sample key `public` (shared rate limit). |
| `GROQ_API_KEY` | Optional streaming AI answers |

`vercel.json` configures:

- Install/build commands and output directory
- Security headers (X-Frame-Options, etc.)
- Cache headers for static assets

## Usage

### Search Syntax

- **Regular search**: Just type your query and press Enter
- **DDG Bangs**: Use `!g`, `!yt`, `!w` etc. at the start or end of your query
  - Example: `!g javascript tutorial` or `javascript tutorial !g`
- **Keyboard shortcuts**:
  - `/` - Focus search input
  - `Esc` - Close image preview
  - Arrow keys - Navigate images in preview mode

### Result Sources

- **Commercial**: Results from Google and Brave Search
- **Non-commercial**: Results from Marginalia Search (indie web, personal sites, blogs)

## Development

### Local Development

1. Install dependencies and build the client (or use `bun run watch` to rebuild on save):

```bash
bun install
bun run build
```

2. Serve the repo root with any static server (e.g. `bunx serve .`) and open `index.html`. Same-origin `/api/*` routes require `vercel dev` or a deployed preview.

Use `bun run typecheck` for TypeScript-only checks. Use `bun run watch` to rebuild `script.js` and `style.css` when editing `src/`.

### Code Structure

- **UI** (`src/script.ts` → `script.js`): DOM, search state, infinite scroll, image previews, API settings
- **Search + AI** (`api/search.ts`, `api/ai.ts`, `api/lib/search-route.ts`): Vercel Edge handlers for same-origin `/api` paths
- **Styles** (`src/style.css` → minified `style.css`)

## API Endpoints (in-bundle)

The app issues `fetch()` calls to same-origin paths handled by Vercel Edge:

### `/api/search`

**Query Parameters:**

- `q` (required) - Search query
- `page` (optional) - Page number (default: 1)
- `source` (optional) - Filter by source: `brave`, `google`, `marginalia`, `images`, `infobox`
- `imageSource` (optional) - For image search: `google`, `brave`, or both

**Example:**

```
GET /api/search?q=javascript&page=1&source=brave
```

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Privacy

- No tracking or analytics
- No cookies
- Search queries are sent from the browser to third-party search APIs
- Optional response caching (Cache Storage for repeat GET `/api/search` queries; configurable TTL in code)

## Third-Party Services

### Marginalia Search

The Edge handler calls [`api2.marginalia-search.com`](https://about.marginalia-search.com/article/api/) with the `API-Key` header (from `MARGINALIA_API_KEY`, or the documented sample key `public` if unset). Response data is licensed [CC-BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) per Marginalia.

- **Set `MARGINALIA_API_KEY`**: Dedicated rate limit vs. the overloaded `public` key
- **Respect rate limits**: Use caching where appropriate
- **Attribution**: Marginalia results are labeled in the UI

### unduck.link

This project redirects DDG bang queries to [unduck.link](https://unduck.link), which is a public service for handling DuckDuckGo-style bang syntax. This is a client-side redirect (users are sent directly to unduck.link), so no API calls are made from your server.

## Legal & Ethical Considerations

- **Attribution**: All search sources are properly attributed in the UI
- **Terms of Service**: Ensure you comply with:
  - Brave Search API terms
  - Google Custom Search API terms
  - Marginalia Search usage (check their website for any terms)
- **Rate Limiting**: Implement appropriate caching and rate limiting to avoid overwhelming third-party services

## License

This project is open source. Feel free to use, modify, and distribute as needed.

## Acknowledgments

- [Brave Search](https://brave.com/search/) - Search API
- [Google Custom Search](https://developers.google.com/custom-search) - Search API
- [Marginalia Search](https://search.marginalia.nu/) - Non-commercial search
- [Wikipedia](https://www.wikipedia.org/) - Knowledge panel data
- [Vercel](https://vercel.com/) - Hosting

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
