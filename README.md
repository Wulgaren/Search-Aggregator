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
- **Hosting**: Netlify (static build from `netlify.toml`; no server-side search API)
- **APIs**:
  - [Brave Search API](https://brave.com/search/api/)
  - [Google Custom Search API](https://developers.google.com/custom-search)
  - [Marginalia Search API](https://search.marginalia.nu/)
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
This writes `script.js` and `style.css` at the project root. Netlify runs the same steps via `netlify.toml`.

3. Deploy to Netlify (or any static host):
   - Connect your repository to Netlify
   - Netlify will automatically detect the build settings from `netlify.toml`
   - The site will deploy automatically

### API keys (browser)

API keys and Google credentials are **not** set as Netlify environment variables for search. After opening the app, use **API configuration** (JSON in `localStorage`) to add:

- `braveApiKey`, `googleCx`, `googleServiceAccount` (object or JSON string), `groqApiKey` (optional, for AI answers)

**Security note:** credentials live in the user’s browser. Treat this as a personal or trusted-user setup, not a hidden server-side secret store.

## Project Structure

```
.
├── index.html              # Main HTML file
├── script.js               # Built client bundle (run `bun run build`)
├── style.css               # Minified CSS (run `bun run build`)
├── src/
│   ├── script.ts           # UI, search state, API settings dialog
│   ├── client-search.ts    # /api/search + /api/ai handlers (bundled, fetch-based)
│   ├── api-keys.ts         # localStorage keys + JSON config helpers
│   ├── search-cache.ts     # Cache Storage wrapper for GET /api/search
│   ├── style.css           # Stylesheet source
│   └── global.d.ts         # DOM / window typings
├── scripts/
│   └── build.ts            # Bun build (JS + CSS minify)
├── netlify.toml            # Netlify configuration (build + headers)
└── README.md               # This file
```

## Configuration

The `netlify.toml` file configures:

- Build command and publish directory
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

2. Serve the repo root with any static server (e.g. `npx serve .` or your editor’s live server) and open `index.html`.

Use `bun run typecheck` for TypeScript-only checks. Use `bun run watch` to rebuild `script.js` and `style.css` when editing `src/`.

### Code Structure

- **UI** (`src/script.ts` → `script.js`): DOM, search state, infinite scroll, image previews, API settings
- **Search + AI** (`src/client-search.ts`): request handlers invoked from the bundle (same-origin “/api” paths)
- **Styles** (`src/style.css` → minified `style.css`)

## API Endpoints (in-bundle)

The app issues `fetch()` calls to same-origin paths handled inside `client-search.ts`:

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

This project uses the [Marginalia Search public API](https://api.marginalia.nu/public/search/). The API is publicly available and doesn't require authentication. However, please:

- **Respect rate limits**: The service may have rate limits; implement appropriate caching
- **Add attribution**: Marginalia results are clearly labeled in the UI
- **Monitor usage**: If you expect high traffic, consider contacting the Marginalia maintainers

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
- [Netlify](https://www.netlify.com/) - Hosting

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
