// HTTP integration test — the dashboard and /integrity are admin-only at BOTH
// the route layer and the data layer.
// Run with the stack + dev server up:  node supabase/tests/http/dashboard.mjs
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

let passed = 0, failed = 0;
const check = (name, cond) => (cond ? (passed++, console.log("  ok   " + name)) : (failed++, console.log("  FAIL " + name)));

async function token(email) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  });
  return (await r.json()).access_token;
}
async function login(email) {
  const res = await fetch(BASE + "/auth/login", {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password: "password" }),
  });
  const jar = {};
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") };
}
const get = (path, cookie) =>
  fetch(BASE + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
const rpc = (tok, fn, body = {}) =>
  fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

console.log("Dashboard + Integrity access tests");

const admin = await login("admin@theeasyenglish.test");
const teacher = await login("teacher1@theeasyenglish.test");
const tTok = await token("teacher1@theeasyenglish.test");
const aTok = await token("admin@theeasyenglish.test");

// 1. Route layer — a teacher is bounced off both pages.
for (const p of ["/dashboard", "/integrity"]) {
  const r = await get(p, teacher.cookie);
  const dest = r.headers.get("location");
  check(`teacher ${p} -> redirected away (route denies)`,
    r.status >= 300 && r.status < 400 && !!dest && !dest.includes(p));
}

// 2. Admin reaches both.
for (const p of ["/dashboard", "/integrity"]) {
  // warm the route first (dev server compiles on demand)
  await get(p, admin.cookie);
  const r = await get(p, admin.cookie);
  check(`admin ${p} -> 200`, r.status === 200);
}

// 3. Data layer — a teacher calling the RPCs directly gets nothing back.
const today = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
for (const [fn, body] of [
  ["dashboard_headline", { p_start: from, p_end: today }],
  ["dashboard_renewals", {}],
  ["dashboard_attendance_risk", {}],
  ["dashboard_verify_backlog", {}],
  ["integrity_by_teacher", { p_start: from, p_end: today }],
  ["integrity_summary", { p_start: from, p_end: today }],
  ["dashboard_money", { p_start: from, p_end: today }],
]) {
  const rows = await rpc(tTok, fn, body).then((r) => r.json());
  check(`teacher RPC ${fn} -> no rows`, Array.isArray(rows) && rows.length === 0);
}

// 4. Sanity: the admin DOES get data from the same RPCs.
{
  const rows = await rpc(aTok, "dashboard_headline", { p_start: from, p_end: today }).then((r) => r.json());
  check("admin RPC dashboard_headline -> returns a row", Array.isArray(rows) && rows.length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
