import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-sm font-semibold tracking-tight">vault-zk</span>
        <nav className="flex gap-3 text-sm">
          <Link
            href="/login"
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-600"
          >
            Get started
          </Link>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          Personal data vault
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Encrypt passwords, NID, and passport data in the browser.
        </h1>
        <p className="mt-4 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Two passwords: an account password for Supabase Auth, and a vault
          master password that never leaves this device. The database stores
          AES-GCM ciphertext only.
        </p>
        <ul className="mt-8 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li>AES-GCM with PBKDF2 (600,000 iterations) via Web Crypto.</li>
          <li>Row Level Security so you can only query your own rows.</li>
          <li>Closing the tab wipes the in-memory encryption key.</li>
        </ul>
        <div className="mt-10 flex gap-3">
          <Link
            href="/signup"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
          >
            Create a free account
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
          >
            Sign in
          </Link>
        </div>
      </main>
    </div>
  );
}
