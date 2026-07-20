import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Set your password</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Your account was created with a temporary password. Choose your own before continuing — no one else
            should know it.
          </p>
          <form method="post" action="/auth/change-password" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            </div>
            {sp.error && <p className="text-sm text-destructive">{sp.error}</p>}
            <Button type="submit" className="w-full">
              Set password &amp; continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
