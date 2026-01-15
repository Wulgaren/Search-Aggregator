# Search Engine Aggregator

A modern, privacy-focused search engine that aggregates results from multiple sources, providing both commercial and non-commercial search results side-by-side.

## Features

- **Multi-Source Search**: Combines results from Brave Search, Google Custom Search, and Marginalia Search
- **Dual Column Layout**: Desktop view shows commercial and non-commercial results side-by-side
- **Responsive Design**: Merged interleaved view on mobile devices
- **Image Search**: Integrated image search with slider and preview functionality
- **Knowledge Panel**: Wikipedia infobox with entity information and external links
- **DDG Bang Support**: DuckDuckGo-style bang syntax (e.g., `!g`, `!yt`) redirects to unduck.link
- **ChatGPT Integration**: Quick access button to open queries in ChatGPT
- **Infinite Scroll**: Automatic pagination for seamless browsing
- **Dark Theme**: Modern, minimal dark interface
- **Fast Performance**: Edge functions for low-latency responses

## Tech Stack

- **Frontend**: Vanilla JavaScript, HTML, CSS
- **Backend**: Netlify Edge Functions (Deno)
- **APIs**:
  - [Brave Search API](https://brave.com/search/api/)
  - [Google Custom Search API](https://developers.google.com/custom-search)
  - [Marginalia Search API](https://search.marginalia.nu/)
  - [Wikipedia API](https://www.mediawiki.org/wiki/API:Main_page)

## Setup

### Prerequisites

- A Netlify account
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

2. Set up environment variables in Netlify:
   - Go to your Netlify site settings
   - Navigate to **Site settings** → **Environment variables**
   - Add the following variables:

#### Required:
- `BRAVE_API_KEY` - Your Brave Search API subscription token

#### Optional (for Google results):
- `GOOGLE_CX` - Your Google Custom Search Engine ID
- `GOOGLE_SERVICE_ACCOUNT` - JSON string of your Google service account credentials

Example `GOOGLE_SERVICE_ACCOUNT` format:
```json
{
  "type": "service_account",
  "project_id": "...",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "...",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

3. Deploy to Netlify:
   - Connect your repository to Netlify
   - Netlify will automatically detect the build settings from `netlify.toml`
   - The site will deploy automatically

## Project Structure

```
.
├── index.html              # Main HTML file
├── script.js               # Frontend JavaScript
├── style.css               # Stylesheet
├── netlify/
│   └── edge-functions/
│       └── search.js       # Edge function (Deno) - API handler
├── netlify.toml            # Netlify configuration
└── README.md               # This file
```

## Configuration

The `netlify.toml` file configures:
- Edge function routing for `/api/search`
- Security headers (X-Frame-Options, CSP, etc.)
- Cache headers for static assets
- Build settings

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

1. Install Netlify CLI:
```bash
npm install -g netlify-cli
```

2. Start local development server:
```bash
netlify dev
```

3. Set environment variables locally:
```bash
netlify env:set BRAVE_API_KEY "your-key"
netlify env:set GOOGLE_CX "your-cx"
netlify env:set GOOGLE_SERVICE_ACCOUNT '{"type":"service_account",...}'
```

### Code Structure

- **Frontend** (`script.js`): Handles UI, search state, infinite scroll, image previews
- **Backend** (`netlify/edge-functions/search.js`): API handler using Deno edge functions

## API Endpoints

### `/api/search`

Search endpoint that aggregates results from multiple sources.

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
- Search queries are sent directly to search APIs
- Results are cached for performance (5 minutes for search, 1 hour for infobox)

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
- [Netlify](https://www.netlify.com/) - Hosting and edge functions

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
