// HTTP integration test — the payments endpoint is admin-only at the network
// layer (rule 10). A teacher hitting /rest/v1/payments gets an empty set (no
// rows leaked); an admin gets the rows.
// Run with the stack up:  node supabase/tests/http/payments.mjs
import { readFileSync } from "node:fs";

const API = "http://127.0.0.1:54321";
const env = Object.fromEntries(
  readFileSync(new URL("../../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let passed = 0, failed = 0;
const check = (name, cond) => (cond ? (passed++, console.log("  ok   " + name)) : (failed++, console.log("  FAIL " + name)));

async function token(email) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  });
  return (await r.json()).access_token;
}
const rest = (tok, path, init = {}) =>
  fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, authorization: `Bearer ${tok}`, "content-type": "application/json", ...(init.headers || {}) } });
const svc = (path, init = {}) =>
  fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json", ...(init.headers || {}) } });

console.log("Payments endpoint privacy tests");

const admin = await token("admin@theeasyenglish.test");
const t1 = await token("teacher1@theeasyenglish.test");

// Seed a payment against an existing enrolment (service role bypasses RLS).
const enr = (await svc("enrolments?select=id&limit=1").then((r) => r.json()))[0];
await svc("enrolments?id=eq." + enr.id, { method: "PATCH", body: JSON.stringify({ total_fee: 5000 }) });
await svc("payments", { method: "POST", body: JSON.stringify({ enrolment_id: enr.id, amount: 2000, paid_at: new Date().toISOString(), recorded_by: "00000000-0000-0000-0000-000000000a01", note: "http seed" }) });

// 1. Teacher GET /payments → 200 but EMPTY (RLS hides — no data leaks).
{
  const res = await rest(t1, "payments?select=id,amount");
  const rows = await res.json();
  check("teacher GET /payments returns no rows (data hidden)", res.status === 200 && Array.isArray(rows) && rows.length === 0);
}

// 2. Teacher INSERT /payments → hard denial (RLS with_check false).
{
  const res = await rest(t1, "payments", {
    method: "POST",
    body: JSON.stringify({ enrolment_id: enr.id, amount: 1, paid_at: new Date().toISOString(), recorded_by: "00000000-0000-0000-0000-000000000b01" }),
  });
  check("teacher POST /payments is denied (RLS)", res.status === 401 || res.status === 403);
}

// 3. Admin GET /payments → sees the rows.
{
  const res = await rest(admin, "payments?select=id,amount&enrolment_id=eq." + enr.id);
  const rows = await res.json();
  check("admin GET /payments returns the rows", res.status === 200 && rows.length >= 1);
}

// 4. Teacher calling the derived reader → no rows (guarded).
{
  const res = await fetch(`${API}/rest/v1/rpc/enrolment_payment_status`, {
    method: "POST", headers: { apikey: ANON, authorization: `Bearer ${t1}`, "content-type": "application/json" },
    body: JSON.stringify({ p_enrolment: enr.id }),
  });
  const rows = await res.json();
  check("teacher enrolment_payment_status returns nothing (admin-guarded)", Array.isArray(rows) && rows.length === 0);
}

// 5. Admin reader shows remaining = 5000 − 2000 = 3000.
{
  const res = await fetch(`${API}/rest/v1/rpc/enrolment_payment_status`, {
    method: "POST", headers: { apikey: ANON, authorization: `Bearer ${admin}`, "content-type": "application/json" },
    body: JSON.stringify({ p_enrolment: enr.id }),
  });
  const rows = await res.json();
  check("admin reader computes remaining = 3000", rows[0] && Number(rows[0].remaining) === 3000);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
