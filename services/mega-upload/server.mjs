import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Storage } from "megajs";
import { createClient } from "@supabase/supabase-js";

const port = Number(process.env.PORT || 8787);
const frontendOrigin = process.env.FRONTEND_ORIGIN;
const megaEmail = process.env.MEGA_EMAIL;
const megaPassword = process.env.MEGA_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const mediaTokenSecret = process.env.MEDIA_TOKEN_SECRET;
const legacyRootOwnerIds = new Set(
  `${process.env.LEGACY_MEGA_ROOT_OWNER_USER_IDS || ""},${process.env.UPLOAD_ALLOWED_USER_IDS || ""}`
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 250 * 1024 * 1024);
const maxFiles = Number(process.env.MAX_FILES_PER_ITEM || 20);
const maxFilesPerUser = Number(process.env.MAX_FILES_PER_USER || 500);
const maxBytesPerUser = Number(process.env.MAX_BYTES_PER_USER || 2 * 1024 * 1024 * 1024);

if (!frontendOrigin || !megaEmail || !megaPassword || !supabaseUrl || !supabaseKey || !mediaTokenSecret || mediaTokenSecret.length < 32) {
  throw new Error("Set FRONTEND_ORIGIN, MEGA_EMAIL, MEGA_PASSWORD, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and a MEDIA_TOKEN_SECRET of at least 32 characters.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
let megaStoragePromise;
let megaBlockedUntil = 0;
const megaBlockedCooldownMs = 15 * 60 * 1000;

function isMegaBlocked(error) {
  return Number(error?.code) === -16 || /\bEBLOCKED\b|user blocked/i.test(error instanceof Error ? error.message : String(error || ""));
}

function megaErrorResponse(error, fallback) {
  if (isMegaBlocked(error)) {
    return {
      status: 503,
      message: "MEGA rejected this account or connection (EBLOCKED -16). The service will pause retries for 15 minutes. Check the account at mega.nz; if it remains blocked, contact MEGA support.",
    };
  }
  return { status: 502, message: error instanceof Error ? error.message : fallback };
}

function getMegaStorage() {
  if (Date.now() < megaBlockedUntil) {
    return Promise.reject(new Error("MEGA rejected this account or connection (EBLOCKED -16). Automatic retries are paused for 15 minutes."));
  }
  if (megaBlockedUntil) megaBlockedUntil = 0;
  if (!megaStoragePromise) {
    megaStoragePromise = new Storage({ email: megaEmail, password: megaPassword, keepalive: false }).ready.catch((error) => {
      megaStoragePromise = undefined;
      if (isMegaBlocked(error)) {
        megaBlockedUntil = Date.now() + megaBlockedCooldownMs;
        console.error("MEGA access was blocked (EBLOCKED -16); pausing retries for 15 minutes.");
      }
      throw error;
    });
  }
  return megaStoragePromise;
}

const allowedTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
  "video/mp4", "video/webm", "video/quicktime", "video/ogg",
]);

function sendJson(response, status, body, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin === frontendOrigin ? {
      "Access-Control-Allow-Origin": frontendOrigin,
      Vary: "Origin",
    } : {}),
  });
  response.end(JSON.stringify(body));
}

async function getAllowedUser(request) {
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { status: 401, error: "Sign in before uploading or viewing media." };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { status: 401, error: "Upload service could not verify this session. Check that it uses the same Supabase project as the app." };
  }
  return { user: data.user };
}

async function getUserFolder(storage, userId, create = false) {
  const folderName = `vault-user-${userId}`;
  let folder = storage.root.children?.find((entry) => entry.directory && entry.name === folderName);
  if (!folder && create) folder = await storage.root.mkdir(folderName);
  return folder ?? null;
}

async function getUserFiles(storage, userId, createFolder = false) {
  const folder = await getUserFolder(storage, userId, createFolder);
  const files = (folder?.children ?? []).filter((entry) => !entry.directory);
  if (legacyRootOwnerIds.has(userId)) {
    const legacyFiles = (storage.root.children ?? []).filter((entry) =>
      !entry.directory && !files.some((file) => file.nodeId === entry.nodeId),
    );
    files.push(...legacyFiles);
  }
  return { folder, files };
}

async function getUserFile(storage, userId, fileId) {
  const { files } = await getUserFiles(storage, userId);
  return files.find((entry) => entry.nodeId === fileId) ?? null;
}

function signMediaToken(fileId, userId, contentType) {
  const payload = Buffer.from(JSON.stringify({ fileId, userId, contentType, exp: Date.now() + 4 * 60 * 60 * 1000 })).toString("base64url");
  const signature = createHmac("sha256", mediaTokenSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyMediaToken(token, fileId) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", mediaTokenSecret).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.fileId === fileId && claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

async function readSmallJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error("Request body is too large.");
  }
  return JSON.parse(body);
}

function isFileId(value) {
  return /^[A-Za-z0-9_-]{6,20}$/.test(value);
}

function parseByteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || "");
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null && end !== null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (start !== null && end === null) {
    end = size - 1;
  }
  if (start === null || end === null || start > end || end >= size) return null;
  return { start, end };
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && origin !== frontendOrigin) {
    sendJson(response, 403, { error: "Origin not allowed." });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": frontendOrigin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Range, X-File-Name, X-Item-File-Count",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    });
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true }, origin);
    return;
  }

  if (request.method === "POST" && url.pathname === "/upload") {
    const auth = await getAllowedUser(request);
    if (auth.error) {
      request.resume();
      sendJson(response, auth.status, { error: auth.error }, origin);
      return;
    }

    const size = Number(request.headers["content-length"]);
    const contentType = String(request.headers["content-type"] || "").split(";")[0].toLowerCase();
    const uploadCount = Number(request.headers["x-item-file-count"] || 1);
    if (!Number.isSafeInteger(size) || size <= 0 || size > maxUploadBytes) {
      request.resume();
      sendJson(response, 413, { error: `Each file must be smaller than ${Math.floor(maxUploadBytes / (1024 * 1024))} MB.` }, origin);
      return;
    }
    if (!allowedTypes.has(contentType)) {
      request.resume();
      sendJson(response, 415, { error: "Choose a supported image or video file." }, origin);
      return;
    }
    if (!Number.isInteger(uploadCount) || uploadCount < 1 || uploadCount > maxFiles) {
      request.resume();
      sendJson(response, 400, { error: `Choose no more than ${maxFiles} files per item.` }, origin);
      return;
    }

    let name = "upload";
    try {
      name = decodeURIComponent(String(request.headers["x-file-name"] || "upload"));
    } catch {
      request.resume();
      sendJson(response, 400, { error: "Invalid file name." }, origin);
      return;
    }
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) || "upload";

    try {
      const storage = await getMegaStorage();
      const { folder, files } = await getUserFiles(storage, auth.user.id, true);
      const usedBytes = files.reduce((total, file) => total + (Number(file.size) || 0), 0);
      if (files.length >= maxFilesPerUser || usedBytes + size > maxBytesPerUser) {
        request.resume();
        sendJson(response, 413, { error: "Your media storage limit has been reached." }, origin);
        return;
      }
      const uploaded = await folder.upload({ name, size }, request).complete;
      const fileId = uploaded.nodeId;
      sendJson(response, 201, {
        fileId,
        name,
        size,
        type: contentType.startsWith("video/") ? "video" : "image",
        contentType,
      }, origin);
    } catch (error) {
      request.resume();
      if (!response.headersSent) {
        const failure = megaErrorResponse(error, "MEGA upload failed.");
        sendJson(response, failure.status, { error: failure.message }, origin);
      }
    }
    return;
  }

  const mediaRoute = /^\/media\/([A-Za-z0-9_-]{6,20})(?:\/(access|stream))?$/.exec(url.pathname);
  if (!mediaRoute) {
    sendJson(response, 404, { error: "Not found." }, origin);
    return;
  }
  const [, fileId, action] = mediaRoute;

  if (request.method === "POST" && action === "access") {
    const auth = await getAllowedUser(request);
    if (auth.error) {
      request.resume();
      sendJson(response, auth.status, { error: auth.error }, origin);
      return;
    }
    if (!isFileId(fileId)) {
      request.resume();
      sendJson(response, 400, { error: "Invalid MEGA file ID." }, origin);
      return;
    }
    let contentType;
    try {
      const body = await readSmallJson(request);
      contentType = body.contentType;
    } catch {
      sendJson(response, 400, { error: "Media type is missing." }, origin);
      return;
    }
    if (!allowedTypes.has(contentType)) {
      sendJson(response, 400, { error: "Unsupported media type." }, origin);
      return;
    }
    request.resume();
    try {
      const file = await getUserFile(await getMegaStorage(), auth.user.id, fileId);
      if (!file) {
        sendJson(response, 404, { error: "This file is not in your media library." }, origin);
        return;
      }
    } catch (error) {
      const failure = megaErrorResponse(error, "Could not access your MEGA files.");
      sendJson(response, failure.status, { error: failure.message }, origin);
      return;
    }
    const token = signMediaToken(fileId, auth.user.id, contentType);
    sendJson(response, 200, {
      streamUrl: `${url.origin}/media/${fileId}/stream?token=${encodeURIComponent(token)}`,
    }, origin);
    return;
  }

  if (request.method === "GET" && action === "stream") {
    const claims = verifyMediaToken(url.searchParams.get("token"), fileId);
    if (!claims) {
      sendJson(response, 401, { error: "This media access link is invalid or expired." }, origin);
      return;
    }
    try {
      const storage = await getMegaStorage();
      const file = await getUserFile(storage, claims.userId, fileId);
      if (!file) {
        sendJson(response, 404, { error: "This file is no longer in the MEGA account." }, origin);
        return;
      }
      const rangeHeader = request.headers.range;
      const range = rangeHeader ? parseByteRange(rangeHeader, file.size) : null;
      if (rangeHeader && !range) {
        response.writeHead(416, { "Content-Range": `bytes */${file.size}`, "Cache-Control": "no-store" });
        response.end();
        return;
      }
      const name = String(file.name || "media").replace(/[\r\n"\\]/g, "_");
      const headers = {
        "Content-Type": claims.contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        ...(origin === frontendOrigin ? { "Access-Control-Allow-Origin": frontendOrigin, Vary: "Origin" } : {}),
      };
      if (range) {
        response.writeHead(206, { ...headers, "Content-Length": range.end - range.start + 1, "Content-Range": `bytes ${range.start}-${range.end}/${file.size}` });
      } else {
        response.writeHead(200, { ...headers, "Content-Length": file.size });
      }
      const stream = file.download(range || {});
      stream.on("error", (error) => {
        response.destroy(error);
      });
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) {
        const failure = megaErrorResponse(error, "Could not stream this MEGA file.");
        sendJson(response, failure.status, { error: failure.message }, origin);
      }
    }
    return;
  }

  if (request.method === "DELETE" && !action) {
    const auth = await getAllowedUser(request);
    if (auth.error) {
      request.resume();
      sendJson(response, auth.status, { error: auth.error }, origin);
      return;
    }
    try {
      const storage = await getMegaStorage();
      const file = await getUserFile(storage, auth.user.id, fileId);
      if (!file) {
        sendJson(response, 404, { error: "This file is no longer in the MEGA account." }, origin);
        return;
      }
      await file.delete(true);
      sendJson(response, 200, { deleted: true }, origin);
    } catch (error) {
      const failure = megaErrorResponse(error, "Could not permanently delete this MEGA file.");
      sendJson(response, failure.status, { error: failure.message }, origin);
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." }, origin);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`MEGA upload service listening on ${port}`);
});
