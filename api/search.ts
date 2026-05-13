/** Vercel Edge — serves `/api/search`. */
import { aggregateEdgeRequest } from "./lib/search-route.js";

export const runtime = "edge";

export default {
  fetch: aggregateEdgeRequest,
};
