"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { isDemoMode, registerDemo } from "@/lib/demo-auth";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      if (isDemoMode) {
        await registerDemo(email, password, phone || undefined);
        router.push("/dashboard");
        router.refresh();
        return;
      }
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: phone ? { phone } : {},
          emailRedirectTo: new URL(
            "/auth/callback?next=/dashboard",
            process.env.NEXT_PUBLIC_SITE_URL || window.location.origin,
          ).toString(),
        },
      });
      if (signUpError) {
        if (/signups? not allowed|signup_disabled/i.test(signUpError.message)) {
          throw new Error(
            "Signups are disabled in this Supabase project. In Supabase Dashboard, open Authentication → Sign In / Providers and turn on Allow new users to sign up.",
          );
        }
        throw new Error(signUpError.message);
      }
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setMessage(
        "Check your email for a confirmation link, then return here to sign in. To skip email confirmation, turn off Confirm email in Supabase Auth settings.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign up.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-4 py-10 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Use an email and account password. Email confirmation is not needed when
        disabled in Supabase. You will set a separate vault password after sign
        in.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Email address</span>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none ring-emerald-500/40 focus:ring-2 dark:border-zinc-700"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">
            Phone number{" "}
            <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          <input
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            pattern="\+[1-9][0-9]{7,14}"
            placeholder="+14155552671"
            title="Use international format, for example +14155552671."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none ring-emerald-500/40 focus:ring-2 dark:border-zinc-700"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Account password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none ring-emerald-500/40 focus:ring-2 dark:border-zinc-700"
          />
        </label>
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        {message ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="min-h-12 w-full rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
        >
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="text-emerald-700 hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
