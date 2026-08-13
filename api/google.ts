/** Vercel Node (iad1) — Google CSE web + images. Proxied by Edge `/api/search`. */
import { googleNodeRequest } from "./lib/google-node-route.js";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

export default {
  fetch: googleNodeRequest,
};
