/**
 * Test Google Custom Search auth modes.
 *
 *   GOOGLE_CX=your_cx \
 *   GOOGLE_SERVICE_ACCOUNT="$(cat path/to/sa.json)" \
 *   GOOGLE_API_KEY=optional_api_key \
 *   node scripts/test-google-cse.mjs
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const cx = process.env.GOOGLE_CX?.trim();
const apiKey = process.env.GOOGLE_API_KEY?.trim() || "";
let saJson = process.env.GOOGLE_SERVICE_ACCOUNT?.trim() || "";

if (!saJson && process.env.GOOGLE_SA_FILE) {
  saJson = readFileSync(process.env.GOOGLE_SA_FILE, "utf8").trim();
}

if (!cx) {
  console.error("Set GOOGLE_CX");
  process.exit(1);
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getAccessToken(serviceAccount) {
  const { client_email, private_key } = serviceAccount;
  if (!client_email || !private_key) {
    throw new Error("Service account missing client_email or private_key");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: client_email,
      scope: "https://www.googleapis.com/auth/cse",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const input = `${header}.${payload}`;
  const sig = crypto
    .createSign("RSA-SHA256")
    .update(input)
    .sign(private_key, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const jwt = `${input}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function runTest(label, { bearer, key }) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", "test");
  url.searchParams.set("num", "1");
  if (key) url.searchParams.set("key", key);

  const headers = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetch(url.toString(), { headers });
  const body = await res.text();
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url.toString().replace(/key=[^&]+/, "key=***")}`);
  console.log(`Auth: ${bearer ? "Bearer token" : "none"}${key ? " + API key param" : ""}`);
  console.log(`HTTP ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body);
  }
}

let serviceAccount;
if (saJson) {
  try {
    serviceAccount = JSON.parse(saJson);
  } catch {
    console.error("GOOGLE_SERVICE_ACCOUNT is not valid JSON");
    process.exit(1);
  }
}

let token = null;
if (serviceAccount) {
  try {
    token = await getAccessToken(serviceAccount);
    console.log("OAuth token OK");
  } catch (e) {
    console.error("OAuth token failed:", e.message);
  }
}

if (apiKey) {
  await runTest("A: API key only (no Bearer)", { bearer: null, key: apiKey });
}

if (token) {
  await runTest("B: Bearer only (no key param)", { bearer: token, key: null });
}

if (token && apiKey) {
  await runTest("C: Bearer + API key param (current broken app path)", {
    bearer: token,
    key: apiKey,
  });
}

if (!apiKey && !token) {
  console.error("Set GOOGLE_SERVICE_ACCOUNT and/or GOOGLE_API_KEY");
  process.exit(1);
}

console.log("\n--- curl after token (Bearer only) ---");
if (token) {
  console.log(
    `curl -s -H "Authorization: Bearer ${token}" \\
  "https://www.googleapis.com/customsearch/v1?cx=${cx}&q=test&num=1" | head -c 400`
  );
}
