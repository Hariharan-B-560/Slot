// HTTP integration test — permanent slot change is admin-only and moves future
// classes.  Run with the stack up:  node supabase/tests/http/slot_change.mjs
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

console.log("Slot change access + round-trip");

const admin = await token("admin@theeasyenglish.test");
const t1 = await token("teacher1@theeasyenglish.test");

// A throwaway active enrolment for Teacher Two at an unusual slot (07:00), with a
// future published class two days out so it's clearly reschedulable.
const day2 = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
const stu = (await svc("students", { method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({ name: `Slot HTTP ${Date.now()}`, status: "enrolled" }) }).then((r) => r.json()))[0];
const conv = (await svc("conversion_events", { method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({ student_id: stu.id, type: "admin_signoff", recorded_by: "00000000-0000-0000-0000-000000000a01" }) }).then((r) => r.json()))[0];
const enr = (await svc("enrolments", { method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({ student_id: stu.id, teacher_id: "00000000-0000-0000-0000-000000000b02",
    conversion_event_id: conv.id, slot_start: "07:00", duration_minutes: 30, start_date: day2, total_sessions: 8 }) }).then((r) => r.json()))[0];
// scheduled_start = day2 07:00 IST = day2T01:30:00Z
const startZ = `${day2}T01:30:00+00:00`;
const cls = (await svc("classes", { method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({ slot_type: "ENROLLED", teacher_id: "00000000-0000-0000-0000-000000000b02", student_id: stu.id,
    enrolment_id: enr.id, duration_minutes: 30, scheduled_start: startZ, scheduled_end: `${day2}T02:00:00+00:00`,
    published_at: new Date().toISOString() }) }).then((r) => r.json()))[0];
check("seeded an active enrolment + future class", !!enr?.id && !!cls?.id);

// 1. A teacher cannot change a slot.
{
  const r = await rpc(t1, "set_enrolment_slot", { p_enrolment: enr.id, p_new_slot: "08:00", p_reason: "nope" });
  check("teacher set_enrolment_slot -> denied", r.status >= 400);
}

// 2. Admin changes the slot to 09:00 → enrolment updates + the class moves.
{
  const r = await rpc(admin, "set_enrolment_slot", { p_enrolment: enr.id, p_new_slot: "09:00", p_reason: "http test" });
  check("admin set_enrolment_slot succeeds", r.status === 200 || r.status === 204);
  const e = (await svc(`enrolments?id=eq.${enr.id}&select=slot_start`).then((r) => r.json()))[0];
  check("enrolment slot is now 09:00", e.slot_start === "09:00:00");
  const c = (await svc(`classes?id=eq.${cls.id}&select=scheduled_start`).then((r) => r.json()))[0];
  // 09:00 IST = 03:30Z on the same date.
  check("the future class moved to 09:00 IST", new Date(c.scheduled_start).toISOString() === `${day2}T03:30:00.000Z`);
  const hist = await svc(`class_reschedule_history?class_id=eq.${cls.id}&select=note`).then((r) => r.json());
  check("a reschedule-history row was written", hist.length >= 1 && /slot change/i.test(hist[hist.length - 1].note ?? ""));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
