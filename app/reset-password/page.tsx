"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The reset link opens here with a recovery token in the URL; the browser
 * client picks it up (detectSessionInUrl) and establishes a short-lived session,
 * so updateUser can set the new password. Then we sign out and go to /login.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters");
    if (password !== confirm) return setError("Passwords do not match");
    startTransition(async () => {
      const supabase = createClient();
      const { data, error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr || !data.user) {
        setError(pwErr?.message ?? "This reset link has expired — request a new one.");
        return;
      }
      // A password reset by the user clears any admin-forced flag too.
      await supabase.from("profiles").update({ must_change_password: false }).eq("id", data.user.id);
      await supabase.auth.signOut();
      router.replace("/login?msg=" + encodeURIComponent("Password updated — sign in."));
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Updating…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
