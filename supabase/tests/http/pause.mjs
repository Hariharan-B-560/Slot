// HTTP integration test — pause/resume is admin-only, and round-trips.
// Run with the stack up:  node supabase/tests/http/pause.mjs
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

console.log("Pause / resume access + round-trip");

const admin = await token("admin@theeasyenglish.test");
const t1 = await token("teacher1@theeasyenglish.test");

// A throwaway active enrolment (own student + conversion), to avoid touching seed data.
const stu = (await svc("students", { method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({ name: `Pause HTTP ${Date.now()}`, status: "enrolled" }) }).then((r) => r.json()))[0];
const conv = (await svc("conversion_events", { method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({ student_id: stu.id, type: "admin_signoff", recorded_by: "00000000-0000-0000-0000-000000000a01" }) }).then((r) => r.json()))[0];
const enr = (await svc("enrolments", { method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({ student_id: stu.id, teacher_id: "00000000-0000-0000-0000-000000000b02",
    conversion_event_id: conv.id, slot_start: "11:30", duration_minutes: 30, start_date: new Date(Date.now() + 86400_000).toISOString().slice(0, 10), total_sessions: 8 }) }).then((r) => r.json()))[0];
check("seeded an active enrolment", !!enr?.id);

// 1. Teacher cannot pause.
{
  const r = await rpc(t1, "pause_enrolment", { p_id: enr.id, p_reason: "nope" });
  check("teacher pause_enrolment -> denied", r.status >= 400);
}
// 2. Teacher cannot flip status directly (RLS: silent no-op).
{
  await fetch(`${API}/rest/v1/enrolments?id=eq.${enr.id}`, {
    method: "PATCH", headers: { apikey: ANON, authorization: `Bearer ${t1}`, "content-type": "application/json" },
    body: JSON.stringify({ status: "paused" }),
  });
  const row = (await svc(`enrolments?id=eq.${enr.id}&select=status`).then((r) => r.json()))[0];
  check("teacher status write does not take effect", row.status === "active");
}
// 3. Admin pause → status paused + a history row.
{
  const r = await rpc(admin, "pause_enrolment", { p_id: enr.id, p_reason: "Health" });
  check("admin pause_enrolment succeeds", r.status === 200 || r.status === 204);
  const row = (await svc(`enrolments?id=eq.${enr.id}&select=status,paused_at`).then((r) => r.json()))[0];
  check("enrolment is paused with paused_at set", row.status === "paused" && !!row.paused_at);
  const hist = await svc(`enrolment_status_history?enrolment_id=eq.${enr.id}&new_status=eq.paused&select=reason`).then((r) => r.json());
  check("a paused history row was written (reason carried)", hist.length === 1 && hist[0].reason === "Health");
}
// 4. Admin resume → active again + classes exist.
{
  const r = await rpc(admin, "resume_enrolment", { p_id: enr.id });
  check("admin resume_enrolment succeeds", r.status === 200 || r.status === 204);
  const row = (await svc(`enrolments?id=eq.${enr.id}&select=status,paused_at`).then((r) => r.json()))[0];
  check("enrolment is active again, paused_at cleared", row.status === "active" && row.paused_at === null);
  const cls = await svc(`classes?enrolment_id=eq.${enr.id}&status=eq.published&select=id`).then((r) => r.json());
  check("resume regenerated classes", cls.length >= 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
