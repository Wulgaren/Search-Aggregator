/** Vercel Edge — POST `/api/ai` routed through shared handler (`aggregateEdgeRequest` checks pathname). */
import { aggregateEdgeRequest } from "./lib/search-route.js";

export const runtime = "edge";

export default {
  fetch: aggregateEdgeRequest,
};
