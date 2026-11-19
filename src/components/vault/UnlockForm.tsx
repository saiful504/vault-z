"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useVault } from "@/components/vault/VaultProvider";

export function UnlockForm() {
  const {
    isFirstSetup,
    loading,
    error,
    checkSetup,
    createVault,
    unlock,
    unlockWithBiometric,
  } = useVault();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void checkSetup();
  }, [checkSetup]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    try {
      if (isFirstSetup) {
        if (password.length < 5) {
          setLocalError("Use at least 5 characters for the master password.");
          return;
        }
        if (password !== confirm) {
          setLocalError("Master passwords do not match.");
          return;
        }
        await createVault(password);
      } else {
        await unlock(password);
      }
      setPassword("");
      setConfirm("");
    } catch {
      // VaultProvider stores the error message.
    }
  }

  async function handleBiometricUnlock() {
    setLocalError(null);
    try {
      await unlockWithBiometric();
    } catch {
      // VaultProvider stores the error message.
    }
  }

  if (isFirstSetup === null && !error) {
    return <p className="text-sm text-zinc-500">Checking vault status…</p>;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-lg space-y-5 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-7 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">
          {isFirstSetup ? "Create your vault" : "Unlock vault"}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {isFirstSetup
            ? "This master password never leaves this browser. If you forget it, your data cannot be recovered."
            : "Enter the master password used to encrypt this vault. It is not your account password."}
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Master password</span>
        <input
          type="password"
          autoComplete="off"
          required
          minLength={isFirstSetup ? 5 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-12 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none ring-emerald-500/40 focus:ring-2 dark:border-zinc-700"
        />
      </label>
      {isFirstSetup ? (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Confirm master password</span>
          <input
            type="password"
            autoComplete="off"
            required
            minLength={5}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none ring-emerald-500/40 focus:ring-2 dark:border-zinc-700"
          />
        </label>
      ) : null}
      {(localError || error) && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {localError ?? error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="min-h-12 w-full rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
      >
        {loading ? "Working…" : isFirstSetup ? "Create vault" : "Unlock"}
      </button>
      {!isFirstSetup ? (
        <button
          type="button"
          onClick={() => void handleBiometricUnlock()}
          disabled={loading}
          className="min-h-12 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {loading ? "Verifying…" : "Unlock with biometrics"}
        </button>
      ) : null}
    </form>
  );
}
