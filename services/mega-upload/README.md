# Private media upload service (Cloudflare R2)

This standalone Node.js service accepts image and video uploads, verifies the signed-in Supabase user, and stores each file as a private object in Cloudflare R2 using its S3-compatible API. It returns an opaque file ID; the vault encrypts that ID inside the existing vault payload. Reads and downloads stream through this service using short-lived signed URLs. The service does not make the bucket public or return public object URLs.

The service is separate from the Vercel app because Vercel Functions are not suitable for the large streamed request bodies used for video uploads. R2 is the object storage; this Node.js API still needs a Node-compatible host with HTTPS and streaming request support (for example, Render).

## Create and configure R2

1. In Cloudflare Dashboard, open **Storage & databases → R2 → Overview** and create a bucket. Keep it private; do not enable public bucket access for this app.
2. Create an R2 API token with **Object Read & Write** permission, scoped to this bucket only. Keep its Access Key ID and Secret Access Key in the API host's secret settings.
3. Find the account ID and S3 endpoint in the R2 dashboard. The endpoint format is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
4. Deploy this service to a Node.js host. Use `npm install` and start it with `npm run media-upload:prod` (or `node services/mega-upload/server.mjs`). Set the host's health check path to `/health` if supported.
5. Set the service environment variables below. Set `MEDIA_PUBLIC_ORIGIN` to the service's exact public HTTPS origin, such as `https://your-media-api.onrender.com`.
6. In Vercel, set `NEXT_PUBLIC_MEDIA_UPLOAD_API_URL` to that same service origin and redeploy the app.

Cloudflare's S3 API requires the `auto` region and the account-specific endpoint. See [Cloudflare's R2 S3 API setup guide](https://developers.cloudflare.com/r2/get-started/s3/) for current dashboard steps.

## Service environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Host-provided service port; defaults to `8787`. |
| `FRONTEND_ORIGIN` | Exact app origin allowed to call the API, e.g. `https://vault-z-five.vercel.app`. |
| `MEDIA_PUBLIC_ORIGIN` | Canonical HTTPS origin used to generate stream and download URLs. HTTP is accepted only for `localhost` development. |
| `R2_ACCOUNT_ID` | Cloudflare account ID for the R2 S3 endpoint. |
| `R2_ACCESS_KEY_ID` | R2 API token Access Key ID. Keep server-side only. |
| `R2_SECRET_ACCESS_KEY` | R2 API token Secret Access Key. Keep server-side only. |
| `R2_BUCKET_NAME` | Name of the private R2 bucket. |
| `R2_ENDPOINT` | Optional S3 endpoint override; defaults to `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project URL used by the app. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key used by the app. Do not use a service-role key. |
| `MEDIA_TOKEN_SECRET` | Random secret of at least 32 characters used to sign four-hour media URLs. |
| `MAX_UPLOAD_BYTES` | Maximum size per file in bytes; defaults to 250 MiB. |
| `MAX_FILES_PER_ITEM` | Maximum files selected in one vault item; defaults to 20. |
| `MAX_FILES_PER_USER` | Maximum R2 objects per user; defaults to 500. |
| `MAX_BYTES_PER_USER` | Maximum total R2 bytes per user; defaults to 2 GiB. |
| `MEGA_EMAIL`, `MEGA_PASSWORD` | Optional legacy support for reading/deleting older MEGA files. New uploads always go to R2. |
| `LEGACY_MEGA_ROOT_OWNER_USER_IDS` | Optional comma-separated Supabase Auth IDs allowed to access older files stored in the MEGA root. |

Do not put R2 credentials, media signing secrets, or MEGA credentials in Vercel `NEXT_PUBLIC_*` variables, `.env.local.example`, or client code. The client only receives the media API URL.

## Local development

Copy `.env.local.example` to `.env.local`, fill in the R2 credentials and service variables, then run `npm run media-upload` and `npm run dev` in separate terminals. For local use, `FRONTEND_ORIGIN=http://localhost:3000`, `MEDIA_PUBLIC_ORIGIN=http://localhost:8787`, and `NEXT_PUBLIC_MEDIA_UPLOAD_API_URL=http://localhost:8787`. `/health` should return `{"ok":true}`.

## Existing MEGA files

New uploads are assigned IDs beginning with `r2_` and stored under `users/<supabase-user-id>/<file-id>`. Existing encrypted vault items with MEGA node IDs continue to use the legacy MEGA reader when `MEGA_EMAIL` and `MEGA_PASSWORD` are configured. Keep those credentials until the old files have been migrated or deleted. New uploads never go to MEGA.

## Security and operations

The bucket stays private. The service checks Supabase Auth on upload, media access authorization, and deletion; object keys are scoped to the authenticated user's ID. Stream URLs use HMAC-signed, four-hour tokens and support byte ranges for video playback. Deletion permanently removes the R2 object; deleting a vault item alone removes only its encrypted reference. The service sees uploaded file bytes before storing them, so its host operator is within the media trust boundary.

R2 storage and request charges/limits depend on the Cloudflare account and current plan. Monitor usage in Cloudflare Dashboard. `GET /health` checks that the process is alive; it does not verify credentials or connectivity to the R2 bucket.
