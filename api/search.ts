/** Vercel Edge — serves `/api/search`. */
export const runtime = "edge";

import { aggregateEdgeRequest } from "./lib/search-route";

export default aggregateEdgeRequest;
