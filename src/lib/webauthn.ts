"use client";

const DATABASE_NAME = "vault-zk-biometric";
const STORE_NAME = "key-envelopes";
const PRF_SALT_LENGTH = 32;

export type BiometricCredentialRecord = {
  credential_id: string;
  prf_salt: string;
};

type PrfResults = {
  first?: ArrayBuffer;
};

type PrfExtensions = {
  prf?: {
    enabled?: boolean;
    results?: PrfResults;
  };
};

type CachedEnvelope = {
  userId: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "userId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open local key storage."));
  });
}

async function saveEnvelope(envelope: CachedEnvelope): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(envelope);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Could not save biometric key cache."),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Biometric key cache was not saved."),
      );
  });
  database.close();
}

async function readEnvelope(
  userId: string,
): Promise<CachedEnvelope | undefined> {
  const database = await openDatabase();
  const envelope = await new Promise<CachedEnvelope | undefined>(
    (resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(userId);
      request.onsuccess = () =>
        resolve(request.result as CachedEnvelope | undefined);
      request.onerror = () =>
        reject(
          request.error ?? new Error("Could not read biometric key cache."),
        );
    },
  );
  database.close();
  return envelope;
}

export async function clearBiometricCache(userId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(userId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Could not clear biometric key cache."),
      );
  });
  database.close();
}

function assertPlatformSupport(): void {
  if (
    !window.isSecureContext ||
    !navigator.credentials ||
    !window.PublicKeyCredential
  ) {
    throw new Error(
      "Biometric unlock requires a supported browser on HTTPS or localhost.",
    );
  }
}

async function deriveWrappingKey(
  prfOutput: ArrayBuffer,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asBufferSource(salt),
      info: new TextEncoder().encode("vault-zk biometric key cache v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function getPrfOutput(
  credential: BiometricCredentialRecord,
): Promise<ArrayBuffer> {
  assertPlatformSupport();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const salt = fromBase64Url(credential.prf_salt);
  const publicKey = {
    challenge: asBufferSource(challenge),
    allowCredentials: [
      {
        id: asBufferSource(fromBase64Url(credential.credential_id)),
        type: "public-key" as const,
      },
    ],
    userVerification: "required" as const,
    extensions: { prf: { eval: { first: asBufferSource(salt) } } },
  };
  const assertion = (await navigator.credentials.get({
    publicKey,
  } as CredentialRequestOptions)) as PublicKeyCredential | null;
  const output = (
    assertion?.getClientExtensionResults() as PrfExtensions | undefined
  )?.prf?.results?.first;
  if (!output) {
    throw new Error(
      "This authenticator did not provide WebAuthn PRF output. Use your master password instead.",
    );
  }
  return output;
}

export async function registerBiometric(
  user: { id: string; phone?: string },
  rawVaultKey: ArrayBuffer,
  saveCredential: (record: {
    credential_id: string;
    public_key: string;
    transports: string[];
    prf_salt: string;
  }) => Promise<void>,
): Promise<void> {
  assertPlatformSupport();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const prfSalt = crypto.getRandomValues(new Uint8Array(PRF_SALT_LENGTH));
  const userId = new TextEncoder().encode(user.id);
  const creationOptions = {
    challenge: asBufferSource(challenge),
    rp: { name: "Vault ZK", id: window.location.hostname },
    user: {
      id: asBufferSource(userId),
      name: user.phone ?? user.id,
      displayName: "Vault user",
    },
    pubKeyCredParams: [
      { type: "public-key" as const, alg: -7 },
      { type: "public-key" as const, alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform" as const,
      residentKey: "preferred" as const,
      userVerification: "required" as const,
    },
    timeout: 60_000,
    attestation: "none" as const,
    extensions: { prf: { eval: { first: asBufferSource(prfSalt) } } },
  };
  const created = (await navigator.credentials.create({
    publicKey: creationOptions,
  } as CredentialCreationOptions)) as PublicKeyCredential | null;
  if (!created) throw new Error("Biometric credential creation was cancelled.");

  const response = created.response as AuthenticatorAttestationResponse;
  const publicKey = response.getPublicKey?.();
  const prfEnabled = (created.getClientExtensionResults() as PrfExtensions).prf
    ?.enabled;
  if (!publicKey || prfEnabled === false) {
    throw new Error(
      "This browser or authenticator does not support WebAuthn PRF. Biometric key caching was not enabled.",
    );
  }

  const record = {
    credential_id: toBase64Url(new Uint8Array(created.rawId)),
    public_key: toBase64Url(new Uint8Array(publicKey)),
    transports: response.getTransports?.() ?? [],
    prf_salt: toBase64Url(prfSalt),
  };
  const prfOutput = await getPrfOutput(record);
  const wrappingKey = await deriveWrappingKey(prfOutput, prfSalt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    wrappingKey,
    rawVaultKey,
  );

  await saveCredential(record);
  await saveEnvelope({ userId: user.id, iv: asBufferSource(iv), ciphertext });
}

export async function restoreBiometricKey(
  userId: string,
  credential: BiometricCredentialRecord,
): Promise<CryptoKey> {
  const envelope = await readEnvelope(userId);
  if (!envelope)
    throw new Error(
      "No biometric key is cached on this device. Unlock with your master password first.",
    );

  const output = await getPrfOutput(credential);
  const salt = fromBase64Url(credential.prf_salt);
  const wrappingKey = await deriveWrappingKey(output, salt);
  try {
    const rawKey = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: envelope.iv },
      wrappingKey,
      envelope.ciphertext,
    );
    return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  } catch {
    throw new Error(
      "Biometric key cache could not be unlocked. Use your master password to refresh it.",
    );
  }
}
