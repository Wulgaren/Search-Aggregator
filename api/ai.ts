/** Vercel Edge — POST `/api/ai` routed through shared handler (`aggregateEdgeRequest` checks pathname). */
export const runtime = "edge";

import { aggregateEdgeRequest } from "./lib/search-route.js";

export default aggregateEdgeRequest;
