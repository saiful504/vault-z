export const isDemoMode =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const ACCOUNTS_KEY = "vault-zk-demo-accounts-v1";
const SESSION_KEY = "vault-zk-demo-session-v1";
const VAULT_PREFIX = "vault-zk-demo-vault-v1:";

export type DemoUser = {
  id: string;
  email: string;
  phone?: string;
};

export type DemoVaultKey = {
  salt: string;
  verifier_iv: string;
  verifier_ciphertext: string;
  version: number;
};

export type DemoVaultItem = {
  id: string;
  ciphertext: string;
  iv: string;
  version: number;
  created_at: string;
};

export type DemoCredential = {
  credential_id: string;
  public_key: string;
  transports: string[];
  prf_salt: string;
  last_used_at: string | null;
};

export type DemoVault = {
  key: DemoVaultKey | null;
  items: DemoVaultItem[];
  credential: DemoCredential | null;
};

type DemoAccount = DemoUser & { passwordHash: string };

function assertDemoMode(): void {
  if (!isDemoMode) {
    throw new Error("Local demo mode is available only in development.");
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readAccounts(): DemoAccount[] {
  return readJson<DemoAccount[]>(ACCOUNTS_KEY, []);
}

async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function registerDemo(
  email: string,
  password: string,
  phone?: string,
): Promise<void> {
  assertDemoMode();
  const accounts = readAccounts();
  if (
    accounts.some(
      (account) => account.email?.toLowerCase() === email.toLowerCase(),
    )
  ) {
    throw new Error("An account already exists for this email address.");
  }
  const user: DemoAccount = {
    id: crypto.randomUUID(),
    email,
    phone,
    passwordHash: await hashPassword(password),
  };
  window.localStorage.setItem(
    ACCOUNTS_KEY,
    JSON.stringify([...accounts, user]),
  );
  window.localStorage.setItem(SESSION_KEY, user.id);
}

export async function loginDemo(
  email: string,
  password: string,
): Promise<void> {
  assertDemoMode();
  const passwordHash = await hashPassword(password);
  const user = readAccounts().find(
    (account) =>
      account.email?.toLowerCase() === email.toLowerCase() &&
      account.passwordHash === passwordHash,
  );
  if (!user) throw new Error("Email address or account password is incorrect.");
  window.localStorage.setItem(SESSION_KEY, user.id);
}

export function getDemoUser(): DemoUser | null {
  assertDemoMode();
  const userId = window.localStorage.getItem(SESSION_KEY);
  if (!userId) return null;
  const user = readAccounts().find((account) => account.id === userId);
  return user ? { id: user.id, email: user.email, phone: user.phone } : null;
}

export function logoutDemo(): void {
  assertDemoMode();
  window.localStorage.removeItem(SESSION_KEY);
}

function vaultStorageKey(userId: string): string {
  return `${VAULT_PREFIX}${userId}`;
}

export function getDemoVault(userId: string): DemoVault {
  assertDemoMode();
  return readJson<DemoVault>(vaultStorageKey(userId), {
    key: null,
    items: [],
    credential: null,
  });
}

export function saveDemoVault(userId: string, vault: DemoVault): void {
  assertDemoMode();
  window.localStorage.setItem(vaultStorageKey(userId), JSON.stringify(vault));
}
