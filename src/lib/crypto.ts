export const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;
export const CRYPTO_VERSION = 1;
export const VERIFIER_PLAINTEXT = "vault-zk-ok";

export type VaultCategory =
  | "password"
  | "nid"
  | "passport"
  | "other"
  | "document"
  | "media";

export type VaultItemPayload = {
  title: string;
  category: VaultCategory;
  notes: string;
  secret: string;
  documentImage?: string;
  mediaLinks?: {
    type: "image" | "video";
    name: string;
    contentType: string;
    size: number;
    fileId?: string;
    url?: string;
  }[];
};

export type EncryptedRecord = {
  version: number;
  iv: string;
  ciphertext: string;
  salt?: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

export function saltToBase64(salt: Uint8Array): string {
  return bytesToBase64(salt);
}

export function saltFromBase64(value: string): Uint8Array {
  return base64ToBytes(value);
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  return (await deriveKeyMaterial(password, salt)).key;
}

export async function deriveKeyMaterial(
  password: string,
  salt: Uint8Array,
): Promise<{ key: CryptoKey; rawKey: ArrayBuffer }> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const rawKey = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: asBufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    KEY_LENGTH,
  );
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
  return { key, rawKey };
}

export async function encryptPayload(
  key: CryptoKey,
  data: unknown,
): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    encoded,
  );

  return {
    version: CRYPTO_VERSION,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptPayload<T>(
  key: CryptoKey,
  record: EncryptedRecord,
): Promise<T> {
  try {
    const iv = base64ToBytes(record.iv);
    const ciphertext = base64ToBytes(record.ciphertext);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(iv) },
      key,
      asBufferSource(ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  } catch {
    throw new Error("Wrong master password or corrupted data.");
  }
}
