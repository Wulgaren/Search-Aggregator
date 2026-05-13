/** Vercel Edge — same behavior as `netlify/edge-functions/search.ts` route `/api/search`. */
export const runtime = "edge";

import { aggregateEdgeRequest } from "../edge/search-route";

export default aggregateEdgeRequest;
