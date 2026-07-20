// HTTP integration test — the reschedule flow end to end through real sessions.
// Run with the stack + dev server up:  node supabase/tests/http/reschedule.mjs
//   * a teacher files a request via PostgREST (their own class) — allowed
//   * a teacher CANNOT move the class directly (append-only) — refused
//   * an admin approves via the reschedule_class RPC — the class moves + audit
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
const svc = (path, init = {}) =>
  fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json", ...(init.headers || {}) } });
const asUser = (tok, path, init = {}) =>
  fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, authorization: `Bearer ${tok}`, "content-type": "application/json", ...(init.headers || {}) } });

console.log("Reschedule flow tests");

const T1 = "00000000-0000-0000-0000-000000000b01";
const A1 = "00000000-0000-0000-0000-000000000a01";
const t1 = await token("teacher1@theeasyenglish.test");
const admin = await token("admin@theeasyenglish.test");

// A throwaway student so this test never touches seed data that pgTAP relies on
// (the class it creates is append-only and can't be cleaned up).
const stu = (await svc("students", {
  method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({ name: `Resched HTTP ${Date.now()}`, status: "lead" }),
}).then((r) => r.json()))[0];

// A fresh future published class for teacher1 (service role bypasses append-only checks on insert).
// end MUST equal start + duration (classes_end_matches_duration), so derive from one base.
const base = Date.now() + 3 * 86400_000;
const startISO = new Date(base).toISOString();
const endISO = new Date(base + 30 * 60_000).toISOString();
const ins = await svc("classes", {
  method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({
    slot_type: "DEMO", teacher_id: T1, student_id: stu.id,
    duration_minutes: 30, scheduled_start: startISO, scheduled_end: endISO,
    published_at: new Date().toISOString(),
  }),
});
const cls = (await ins.json())[0];
check("seeded a future published class for teacher1", !!cls?.id);

// 1. Teacher files a request for their OWN class → allowed.
const reqRes = await asUser(t1, "reschedule_requests", {
  method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({ class_id: cls.id, requested_by: T1, reason: "clashes with another commitment" }),
});
const req = (await reqRes.json())[0];
check("teacher can file a reschedule request for their own class", reqRes.status === 201 && !!req?.id);

// 2. Teacher CANNOT move the class directly (append-only immutability).
const move = await asUser(t1, `classes?id=eq.${cls.id}`, {
  method: "PATCH",
  body: JSON.stringify({ scheduled_start: new Date(Date.now() + 4 * 86400_000).toISOString() }),
});
check("teacher CANNOT move their own class directly (refused)", move.status >= 400);

// 3. Admin approves via the RPC → class moves, request approved, history written.
const newStart = new Date(Date.now() + 3 * 86400_000 + 5 * 3600_000).toISOString();
const rpc = await fetch(`${API}/rest/v1/rpc/reschedule_class`, {
  method: "POST",
  headers: { apikey: ANON, authorization: `Bearer ${admin}`, "content-type": "application/json" },
  body: JSON.stringify({ p_class_id: cls.id, p_new_start: newStart, p_request_id: req.id, p_note: "approved" }),
});
check("admin reschedule_class RPC succeeds", rpc.status === 200 || rpc.status === 204);

const moved = await svc(`classes?id=eq.${cls.id}&select=scheduled_start`).then((r) => r.json());
check("the class row actually moved", new Date(moved[0].scheduled_start).toISOString() === newStart);

const reqAfter = await svc(`reschedule_requests?id=eq.${req.id}&select=status`).then((r) => r.json());
check("the request is marked approved", reqAfter[0].status === "approved");

const hist = await svc(`class_reschedule_history?class_id=eq.${cls.id}&select=id,moved_by`).then((r) => r.json());
check("a class_reschedule_history row was written", hist.length === 1 && hist[0].moved_by === A1);

// Cleanup (service role; history is append-only so leave it — test DB is disposable).
await svc(`reschedule_requests?id=eq.${req.id}`, { method: "DELETE" });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
