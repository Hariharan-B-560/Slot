// HTTP integration test — evidence signing respects Storage RLS, and the admin
// Verify page renders both screenshots for a delivered class.
// Run with the stack + dev server up:  node supabase/tests/http/evidence.mjs
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const API = "http://127.0.0.1:54321";
const env = Object.fromEntries(
  readFileSync(new URL("../../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let passed = 0,
  failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log("  ok   " + name);
  } else {
    failed++;
    console.log("  FAIL " + name);
  }
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function token(email, password) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).access_token;
}
async function uploadAs(tok, path) {
  return (
    await fetch(`${API}/storage/v1/object/session-evidence/${path}`, {
      method: "POST",
      headers: { apikey: ANON, authorization: `Bearer ${tok}`, "content-type": "image/png", "x-upsert": "true" },
      body: PNG,
    })
  ).status;
}
async function signAs(tok, path) {
  return (
    await fetch(`${API}/storage/v1/object/sign/session-evidence/${path}`, {
      method: "POST",
      headers: tok
        ? { apikey: ANON, authorization: `Bearer ${tok}`, "content-type": "application/json" }
        : { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 600 }),
    })
  ).status;
}
async function rest(path) {
  return (await fetch(`${API}/rest/v1/${path}`, { headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` } })).json();
}
async function login(email, password) {
  const res = await fetch(BASE + "/auth/login", {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }),
  });
  const jar = {};
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return jar;
}

console.log("Evidence signing + Verify render tests");

// A class owned by teacher1, and one owned by teacher2, for the cross-teacher case.
const t1Class = (await rest("classes?teacher_id=eq.00000000-0000-0000-0000-000000000b01&select=id&limit=1"))[0]?.id;
const t1 = await token("teacher1@theeasyenglish.test", "password");
const t2 = await token("teacher2@theeasyenglish.test", "password");
const admin = await token("admin@theeasyenglish.test", "password");

const path = `${t1Class}/opening-itest.png`;
check("teacher uploads evidence for own class", (await uploadAs(t1, path)) === 200);

// 1. admin can sign ANY evidence, and the signed URL actually downloads.
check("admin can sign any evidence (200)", (await signAs(admin, path)) === 200);
{
  const r = await fetch(`${API}/storage/v1/object/sign/session-evidence/${path}`, {
    method: "POST",
    headers: { apikey: ANON, authorization: `Bearer ${admin}`, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  const { signedURL } = await r.json();
  const dl = await fetch(`${API}/storage/v1${signedURL}`);
  check("admin signed URL downloads the object (200)", dl.status === 200);
}

// 2. teacher scope: own yes, another teacher's no.
check("teacher signs OWN evidence (200)", (await signAs(t1, path)) === 200);
check("teacher CANNOT sign another teacher's evidence (400)", (await signAs(t2, path)) === 400);

// 3. anon cannot sign anything.
check("anon CANNOT sign evidence (400)", (await signAs(null, path)) === 400);

// 4. opening + closing render on the Verify page for a delivered class.
//    Upload real files at a seeded delivered report's paths (owning teacher),
//    then load /verify as admin and assert both signed URLs are present.
{
  const reports = await rest(
    "session_reports?select=class_id,opening_screenshot,closing_screenshot,classes(teacher_id,status)",
  );
  // The Verify page only shows delivered/flagged classes.
  const row = reports.find((r) => r.classes?.status === "delivered" || r.classes?.status === "flagged");
  if (!row) {
    check("found a delivered/flagged class with a report fixture", false);
  } else {
    const ownerTok = row.classes.teacher_id === "00000000-0000-0000-0000-000000000b02" ? t2 : t1;
    await uploadAs(ownerTok, row.opening_screenshot);
    await uploadAs(ownerTok, row.closing_screenshot);
    const jar = await login("admin@theeasyenglish.test", "password");
    const html = await (
      await fetch(BASE + "/verify", {
        headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") },
      })
    ).text();
    const signPrefix = "/object/sign/session-evidence/" + row.class_id;
    // Both screenshots are server-rendered as signed URLs under the class's folder.
    const signCount = (html.match(new RegExp(signPrefix.replace(/[-/]/g, "\\$&"), "g")) || []).length;
    check("Verify page renders a signed URL for the opening screenshot", signCount >= 1);
    check("Verify page renders signed URLs for BOTH screenshots", signCount >= 2);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
