"use client";

import {
  useCallback,
  useEffect,
  startTransition,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { decryptPayload, type VaultItemPayload } from "@/lib/crypto";
import {
  getDemoUser,
  getDemoVault,
  isDemoMode,
  logoutDemo,
} from "@/lib/demo-auth";
import { createClient } from "@/lib/supabase/client";
import { ItemForm } from "@/components/vault/ItemForm";
import { ItemList, MediaGallery, type DecryptedVaultItem } from "@/components/vault/ItemList";
import { UnlockForm } from "@/components/vault/UnlockForm";
import { useVault } from "@/components/vault/VaultProvider";

export function VaultDashboard() {
  const router = useRouter();
  const { unlocked, key, lock, error, enableBiometric, loading } = useVault();
  const [items, setItems] = useState<DecryptedVaultItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
  const [biometricMessage, setBiometricMessage] = useState<string | null>(null);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBiometric, setShowBiometric] = useState(false);
  const loadRevision = useRef(0);

  const loadItems = useCallback(async () => {
    if (!key) {
      return;
    }
    const revision = ++loadRevision.current;
    setLoadingItems(true);
    setListError(null);
    try {
      if (isDemoMode) {
        const user = getDemoUser();
        if (!user) throw new Error("You must be signed in.");
        const vault = getDemoVault(user.id);
        const decrypted = await Promise.all(
          vault.items.map(async (row) => ({
            id: row.id,
            createdAt: row.created_at,
            payload: await decryptPayload<VaultItemPayload>(key, row),
          })),
        );
        if (revision !== loadRevision.current) return;
        setItems(decrypted);
        return;
      }
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("vault_items")
        .select("id, ciphertext, iv, version, created_at")
        .order("created_at", { ascending: false });

      if (queryError) {
        throw new Error(queryError.message);
      }

      const decrypted: DecryptedVaultItem[] = [];
      for (const row of data ?? []) {
        const payload = await decryptPayload<VaultItemPayload>(key, {
          version: row.version,
          iv: row.iv,
          ciphertext: row.ciphertext,
        });
        decrypted.push({
          id: row.id,
          createdAt: row.created_at,
          payload,
        });
      }
      if (revision !== loadRevision.current) return;
      setItems(decrypted);
    } catch (err) {
      if (revision !== loadRevision.current) return;
      setListError(
        err instanceof Error ? err.message : "Could not load vault items.",
      );
    } finally {
      if (revision === loadRevision.current) setLoadingItems(false);
    }
  }, [key]);

  useEffect(() => {
    startTransition(() => {
      if (unlocked) {
        void loadItems();
      } else {
        loadRevision.current += 1;
        setItems([]);
        setListError(null);
        setLoadingItems(false);
      }
    });
  }, [unlocked, loadItems]);

  useEffect(() => {
    if (!showAddForm) return;
    const previousOverflow = document.body.style.overflow;
    const isCompact = window.matchMedia("(max-width: 1023px)");
    const syncScrollLock = () => {
      document.body.style.overflow = isCompact.matches ? "hidden" : previousOverflow;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowAddForm(false);
    };
    syncScrollLock();
    isCompact.addEventListener("change", syncScrollLock);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      isCompact.removeEventListener("change", syncScrollLock);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showAddForm]);

  async function handleSignOut() {
    lock();
    if (isDemoMode) {
      logoutDemo();
      router.push("/login");
      router.refresh();
      return;
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleEnableBiometric(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBiometricMessage(null);
    setBiometricError(null);
    try {
      await enableBiometric(masterPassword);
      setMasterPassword("");
      setBiometricMessage("Biometric unlock enabled for this device.");
    } catch (err) {
      setBiometricError(
        err instanceof Error
          ? err.message
          : "Could not enable biometric unlock.",
      );
    }
  }

  const nonMediaItems = items.filter((item) => item.payload.category !== "media");
  const mediaItems = items.filter((item) => item.payload.category === "media");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
            Zero-knowledge
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Vault</h1>
        </div>
        <div className="flex gap-2">
          {unlocked ? (
            <button
              type="button"
              onClick={lock}
              className="min-h-11 rounded-lg border border-zinc-300 px-4 text-sm dark:border-zinc-700"
            >
              Lock
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="min-h-11 rounded-lg border border-zinc-300 px-4 text-sm dark:border-zinc-700"
          >
            Sign out
          </button>
        </div>
      </header>

      {!unlocked ? (
        <div className="flex justify-center">
          <UnlockForm />
        </div>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <button type="button" aria-expanded={showBiometric} onClick={() => setShowBiometric((open) => !open)} className="flex min-h-16 w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <span><span className="block text-sm font-semibold">Biometric unlock</span><span className="mt-1 block text-xs text-zinc-500">Set up fingerprint or Face ID on this device</span></span>
              <span aria-hidden="true" className="text-xl text-zinc-400">{showBiometric ? "−" : "+"}</span>
            </button>
            {showBiometric ? <form onSubmit={handleEnableBiometric} className="space-y-3 border-t border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Confirm your master password to enable a supported fingerprint or Face ID authenticator.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input type="password" required autoComplete="current-password" aria-label="Master password to enable biometric unlock" placeholder="Confirm master password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-zinc-700" />
                <button type="submit" disabled={loading} className="min-h-11 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60">{loading ? "Setting up…" : "Enable on this device"}</button>
              </div>
              {biometricMessage ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{biometricMessage}</p> : null}
              {biometricError ? <p className="text-sm text-red-600 dark:text-red-400">{biometricError}</p> : null}
            </form> : null}
          </section>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="h-fit">
              <button type="button" aria-expanded={showAddForm} onClick={() => setShowAddForm((open) => !open)} className="flex min-h-16 w-full items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-left shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900">
                <span><span className="block text-sm font-semibold">Add to vault</span><span className="mt-1 block text-xs text-zinc-500">Add a secret, document, photo, or video</span></span>
                <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-emerald-700 text-2xl font-light text-white">{showAddForm ? "−" : "+"}</span>
              </button>
              {showAddForm ? <div className="fixed inset-0 z-40 flex flex-col bg-black/55 p-0 backdrop-blur-sm lg:static lg:z-auto lg:mt-3 lg:block lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
                <div role="dialog" aria-modal="true" aria-labelledby="add-vault-title" className="flex h-full w-full flex-col overflow-y-auto bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] dark:bg-zinc-950 sm:px-6 lg:h-auto lg:rounded-2xl lg:border lg:border-zinc-200 lg:p-5 lg:dark:border-zinc-800">
                  <div className="mb-5 flex items-center justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800 lg:hidden">
                    <div><h2 id="add-vault-title" className="text-lg font-semibold">Add to vault</h2><p className="mt-1 text-sm text-zinc-500">Choose what you want to secure.</p></div>
                    <button type="button" onClick={() => setShowAddForm(false)} aria-label="Close add to vault" className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-zinc-100 text-xl hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800">×</button>
                  </div>
                  <ItemForm onSaved={() => { setShowAddForm(false); return loadItems(); }} />
                </div>
              </div> : null}
            </section>
            <section className="space-y-3">
              {loadingItems ? (
                <p className="text-sm text-zinc-500">Decrypting…</p>
              ) : null}
              {listError ? (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {listError}
                </p>
              ) : null}
              <ItemList items={nonMediaItems} onDeleted={loadItems} />
            </section>
          </div>
          <MediaGallery items={mediaItems} onChanged={loadItems} loading={loadingItems} />
        </>
      )}

      {error && unlocked ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
