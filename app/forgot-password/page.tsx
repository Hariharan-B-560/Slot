import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" action="/auth/forgot-password" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
            </div>
            <Button type="submit" className="w-full">
              Send reset link
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            <Link href="/login" className="underline">
              ← Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
