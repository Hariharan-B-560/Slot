// Upload placeholder evidence for every seeded session_report so the admin
// Verify page shows real images in local dev. seed.sql can only insert the
// PATH strings — the actual object bytes have to be pushed through the Storage
// API, which is what this does (service_role, private bucket).
//
// Run after a reset:   supabase db reset && node scripts/seed-evidence.mjs
//
// NOT part of CI or the automated tests — purely a local-dev convenience.
import { readFileSync } from "node:fs";

const API = "http://127.0.0.1:54321";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(1);
}

// A tiny valid 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function rest(path) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  });
  return res.json();
}

async function upload(objectPath) {
  const res = await fetch(`${API}/storage/v1/object/session-evidence/${objectPath}`, {
    method: "POST",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "image/png", "x-upsert": "true" },
    body: PNG,
  });
  return res.ok;
}

const reports = await rest("session_reports?select=opening_screenshot,closing_screenshot,recording");
let ok = 0;
for (const r of reports) {
  for (const p of [r.opening_screenshot, r.closing_screenshot, r.recording]) {
    if (p && (await upload(p))) ok++;
  }
}
console.log(`uploaded ${ok} evidence objects for ${reports.length} reports`);
