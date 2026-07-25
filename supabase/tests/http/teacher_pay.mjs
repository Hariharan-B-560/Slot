// HTTP integration test — teacher pay is admin-only; rate changes are admin-only
// and write history.  Run with the stack up:  node supabase/tests/http/teacher_pay.mjs
import { readFileSync } from "node:fs";

const API = "http://127.0.0.1:54321";
const env = Object.fromEntries(
  readFileSync(new URL("../../../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let passed = 0, failed = 0;
const check = (n, c) => (c ? (passed++, console.log("  ok   " + n)) : (failed++, console.log("  FAIL " + n)));

async function token(email) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  });
  return (await r.json()).access_token;
}
const svc = (path, init = {}) =>
  fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json", ...(init.headers || {}) } });
const rpc = (tok, fn, body) =>
  fetch(`${API}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify(body) });

console.log("Teacher pay access + rate-change round-trip");

const admin = await token("admin@theeasyenglish.test");
const t1 = await token("teacher1@theeasyenglish.test");
const TEACHER1 = "00000000-0000-0000-0000-000000000b01";
const TEACHER2 = "00000000-0000-0000-0000-000000000b02";
const from = "2000-01-01", to = "2100-01-01";

// 1. A teacher gets nothing from the pay RPCs (admin-guarded, even for themselves).
{
  const one = await rpc(t1, "teacher_pay", { p_teacher: TEACHER2, p_from: from, p_to: to }).then((r) => r.json());
  check("teacher teacher_pay -> empty", Array.isArray(one) && one.length === 0);
  const all = await rpc(t1, "teacher_pay_all", { p_from: from, p_to: to }).then((r) => r.json());
  check("teacher teacher_pay_all -> empty", Array.isArray(all) && all.length === 0);
}

// 2. Admin sees a row per active teacher.
{
  const all = await rpc(admin, "teacher_pay_all", { p_from: from, p_to: to }).then((r) => r.json());
  check("admin teacher_pay_all -> rows", Array.isArray(all) && all.length >= 1);
  const t2 = all.find((r) => r.teacher_id === TEACHER2);
  check("admin sees teacher two with numeric figures", !!t2 && typeof t2.gross_pay === "number" && typeof t2.rate_per_30min === "number");
}

// 3. A teacher cannot change their OWN rate — the self-update guard raises.
{
  const before = (await svc(`profiles?id=eq.${TEACHER1}&select=rate_per_30min`).then((r) => r.json()))[0];
  const r = await fetch(`${API}/rest/v1/profiles?id=eq.${TEACHER1}`, {
    method: "PATCH", headers: { apikey: ANON, authorization: `Bearer ${t1}`, "content-type": "application/json" },
    body: JSON.stringify({ rate_per_30min: 9999 }),
  });
  check("teacher PATCH of own rate -> denied by guard", r.status >= 400);
  const after = (await svc(`profiles?id=eq.${TEACHER1}&select=rate_per_30min`).then((r) => r.json()))[0];
  check("own rate is unchanged", Number(after.rate_per_30min) === Number(before.rate_per_30min));
}

// 4. A teacher cannot call set_teacher_rate.
{
  const r = await rpc(t1, "set_teacher_rate", { p_teacher: TEACHER2, p_rate: 1, p_reason: "sneaky" });
  check("teacher set_teacher_rate -> denied", r.status >= 400);
}

// 5. Admin set_teacher_rate changes the rate and writes a history row.
{
  const newRate = 137;
  const r = await rpc(admin, "set_teacher_rate", { p_teacher: TEACHER2, p_rate: newRate, p_reason: "http test raise" });
  check("admin set_teacher_rate succeeds", r.status === 200 || r.status === 204);
  const row = (await svc(`profiles?id=eq.${TEACHER2}&select=rate_per_30min`).then((r) => r.json()))[0];
  check("rate is updated", Number(row.rate_per_30min) === newRate);
  const hist = await svc(`rate_history?teacher_id=eq.${TEACHER2}&new_rate=eq.${newRate}&select=reason,previous_rate`).then((r) => r.json());
  check("a rate_history row was written (reason carried)", hist.length >= 1 && hist[hist.length - 1].reason === "http test raise");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
