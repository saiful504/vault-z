"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CRYPTO_VERSION,
  VERIFIER_PLAINTEXT,
  decryptPayload,
  deriveKey,
  deriveKeyMaterial,
  encryptPayload,
  generateSalt,
  saltFromBase64,
  saltToBase64,
} from "@/lib/crypto";
import {
  registerBiometric,
  restoreBiometricKey,
  type BiometricCredentialRecord,
} from "@/lib/webauthn";
import {
  getDemoUser,
  getDemoVault,
  isDemoMode,
  saveDemoVault,
} from "@/lib/demo-auth";
import { createClient } from "@/lib/supabase/client";

type VaultContextValue = {
  key: CryptoKey | null;
  unlocked: boolean;
  isFirstSetup: boolean | null;
  loading: boolean;
  error: string | null;
  checkSetup: () => Promise<void>;
  createVault: (masterPassword: string) => Promise<void>;
  unlock: (masterPassword: string) => Promise<void>;
  unlockWithBiometric: () => Promise<void>;
  enableBiometric: (masterPassword: string) => Promise<void>;
  lock: () => void;
};

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [isFirstSetup, setIsFirstSetup] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkSetup = useCallback(async () => {
    setError(null);
    if (isDemoMode) {
      const user = getDemoUser();
      setIsFirstSetup(user ? !getDemoVault(user.id).key : null);
      return;
    }
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsFirstSetup(null);
      return;
    }

    const { data, error: queryError } = await supabase
      .from("vault_keys")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (queryError) {
      setError(queryError.message);
      return;
    }

    setIsFirstSetup(!data);
  }, []);

  const createVault = useCallback(async (masterPassword: string) => {
    setLoading(true);
    setError(null);
    try {
      if (masterPassword.length < 5) {
        throw new Error("Master password must be at least 5 characters.");
      }
      if (isDemoMode) {
        const user = getDemoUser();
        if (!user) throw new Error("You must be signed in.");
        const salt = generateSalt();
        const derived = await deriveKey(masterPassword, salt);
        const verifier = await encryptPayload(derived, VERIFIER_PLAINTEXT);
        const vault = getDemoVault(user.id);
        saveDemoVault(user.id, {
          ...vault,
          key: {
            salt: saltToBase64(salt),
            verifier_iv: verifier.iv,
            verifier_ciphertext: verifier.ciphertext,
            version: CRYPTO_VERSION,
          },
        });
        setKey(derived);
        setIsFirstSetup(false);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("You must be signed in.");
      }

      const salt = generateSalt();
      const derived = await deriveKey(masterPassword, salt);
      const verifier = await encryptPayload(derived, VERIFIER_PLAINTEXT);

      const { error: insertError } = await supabase.from("vault_keys").insert({
        user_id: user.id,
        salt: saltToBase64(salt),
        verifier_iv: verifier.iv,
        verifier_ciphertext: verifier.ciphertext,
        version: CRYPTO_VERSION,
      });

      if (insertError) {
        throw new Error(insertError.message);
      }

      setKey(derived);
      setIsFirstSetup(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create vault.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const unlock = useCallback(async (masterPassword: string) => {
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode) {
        const user = getDemoUser();
        const vaultKey = user ? getDemoVault(user.id).key : null;
        if (!vaultKey) throw new Error("Vault key not found.");
        const derived = await deriveKey(
          masterPassword,
          saltFromBase64(vaultKey.salt),
        );
        await decryptPayload<string>(derived, {
          version: vaultKey.version,
          iv: vaultKey.verifier_iv,
          ciphertext: vaultKey.verifier_ciphertext,
        });
        setKey(derived);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("You must be signed in.");
      }

      const { data, error: queryError } = await supabase
        .from("vault_keys")
        .select("salt, verifier_iv, verifier_ciphertext")
        .eq("user_id", user.id)
        .single();

      if (queryError || !data) {
        throw new Error(queryError?.message ?? "Vault key not found.");
      }

      const derived = await deriveKey(
        masterPassword,
        saltFromBase64(data.salt),
      );
      await decryptPayload<string>(derived, {
        version: CRYPTO_VERSION,
        iv: data.verifier_iv,
        ciphertext: data.verifier_ciphertext,
      });

      setKey(derived);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not unlock the vault.",
      );
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const enableBiometric = useCallback(async (masterPassword: string) => {
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode) {
        const user = getDemoUser();
        const vaultKey = user ? getDemoVault(user.id).key : null;
        if (!user || !vaultKey) throw new Error("Vault key not found.");
        const material = await deriveKeyMaterial(
          masterPassword,
          saltFromBase64(vaultKey.salt),
        );
        await decryptPayload<string>(material.key, {
          version: vaultKey.version,
          iv: vaultKey.verifier_iv,
          ciphertext: vaultKey.verifier_ciphertext,
        });
        await registerBiometric(user, material.rawKey, async (record) => {
          const vault = getDemoVault(user.id);
          saveDemoVault(user.id, {
            ...vault,
            credential: { ...record, last_used_at: null },
          });
        });
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be signed in.");

      const { data, error: queryError } = await supabase
        .from("vault_keys")
        .select("salt, verifier_iv, verifier_ciphertext")
        .eq("user_id", user.id)
        .single();
      if (queryError || !data) {
        throw new Error(queryError?.message ?? "Vault key not found.");
      }

      const material = await deriveKeyMaterial(
        masterPassword,
        saltFromBase64(data.salt),
      );
      await decryptPayload<string>(material.key, {
        version: CRYPTO_VERSION,
        iv: data.verifier_iv,
        ciphertext: data.verifier_ciphertext,
      });
      await registerBiometric(user, material.rawKey, async (record) => {
        const { error: saveError } = await supabase
          .from("user_credentials")
          .upsert(
            {
              user_id: user.id,
              ...record,
            },
            { onConflict: "user_id" },
          );
        if (saveError) throw new Error(saveError.message);
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not enable biometric unlock.",
      );
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const unlockWithBiometric = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode) {
        const user = getDemoUser();
        const vault = user ? getDemoVault(user.id) : null;
        if (!user || !vault?.credential || !vault.key) {
          throw new Error(
            "Biometric unlock is not configured for this account.",
          );
        }
        const restored = await restoreBiometricKey(user.id, vault.credential);
        await decryptPayload<string>(restored, {
          version: vault.key.version,
          iv: vault.key.verifier_iv,
          ciphertext: vault.key.verifier_ciphertext,
        });
        saveDemoVault(user.id, {
          ...vault,
          credential: {
            ...vault.credential,
            last_used_at: new Date().toISOString(),
          },
        });
        setKey(restored);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be signed in.");

      const [
        { data: credential, error: credentialError },
        { data: vaultKey, error: vaultError },
      ] = await Promise.all([
        supabase
          .from("user_credentials")
          .select("credential_id, prf_salt")
          .eq("user_id", user.id)
          .single(),
        supabase
          .from("vault_keys")
          .select("verifier_iv, verifier_ciphertext")
          .eq("user_id", user.id)
          .single(),
      ]);
      if (credentialError || !credential) {
        throw new Error("Biometric unlock is not configured for this account.");
      }
      if (vaultError || !vaultKey) {
        throw new Error(vaultError?.message ?? "Vault key not found.");
      }

      const restored = await restoreBiometricKey(
        user.id,
        credential as BiometricCredentialRecord,
      );
      await decryptPayload<string>(restored, {
        version: CRYPTO_VERSION,
        iv: vaultKey.verifier_iv,
        ciphertext: vaultKey.verifier_ciphertext,
      });
      setKey(restored);
      await supabase
        .from("user_credentials")
        .update({ last_used_at: new Date().toISOString() })
        .eq("user_id", user.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not unlock with biometrics.",
      );
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const lock = useCallback(() => {
    setKey(null);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      key,
      unlocked: key !== null,
      isFirstSetup,
      loading,
      error,
      checkSetup,
      createVault,
      unlock,
      unlockWithBiometric,
      enableBiometric,
      lock,
    }),
    [
      key,
      isFirstSetup,
      loading,
      error,
      checkSetup,
      createVault,
      unlock,
      unlockWithBiometric,
      enableBiometric,
      lock,
    ],
  );

  return (
    <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
  );
}

export function useVault() {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within VaultProvider.");
  }
  return context;
}
