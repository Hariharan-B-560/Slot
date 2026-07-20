// HTTP integration test — route protection under REAL sessions (cookie jar).
// Run with the dev server + stack up:  node supabase/tests/http/auth_routes.mjs
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const API = "http://127.0.0.1:54321";
const env = Object.fromEntries(
  readFileSync(new URL("../../../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name); }
}

// --- tiny cookie jar --------------------------------------------------------
function jar() { return {}; }
function merge(j, res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    j[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return j;
}
function cookieHeader(j) {
  return Object.entries(j).map(([k, v]) => `${k}=${v}`).join("; ");
}
async function get(path, j) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: j ? { cookie: cookieHeader(j) } : {} });
  if (j) merge(j, res);
  return { status: res.status, location: res.headers.get("location") };
}
async function login(email, password) {
  const j = jar();
  const res = await fetch(BASE + "/auth/login", {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }),
  });
  merge(j, res);
  return { j, status: res.status, location: res.headers.get("location") };
}
const dest = (loc) => (loc ? new URL(loc, BASE).pathname : null);

// --- create a FORCED teacher via the admin API (as the app's createTeacher) --
async function createForcedTeacher(email, password) {
  const u = await (await fetch(API + "/auth/v1/admin/users", {
    method: "POST", headers: { apikey: SERVICE, authorization: "Bearer " + SERVICE, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })).json();
  await fetch(API + "/rest/v1/profiles", {
    method: "POST", headers: { apikey: SERVICE, authorization: "Bearer " + SERVICE, "content-type": "application/json" },
    body: JSON.stringify({ id: u.id, name: "Forced Teacher", role: "teacher", email, active: true }), // must_change_password defaults true
  });
  return u.id;
}
async function deleteUser(id) {
  await fetch(API + "/rest/v1/profiles?id=eq." + id, { method: "DELETE", headers: { apikey: SERVICE, authorization: "Bearer " + SERVICE } });
  await fetch(API + "/auth/v1/admin/users/" + id, { method: "DELETE", headers: { apikey: SERVICE, authorization: "Bearer " + SERVICE } });
}

console.log("HTTP route-protection tests");

// 1. Unauthenticated → login
{
  const r = await get("/availability", jar());
  check("unauthenticated /availability -> /login", r.status >= 300 && dest(r.location) === "/login");
  const r2 = await get("/verify", jar());
  check("unauthenticated /verify -> /login", dest(r2.location) === "/login");
}

// 2. Teacher session
{
  const { j, location } = await login("teacher1@theeasyenglish.test", "password");
  check("teacher login -> /availability", dest(location) === "/availability");
  check("teacher /availability -> 200", (await get("/availability", j)).status === 200);
  for (const p of ["/verify", "/teachers", "/roster", "/dashboard"]) {
    const r = await get(p, j);
    check(`teacher ${p} -> blocked (/availability)`, r.status >= 300 && dest(r.location) === "/availability");
  }
}

// 3. Admin session
{
  const { j, location } = await login("admin@theeasyenglish.test", "password");
  check("admin login -> /availability", dest(location) === "/availability");
  for (const p of ["/verify", "/teachers", "/roster", "/dashboard"]) {
    check(`admin ${p} -> 200`, (await get(p, j)).status === 200);
  }
}

// 4. Bad credentials
{
  const r = await login("teacher1@theeasyenglish.test", "wrongpass");
  check("bad password -> /login?error", dest(r.location) === "/login");
}

// 5. Forced password change gates everything
{
  const email = `forced+${Date.now()}@theeasyenglish.test`;
  const id = await createForcedTeacher(email, "temp1234");
  try {
    const { j, location } = await login(email, "temp1234");
    check("forced login -> /change-password", dest(location) === "/change-password");
    const r = await get("/availability", j);
    check("forced user any page -> /change-password", dest(r.location) === "/change-password");
  } finally {
    await deleteUser(id);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
