"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import NextImage from "next/image";
import { encryptPayload, type VaultItemPayload } from "@/lib/crypto";
import {
  getDemoUser,
  getDemoVault,
  isDemoMode,
  saveDemoVault,
} from "@/lib/demo-auth";
import { createClient } from "@/lib/supabase/client";
import { useVault } from "@/components/vault/VaultProvider";
import { cacheMedia, clearCachedMedia, readCachedMedia } from "@/lib/media-cache";

export type DecryptedVaultItem = {
  id: string;
  createdAt: string;
  payload: VaultItemPayload;
};

function megaEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname !== "mega.nz" && url.hostname !== "mega.co.nz") return null;
    const pathMatch = url.pathname.match(/\/file\/([\w-]+)/);
    const oldFormat = url.hash.match(/^#!?([\w-]+)!([\w-]+)/);
    const handle = pathMatch?.[1] ?? oldFormat?.[1];
    const key = oldFormat?.[2] ?? url.hash.replace(/^#/, "");
    return handle && key ? `https://mega.nz/embed/${handle}#${key}` : null;
  } catch {
    return null;
  }
}

type VaultMedia = NonNullable<VaultItemPayload["mediaLinks"]>[number];

function usePrivateMediaUrl(media: VaultMedia, key: CryptoKey | null, reloadToken = 0, enabled = true) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [privateDownloadUrl, setPrivateDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    let active = true;
    setStreamUrl(null);
    setPrivateDownloadUrl(null);
    setError(null);
    setOfflineReady(false);
    if (!media.fileId || !enabled) return () => { active = false; };
    let objectUrl: string | null = null;
    async function loadMediaAccess() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Sign in again to open this media.");
        if (key) {
          try {
            const cached = await readCachedMedia(session.user.id, media.fileId!, key);
            if (cached) {
              objectUrl = URL.createObjectURL(cached);
              if (active) {
                setStreamUrl(objectUrl);
                setPrivateDownloadUrl(objectUrl);
                setOfflineReady(true);
              }
              return;
            }
          } catch {
            // A stale cache entry should not prevent streaming the cloud original.
          }
        }
        const api = (process.env.NEXT_PUBLIC_MEDIA_UPLOAD_API_URL || process.env.NEXT_PUBLIC_MEGA_UPLOAD_API_URL)?.replace(/\/$/, "");
        if (!api) throw new Error("Media service is not configured.");
        const response = await fetch(`${api}/media/${encodeURIComponent(media.fileId!)}/access`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: media.contentType }),
        });
        const result = await response.json() as { streamUrl?: string; downloadUrl?: string; error?: string };
        if (!response.ok || !result.streamUrl) throw new Error(result.error || "Could not open this media.");
        if (active) {
          setStreamUrl(result.streamUrl);
          setPrivateDownloadUrl(result.downloadUrl || `${result.streamUrl}&download=1`);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not open this media.");
      }
    }
    void loadMediaAccess();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [media.fileId, media.contentType, key, reloadToken, enabled]);

  return { streamUrl, privateDownloadUrl, error, offlineReady };
}

type GalleryAsset = { item: DecryptedVaultItem; media: VaultMedia };

function GalleryTile({ asset, keyValue, reloadToken, onOpen, onRemove }: { asset: GalleryAsset; keyValue: CryptoKey | null; reloadToken: number; onOpen: () => void; onRemove: () => void }) {
  const { media } = asset;
  const tileRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = tileRef.current;
    if (!element || inView) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView]);
  const { streamUrl, privateDownloadUrl, error, offlineReady } = usePrivateMediaUrl(media, keyValue, reloadToken, inView);
  const downloadUrl = streamUrl ? (offlineReady ? streamUrl : privateDownloadUrl) : media.url;
  return (
    <article ref={tileRef} className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <button type="button" onClick={onOpen} aria-label={`View ${media.name || media.type}`} className="relative block aspect-square w-full overflow-hidden bg-zinc-100 text-left dark:bg-zinc-900">
        {streamUrl && media.type === "image" ? <img src={streamUrl} alt={media.name || "Vault photo"} loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : null}
        {streamUrl && media.type === "video" ? <video src={streamUrl} muted playsInline preload="metadata" className="size-full object-cover" /> : null}
        {!streamUrl ? <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-zinc-400"><span aria-hidden="true" className="text-4xl">{media.type === "video" ? "▶" : "▧"}</span><span className="text-xs">{error || (media.fileId ? "Loading preview…" : "Open media")}</span></div> : null}
        {media.type === "video" ? <span aria-hidden="true" className="absolute bottom-3 left-3 flex size-10 items-center justify-center rounded-full bg-black/65 text-sm text-white shadow">▶</span> : null}
        <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">{media.type}</span>
      </button>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0"><p className="truncate text-xs font-medium">{media.name || media.type}</p><p className="mt-0.5 text-[11px] text-zinc-500">{new Date(asset.item.createdAt).toLocaleDateString()}</p></div>
        {downloadUrl ? <a href={downloadUrl} download={offlineReady ? media.name || true : undefined} aria-label={`Download ${media.name || media.type}`} className="flex min-h-10 min-w-10 items-center justify-center rounded-full text-base text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">↓</a> : null}
        <button type="button" onClick={onRemove} aria-label={`Remove ${media.name || media.type}`} className="flex min-h-10 min-w-10 items-center justify-center rounded-full text-lg text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800">···</button>
      </div>
    </article>
  );
}

export function MediaGallery({ items, onChanged, loading = false }: { items: DecryptedVaultItem[]; onChanged: () => Promise<void> | void; loading?: boolean }) {
  const { key } = useVault();
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<GalleryAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [cacheReloadToken, setCacheReloadToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const assets: GalleryAsset[] = items.flatMap((item) =>
    (item.payload.mediaLinks ?? []).map((media) => ({ item, media })),
  );
  const visibleAssets = assets.filter(({ media }) =>
    (filter === "all" || media.type === filter) &&
    (media.name || "").toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selected = selectedIndex === null ? null : visibleAssets[selectedIndex] ?? null;

  useEffect(() => {
    if (!selected) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedIndex(null);
      if (event.key === "ArrowRight") moveSelection(1);
      if (event.key === "ArrowLeft") moveSelection(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveSelection, selected, visibleAssets.length]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!selected || selected.media.type !== "image" || !viewer) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((value) => Math.max(1, Math.min(4, value + (event.deltaY < 0 ? 0.15 : -0.15))));
    };
    viewer.addEventListener("wheel", onWheel, { passive: false });
    return () => viewer.removeEventListener("wheel", onWheel);
  }, [selected]);

  async function removeSelected(permanent: boolean) {
    if (!deleteTarget || !key) return;
    const { item, media } = deleteTarget;
    setBusy(true);
    setError(null);
    try {
      if (!permanent) {
        if (media.fileId) {
          const supabase = createClient();
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error("Sign in again before clearing offline media.");
          await clearCachedMedia(session.user.id, media.fileId);
          setCacheReloadToken((value) => value + 1);
        }
        setDeleteTarget(null);
        return;
      }
      const supabase = createClient();
      if (permanent && media.fileId) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Sign in again before deleting this media file.");
        const api = (process.env.NEXT_PUBLIC_MEDIA_UPLOAD_API_URL || process.env.NEXT_PUBLIC_MEGA_UPLOAD_API_URL)?.replace(/\/$/, "");
        if (!api) throw new Error("Media service is not configured.");
        const response = await fetch(`${api}/media/${encodeURIComponent(media.fileId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await response.json() as { error?: string };
        if (!response.ok && response.status !== 404) throw new Error(result.error || "Could not delete this media file.");
        await clearCachedMedia(session.user.id, media.fileId);
        setCacheReloadToken((value) => value + 1);
      }
      const mediaLinks = (item.payload.mediaLinks ?? []).filter((entry) =>
        media.fileId ? entry.fileId !== media.fileId : entry.url !== media.url,
      );
      if (mediaLinks.length === 0) {
        const { error: deleteError } = await supabase.from("vault_items").delete().eq("id", item.id);
        if (deleteError) throw new Error(deleteError.message);
      } else {
        const encrypted = await encryptPayload(key, { ...item.payload, mediaLinks });
        const { error: updateError } = await supabase.from("vault_items").update({
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          version: encrypted.version,
        }).eq("id", item.id);
        if (updateError) throw new Error(updateError.message);
      }
      setDeleteTarget(null);
      setSelectedIndex(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this media.");
    } finally {
      setBusy(false);
    }
  }

  const selectedMedia = selected?.media;
  const { streamUrl: selectedUrl, privateDownloadUrl: selectedDownloadUrl, error: selectedError, offlineReady: selectedOfflineReady } = usePrivateMediaUrl(selectedMedia ?? {
    type: "image", name: "", contentType: "image/jpeg", size: 0,
  }, key, cacheReloadToken, Boolean(selectedMedia));
  const selectedLegacyEmbed = selectedMedia?.url ? megaEmbedUrl(selectedMedia.url) : null;
  const downloadUrl = selectedUrl ? (selectedOfflineReady ? selectedUrl : selectedDownloadUrl) : selectedMedia?.url ?? null;

  async function saveSelectedOffline() {
    if (!selectedMedia?.fileId || !selectedUrl || !key) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sign in again to save this file offline.");
      const response = await fetch(selectedUrl);
      if (!response.ok) throw new Error("Could not download this media for offline use.");
      await cacheMedia(session.user.id, selectedMedia.fileId, await response.blob(), key);
      setCacheReloadToken((value) => value + 1);
      setError(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save offline media.");
    } finally {
      setBusy(false);
    }
  }

  function moveSelection(direction: number) {
    setZoom(1);
    setSelectedIndex((index) => index === null ? null : (index + direction + visibleAssets.length) % visibleAssets.length);
  }

  function handleViewerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (selectedMedia?.type !== "image" || event.pointerType !== "touch") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) swipeStart.current = event.clientX;
    if (pointers.current.size === 2) {
      const [first, second] = Array.from(pointers.current.values());
      pinchStart.current = { distance: Math.hypot(second.x - first.x, second.y - first.y), zoom };
      swipeStart.current = null;
    }
  }

  function handleViewerPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = pinchStart.current;
    if (start && pointers.current.size === 2) {
      const [first, second] = Array.from(pointers.current.values());
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      setZoom(Math.max(1, Math.min(4, start.zoom * distance / start.distance)));
    }
  }

  function handleViewerPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const wasPinching = pinchStart.current !== null;
    const startX = swipeStart.current;
    const delta = startX === null ? 0 : event.clientX - startX;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) swipeStart.current = null;
    if (!wasPinching && Math.abs(delta) > 60) moveSelection(delta < 0 ? 1 : -1);
  }

  return (
    <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">Your private collection</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Media gallery <span className="ml-1 text-sm font-normal text-zinc-400">{assets.length}</span></h2><p className="mt-1 text-sm text-zinc-500">Photos and videos from all your media uploads, in one place.</p></div>
        {assets.length ? <label className="relative block w-full sm:max-w-xs"><span className="sr-only">Search gallery</span><span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" className="min-h-11 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-9 pr-4 text-sm outline-none focus:ring-2 focus:ring-emerald-600/30 dark:border-zinc-800 dark:bg-zinc-900" /></label> : null}
      </header>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter gallery">
        {(["all", "image", "video"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setSelectedIndex(null); }} className={`min-h-10 rounded-full px-4 text-xs font-semibold capitalize transition-colors ${filter === value ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>{value === "all" ? `All · ${assets.length}` : `${value === "image" ? "Photos" : "Videos"} · ${assets.filter((asset) => asset.media.type === value).length}`}</button>)}
      </div>
      {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {visibleAssets.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{visibleAssets.map((asset, index) => <GalleryTile key={asset.media.fileId || asset.media.url || `${asset.item.id}-${index}`} asset={asset} keyValue={key} reloadToken={cacheReloadToken} onOpen={() => { setZoom(1); setSelectedIndex(index); }} onRemove={() => setDeleteTarget(asset)} />)}</div> : loading ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"><div className="aspect-square animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" /><div className="aspect-square animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" /><div className="aspect-square animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" /></div> : <div className="rounded-2xl border border-dashed border-zinc-300 px-5 py-12 text-center dark:border-zinc-700"><span aria-hidden="true" className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-xl text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">▧</span><h3 className="mt-4 text-sm font-semibold">{assets.length ? "No matching media" : "Your gallery is empty"}</h3><p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">{assets.length ? "Try a different search or filter." : "Choose Media in Add to vault to upload photos and videos. They will appear here together."}</p></div>}

      {selected && selectedMedia ? <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white" role="dialog" aria-modal="true" aria-label={`Media viewer: ${selectedMedia.name || selectedMedia.type}`} onClick={() => setSelectedIndex(null)}>
        <header className="flex min-h-16 items-center gap-3 border-b border-white/10 px-3 pt-[env(safe-area-inset-top)] sm:px-6" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setSelectedIndex(null)} aria-label="Close viewer" className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-white/10">×</button>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{selectedMedia.name || selectedMedia.type}</p><p className="text-xs text-white/55">{new Date(selected.item.createdAt).toLocaleString()} · {selectedMedia.size ? `${(selectedMedia.size / (1024 * 1024)).toFixed(1)} MB` : selectedMedia.type}</p></div>
          {downloadUrl ? <a href={downloadUrl} download={selectedOfflineReady ? selectedMedia.name || true : undefined} className="flex min-h-11 items-center rounded-full bg-white/10 px-4 text-xs font-semibold hover:bg-white/20">Export to device</a> : null}
          {selectedMedia.fileId ? <button type="button" disabled={busy || !selectedUrl || selectedOfflineReady} onClick={() => void saveSelectedOffline()} className="flex min-h-11 items-center rounded-full bg-white/10 px-3 text-xs font-semibold hover:bg-white/20 disabled:opacity-50">{selectedOfflineReady ? "Saved offline" : busy ? "Saving…" : "Save offline"}</button> : null}
          <button type="button" onClick={() => setDeleteTarget(selected)} className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-red-300 hover:bg-red-950/50">Manage</button>
        </header>
        <div className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-12 py-4 sm:px-20 ${selectedMedia.type === "image" ? "touch-none" : ""}`} ref={viewerRef} onClick={(event) => event.stopPropagation()} onPointerDown={handleViewerPointerDown} onPointerMove={handleViewerPointerMove} onPointerUp={handleViewerPointerUp} onPointerCancel={handleViewerPointerUp}>
          <button type="button" aria-label="Previous media" onClick={() => moveSelection(-1)} className="absolute left-2 z-10 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/20 sm:left-5">‹</button>
          {selectedUrl && selectedMedia.type === "image" ? <img src={selectedUrl} alt={selectedMedia.name || "Vault photo"} onDoubleClick={() => setZoom((value) => value > 1 ? 1 : 2)} className="max-h-full max-w-full select-none object-contain transition-transform duration-100" style={{ transform: `scale(${zoom})` }} draggable={false} /> : null}
          {selectedUrl && selectedMedia.type === "video" ? <video src={selectedUrl} controls autoPlay playsInline className="max-h-full max-w-full bg-black" /> : null}
          {!selectedUrl && selectedLegacyEmbed ? <iframe title={selectedMedia.name || selectedMedia.type} src={selectedLegacyEmbed} allow="autoplay; fullscreen" allowFullScreen className="h-full w-full max-w-5xl" /> : null}
          {!selectedUrl && !selectedLegacyEmbed ? <p role="status" className="text-center text-sm text-white/60">{selectedError || "Loading private media…"}</p> : null}
          <button type="button" aria-label="Next media" onClick={() => moveSelection(1)} className="absolute right-2 z-10 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/20 sm:right-5">›</button>
        </div>
        <footer className="flex min-h-14 items-center justify-center gap-4 border-t border-white/10 px-4 pb-[env(safe-area-inset-bottom)]" onClick={(event) => event.stopPropagation()}>
          {selectedMedia.type === "image" ? <><button type="button" onClick={() => setZoom((value) => Math.max(1, value - 0.25))} className="min-h-10 min-w-10 rounded-full bg-white/10">−</button><span className="min-w-12 text-center text-xs text-white/65">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(4, value + 0.25))} className="min-h-10 min-w-10 rounded-full bg-white/10">+</button></> : <span className="text-xs text-white/50">{selectedIndex! + 1} of {visibleAssets.length} · Use arrow keys or swipe to browse</span>}
          {selectedMedia.type === "image" ? <span className="ml-3 text-xs text-white/45">{selectedIndex! + 1} / {visibleAssets.length}</span> : null}
        </footer>
      </div> : null}

      {deleteTarget ? <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-3 sm:items-center" role="presentation" onClick={() => { if (!busy) setDeleteTarget(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="gallery-delete-title" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-950" onClick={(event) => event.stopPropagation()}>
          <div><h2 id="gallery-delete-title" className="text-lg font-semibold">Manage {deleteTarget.media.name || deleteTarget.media.type}</h2><p className="mt-2 text-sm text-zinc-500">Clear this app’s encrypted offline copy while keeping it in your gallery and cloud storage. Exported device files are managed by your device.</p></div>
          <button type="button" disabled={busy || !deleteTarget.media.fileId} onClick={() => void removeSelected(false)} className="min-h-12 w-full rounded-lg border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700">{busy ? "Clearing…" : "Clear offline copy · keep gallery and cloud file"}</button>
          <button type="button" disabled={busy || !deleteTarget.media.fileId} onClick={() => void removeSelected(true)} className="min-h-12 w-full rounded-lg bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? "Deleting…" : "Delete permanently from cloud storage"}</button>
          {!deleteTarget.media.fileId ? <p className="text-xs text-zinc-500">This older shared link has no app-managed offline copy.</p> : null}
          <button type="button" disabled={busy} onClick={() => setDeleteTarget(null)} className="min-h-11 w-full rounded-lg px-4 text-sm text-zinc-500">Cancel</button>
        </section>
      </div> : null}
    </section>
  );
}

function documentExtension(dataUrl: string): string {
  const mimeType = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));/)?.[1];
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

async function downloadDocument(dataUrl: string, title: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[\\/:*?"<>|]/g, "-")}.${documentExtension(dataUrl)}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type ItemListProps = {
  items: DecryptedVaultItem[];
  onDeleted: () => Promise<void> | void;
};

export function ItemList({ items, onDeleted }: ItemListProps) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedImage, setExpandedImage] = useState<{ src: string; title: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    if (!expandedImage) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setExpandedImage(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expandedImage]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!expandedImage || !viewer) return;
    function zoomWithWheel(event: WheelEvent) {
      event.preventDefault();
      setZoom((scale) => Math.min(3, Math.max(1, scale + (event.deltaY < 0 ? 0.15 : -0.15))));
    }
    viewer.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => viewer.removeEventListener("wheel", zoomWithWheel);
  }, [expandedImage]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [first, second] = Array.from(pointers.current.values());
      pinchStart.current = { distance: Math.hypot(second.x - first.x, second.y - first.y), zoom };
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = pinchStart.current;
    if (start && pointers.current.size === 2) {
      const [first, second] = Array.from(pointers.current.values());
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      setZoom(Math.min(3, Math.max(1, start.zoom * (distance / start.distance))));
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    pinchStart.current = null;
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      if (isDemoMode) {
        const user = getDemoUser();
        if (!user) throw new Error("You must be signed in.");
        const vault = getDemoVault(user.id);
        saveDemoVault(user.id, {
          ...vault,
          items: vault.items.filter((item) => item.id !== id),
        });
        await onDeleted();
        return;
      }
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("vault_items")
        .delete()
        .eq("id", id);
      if (deleteError) {
        throw new Error(deleteError.message);
      }
      await onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete item.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      {(["secret", "document"] as const).map((section) => {
        const sectionItems = items.filter((item) => section === "document"
          ? item.payload.category === "document"
          : item.payload.category !== "document" && item.payload.category !== "media");
        return <section key={section} className="space-y-3">
          <header className="flex items-baseline justify-between"><h2 className="text-base font-semibold">{section === "secret" ? "Secrets" : "Documents"}</h2><span className="text-xs text-zinc-400">{sectionItems.length}</span></header>
          {sectionItems.length ? <div className="space-y-3">{sectionItems.map((item) => {
        const shown = revealed[item.id] ?? false;
        return (
          <article
            key={item.id}
            className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  {item.payload.category === "document" ? "Scanned document" : item.payload.category}
                </p>
                <h3 className="text-base font-semibold">
                  {item.payload.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() =>
                  setRevealed((current) => ({
                    ...current,
                    [item.id]: !shown,
                  }))
                }
                className="min-h-11 min-w-14 rounded-md px-3 text-sm text-zinc-600 underline-offset-2 hover:bg-zinc-100 hover:underline dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {shown ? "Hide" : "Reveal"}
              </button>
            </div>
            {item.payload.documentImage ? (
              shown ? (
                <div className="space-y-2">
                  <div className="relative aspect-4/3 max-h-80 w-full border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                    <NextImage
                      src={item.payload.documentImage}
                      alt={`Scanned document: ${item.payload.title}`}
                      fill
                      unoptimized
                      sizes="(max-width: 768px) 100vw, 50vw"
                      className="object-contain"
                    />
                    <button type="button" onClick={() => { setZoom(1); setExpandedImage({ src: item.payload.documentImage!, title: item.payload.title }); }} aria-label={`View ${item.payload.title} full screen`} className="absolute bottom-3 right-3 rounded-lg bg-zinc-950/80 px-3 py-2 text-xs font-medium text-white shadow hover:bg-zinc-950">Full screen</button>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void downloadDocument(
                        item.payload.documentImage!,
                        item.payload.title,
                      )
                    }
                    className="min-h-10 border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Download{" "}
                    {documentExtension(
                      item.payload.documentImage,
                    ).toUpperCase()}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  Encrypted scan · reveal to view
                </p>
              )
            ) : (
              <p className="font-mono break-all text-sm">
                {shown ? item.payload.secret : "••••••••••••"}
              </p>
            )}
            {item.payload.notes ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {item.payload.notes}
              </p>
            ) : null}
            <div className="flex items-center justify-between pt-1">
              <time className="text-xs text-zinc-400">
                {new Date(item.createdAt).toLocaleString()}
              </time>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => void handleDelete(item.id)}
                className="min-h-11 px-3 text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                {busyId === item.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </article>
        );
      })}</div> : <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">{section === "secret" ? "No secrets saved yet." : "No documents saved yet."}</p>}
        </section>;
      })}
      {expandedImage ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950/95 text-white" role="dialog" aria-modal="true" aria-label={`Image viewer: ${expandedImage.title}`} onClick={() => setExpandedImage(null)}>
          <div className="flex min-h-16 items-center justify-between gap-3 border-b border-white/10 px-4 sm:px-6" onClick={(event) => event.stopPropagation()}>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{expandedImage.title}</p>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((scale) => Math.max(1, scale - 0.25))} className="min-h-10 min-w-10 rounded-lg bg-white/10 text-lg hover:bg-white/20">−</button>
              <button type="button" aria-label="Reset zoom" onClick={() => setZoom(1)} className="min-h-10 min-w-14 rounded-lg px-2 text-xs hover:bg-white/10">{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((scale) => Math.min(3, scale + 0.25))} className="min-h-10 min-w-10 rounded-lg bg-white/10 text-lg hover:bg-white/20">+</button>
              <button type="button" aria-label="Close image viewer" onClick={() => setExpandedImage(null)} className="ml-1 min-h-10 rounded-lg bg-white/10 px-3 text-sm hover:bg-white/20">Close</button>
            </div>
          </div>
          <div ref={viewerRef} className="flex min-h-0 flex-1 cursor-zoom-in touch-none items-center justify-center overflow-hidden p-4 sm:p-8" onClick={(event) => event.stopPropagation()} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onDoubleClick={() => setZoom((scale) => scale > 1 ? 1 : 2)}>
            <img src={expandedImage.src} alt={`Scanned document: ${expandedImage.title}`} draggable={false} className="max-h-full max-w-full select-none object-contain transition-transform duration-100 ease-out" style={{ transform: `scale(${zoom})` }} />
          </div>
          <p className="pb-4 text-center text-xs text-white/50">Pinch or double-tap to zoom · scroll to zoom · Esc to close</p>
        </div>
      ) : null}
    </div>
  );
}
