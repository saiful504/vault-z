"use client";

import { useState, type FormEvent } from "react";
import {
  encryptPayload,
  type VaultCategory,
  type VaultItemPayload,
} from "@/lib/crypto";
import {
  getDemoUser,
  getDemoVault,
  isDemoMode,
  saveDemoVault,
} from "@/lib/demo-auth";
import { createClient } from "@/lib/supabase/client";
import { useVault } from "@/components/vault/VaultProvider";
import { DocumentScanner } from "@/components/vault/DocumentScanner";

const CATEGORIES: { value: VaultCategory; label: string }[] = [
  { value: "password", label: "Password" },
  { value: "nid", label: "NID" },
  { value: "passport", label: "Passport" },
  { value: "other", label: "Other" },
];

type ItemFormProps = {
  onSaved: () => Promise<void> | void;
};

export function ItemForm({ onSaved }: ItemFormProps) {
  const { key } = useVault();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<VaultCategory>("password");
  const [secret, setSecret] = useState("");
  const [notes, setNotes] = useState("");
  const [documentMode, setDocumentMode] = useState(false);
  const [mediaMode, setMediaMode] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [documentImage, setDocumentImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key) {
      setError("Vault is locked.");
      return;
    }
    if (documentMode && !documentImage) {
      setError("Apply the scan before saving this document.");
      return;
    }
    if (mediaMode) {
      if (!mediaFiles.length || mediaFiles.length > 20) {
        setError("Choose between 1 and 20 image or video files.");
        return;
      }
      if (mediaFiles.some((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) {
        setError("Choose image and video files only.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    setUploadProgress(null);

    try {
      let uploadedMedia: { type: "image" | "video"; fileId: string; name: string; contentType: string; size: number }[] = [];
      if (mediaMode) {
        if (isDemoMode) throw new Error("Media upload requires a signed-in Supabase account.");
        const uploadApi = process.env.NEXT_PUBLIC_MEGA_UPLOAD_API_URL?.replace(/\/$/, "");
        if (!uploadApi) throw new Error("Set NEXT_PUBLIC_MEGA_UPLOAD_API_URL to your MEGA upload service URL.");
        const uploadApiHost = new URL(uploadApi).hostname;
        if (uploadApiHost === "mega.nz" || uploadApiHost.endsWith(".mega.nz") || uploadApiHost === "mega.co.nz" || uploadApiHost.endsWith(".mega.co.nz")) {
          throw new Error("Use your MEGA upload service URL here, not a MEGA File Request link.");
        }
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("You must be signed in to upload media.");
        uploadedMedia = [];
        for (const [index, file] of mediaFiles.entries()) {
          setUploadProgress({ current: index + 1, total: mediaFiles.length, name: file.name });
          const response = await fetch(`${uploadApi}/upload`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": file.type,
              "X-File-Name": encodeURIComponent(file.name),
              "X-Item-File-Count": String(mediaFiles.length),
            },
            body: file,
          });
          const result = await response.json() as { fileId?: string; type?: "image" | "video"; name?: string; contentType?: string; size?: number; error?: string };
          if (!response.ok || !result.fileId || !result.type) {
            throw new Error(result.error || `Could not upload ${file.name}.`);
          }
          uploadedMedia.push({ type: result.type, fileId: result.fileId, name: result.name || file.name, contentType: result.contentType || file.type, size: result.size || file.size });
        }
        setUploadProgress(null);
      }
      const payload: VaultItemPayload = {
        title: mediaMode ? "Media gallery" : title,
        category: documentMode ? "document" : mediaMode ? "media" : category,
        notes,
        secret: documentMode || mediaMode ? "" : secret,
        ...(documentImage ? { documentImage } : {}),
        ...(mediaMode ? { mediaLinks: uploadedMedia } : {}),
      };
      const encrypted = await encryptPayload(key, payload);
      if (isDemoMode) {
        const user = getDemoUser();
        if (!user) throw new Error("You must be signed in.");
        const vault = getDemoVault(user.id);
        saveDemoVault(user.id, {
          ...vault,
          items: [
            {
              id: crypto.randomUUID(),
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
              version: encrypted.version,
              created_at: new Date().toISOString(),
            },
            ...vault.items,
          ],
        });
        setTitle("");
        setSecret("");
        setNotes("");
        setCategory("password");
        setDocumentMode(false);
        setDocumentImage(null);
        setMediaFiles([]);
        setMediaMode(false);
        await onSaved();
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("You must be signed in.");
      }

      const { error: insertError } = await supabase.from("vault_items").insert({
        user_id: user.id,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        version: encrypted.version,
      });

      if (insertError) {
        throw new Error(insertError.message);
      }

      setTitle("");
      setSecret("");
      setNotes("");
      setCategory("password");
      setDocumentMode(false);
      setDocumentImage(null);
      setMediaFiles([]);
      setMediaMode(false);
      await onSaved();
    } catch (err) {
      setUploadProgress(null);
      setError(err instanceof Error ? err.message : "Could not save item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Add to vault</h2>
        <div
          className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700"
          role="group"
          aria-label="Vault item type"
        >
          <button
            type="button"
            aria-pressed={!documentMode && !mediaMode}
            onClick={() => {
              setDocumentMode(false);
              setMediaMode(false);
              setDocumentImage(null);
              setCategory("password");
              setError(null);
            }}
            className={`min-h-10 rounded px-3 text-xs font-medium ${!documentMode && !mediaMode ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"}`}
          >
            Secret
          </button>
          <button type="button" aria-pressed={mediaMode} onClick={() => { setMediaMode(true); setDocumentMode(false); setDocumentImage(null); setSecret(""); setError(null); }} className={`min-h-10 rounded px-3 text-xs font-medium ${mediaMode ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"}`}>Media</button>
          <button
            type="button"
            aria-pressed={documentMode}
            onClick={() => {
              setDocumentMode(true);
              setMediaMode(false);
              setCategory("document");
              setSecret("");
              setError(null);
            }}
            className={`min-h-10 rounded px-3 text-xs font-medium ${documentMode ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"}`}
          >
            Document
          </button>
        </div>
      </div>
      {!mediaMode ? <label className="block space-y-1">
        <span className="text-sm font-medium">Title</span>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Work Gmail, Passport, NID card…"
          className="min-h-12 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none ring-emerald-500/40 focus:ring-2 dark:border-zinc-700"
        />
      </label> : null}
      {documentMode ? (
        <DocumentScanner onChange={(image) => setDocumentImage(image)} />
      ) : mediaMode ? (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Upload images and videos to MEGA</legend>
          <p className="text-xs text-zinc-500">Choose up to 20 files from your device. Files upload to MEGA first; their links are then encrypted in your vault item.</p>
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime,video/ogg" onChange={(event) => { setMediaFiles(Array.from(event.target.files ?? [])); setError(null); }} className="block min-h-12 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 dark:border-zinc-700 dark:file:bg-zinc-800" />
          {mediaFiles.length ? <ul className="space-y-1 text-xs text-zinc-500">{mediaFiles.map((file, index) => <li key={`${file.name}-${index}`} className="truncate">{file.type.startsWith("video/") ? "Video" : "Image"}: {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</li>)}</ul> : null}
          {uploadProgress ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">Uploading {uploadProgress.current} of {uploadProgress.total}: {uploadProgress.name}</p> : null}
        </fieldset>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as VaultCategory)}
              className="min-h-12 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none ring-emerald-500/40 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950"
            >
              {CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Secret</span>
            <textarea
              required
              rows={3}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Password, NID number, passport number…"
              className="min-h-24 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-3 text-base outline-none ring-emerald-500/40 focus:ring-2 dark:border-zinc-700"
            />
          </label>
        </>
      )}
      {!mediaMode ? <label className="block space-y-1">
        <span className="text-sm font-medium">Notes (optional)</span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-20 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-3 text-base outline-none ring-emerald-500/40 focus:ring-2 dark:border-zinc-700"
        />
      </label> : null}
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="min-h-11 w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
      >
        {saving
          ? "Encrypting…"
          : documentMode
            ? "Encrypt and save document"
            : mediaMode
              ? uploadProgress ? `Uploading ${uploadProgress.current}/${uploadProgress.total}…` : "Upload, encrypt and save"
              : "Encrypt and save"}
      </button>
    </form>
  );
}
