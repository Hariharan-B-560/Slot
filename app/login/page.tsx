import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; msg?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center px-6">
      <Card className="w-full">
        <CardHeader className="items-center text-center">
          <Image src="/logo.png" alt="The Easy English" width={56} height={56} className="mx-auto mb-2 h-14 w-14" />
          <CardTitle>The Easy English — Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" action="/auth/login" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {sp.error && <p className="text-sm text-destructive">{sp.error}</p>}
            {sp.msg && <p className="text-sm text-primary">{sp.msg}</p>}
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            <Link href="/forgot-password" className="underline">
              Forgot your password?
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
