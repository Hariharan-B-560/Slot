"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type PaymentResult = { ok: boolean; error?: string };

// Admin-only bookkeeping. Payments are append-only: a correction is a new
// (negative) row, never an edit. total_fee changes are logged by a DB trigger.
const paymentSchema = z.object({
  enrolment_id: z.string().uuid(),
  amount: z.coerce.number().refine((n) => n !== 0, "Amount can't be zero"),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date the money moved"),
  note: z.string().trim().max(300).optional(),
});

export async function addPayment(input: unknown): Promise<PaymentResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const supabase = await createClient(); // admin session → payments_admin_insert
  // paid_at as a date → midnight IST instant (when the money moved).
  const paidAt = new Date(`${d.paid_at}T00:00:00+05:30`).toISOString();
  const { error } = await supabase.from("payments").insert({
    enrolment_id: d.enrolment_id,
    amount: d.amount,
    paid_at: paidAt,
    recorded_by: profile.id,
    note: d.note || null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/roster");
  return { ok: true };
}

const feeSchema = z.object({
  enrolment_id: z.string().uuid(),
  total_fee: z.coerce.number().nonnegative("Fee can't be negative").optional(),
  reason: z.string().trim().max(300).optional(),
});

export async function setTotalFee(input: unknown): Promise<PaymentResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = feeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const supabase = await createClient();
  // One admin-gated function sets the fee AND carries the reason to the
  // history trigger in the same transaction.
  const { error } = await supabase.rpc("set_enrolment_fee", {
    p_enrolment: d.enrolment_id,
    p_fee: d.total_fee ?? null,
    p_reason: d.reason || null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/roster");
  return { ok: true };
}
