/** Vercel Edge — serves `/api/search`. */
export const runtime = "edge";

import { aggregateEdgeRequest } from "./lib/search-route.js";

export default aggregateEdgeRequest;
