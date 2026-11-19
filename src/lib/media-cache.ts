const DATABASE_NAME = "vault-zk-private-media";
const STORE_NAME = "encrypted-media";

type CachedRecord = { id: string; iv: ArrayBuffer; ciphertext: ArrayBuffer; contentType: string };

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open offline media storage."));
  });
}

function userMediaKey(userId: string, fileId: string): string {
  return `${userId}:${fileId}`;
}

export async function cacheMedia(userId: string, fileId: string, blob: Blob, key: CryptoKey): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await blob.arrayBuffer());
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      id: userMediaKey(userId, fileId),
      iv: iv.buffer,
      ciphertext,
      contentType: blob.type || "application/octet-stream",
    } satisfies CachedRecord);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not save offline media."));
    transaction.onabort = () => reject(transaction.error || new Error("Could not save offline media."));
  }).finally(() => db.close());
}

export async function readCachedMedia(userId: string, fileId: string, key: CryptoKey): Promise<Blob | null> {
  const db = await openCache();
  const record = await new Promise<CachedRecord | undefined>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(userMediaKey(userId, fileId));
    request.onsuccess = () => resolve(request.result as CachedRecord | undefined);
    request.onerror = () => reject(request.error || new Error("Could not read offline media."));
  }).finally(() => db.close());
  if (!record) return null;
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, key, record.ciphertext);
  return new Blob([plaintext], { type: record.contentType });
}

export async function clearCachedMedia(userId: string, fileId: string): Promise<void> {
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(userMediaKey(userId, fileId));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not clear offline media."));
    transaction.onabort = () => reject(transaction.error || new Error("Could not clear offline media."));
  }).finally(() => db.close());
}
