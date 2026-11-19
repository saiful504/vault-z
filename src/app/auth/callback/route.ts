import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const destination =
    next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
      ? new URL(next, origin)
      : new URL("/dashboard", origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(
        destination.origin === origin
          ? destination
          : new URL("/dashboard", origin),
      );
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
