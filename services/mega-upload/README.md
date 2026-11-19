# MEGA media upload service

This separate Node.js service accepts one local image or video per request and streams it to the configured MEGA account as a private file. It returns the MEGA file ID to the vault app, which encrypts that ID in the existing vault payload before saving it to Supabase. It does not create public MEGA share links for new uploads.

Keep this service outside Vercel Functions. Vercel Functions reject request bodies larger than 4.5 MB, which is too small for normal video uploads. Deploy this Node service on a host that supports streamed request bodies and configure its request-size and execution-time limits for the file sizes you want.

## Configure

Set these environment variables on the upload service:

| Variable | Purpose |
| --- | --- |
| `PORT` | Service port; defaults to `8787`. |
| `FRONTEND_ORIGIN` | Exact HTTPS origin of the vault app, such as `https://vault-zk.vercel.app`. |
| `MEGA_EMAIL` | Email for the MEGA storage account. |
| `MEGA_PASSWORD` | Password for the MEGA storage account. Store this only in the service host's secret settings. |
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project URL used by the app. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key used by the app; never use a service-role key here. |
| `LEGACY_MEGA_ROOT_OWNER_USER_IDS` | Optional comma-separated Supabase Auth IDs whose older files are in the MEGA root; new uploads are available to every signed-in user in separate folders. |
| `MEDIA_TOKEN_SECRET` | Random secret of at least 32 characters used to sign short-lived private playback/download URLs. |
| `MAX_UPLOAD_BYTES` | Maximum size per file in bytes; defaults to 250 MiB. |
| `MAX_FILES_PER_ITEM` | Maximum files selected in one vault item; defaults to 20. |

Get the allowed user's ID from Supabase Authentication → Users. Do not put MEGA credentials in the Next.js app's `NEXT_PUBLIC_*` variables, `.env.local.example`, or client code.

For local development, copy `.env.local.example` to `.env.local`, fill in the MEGA credentials and a random `MEDIA_TOKEN_SECRET`; keep `FRONTEND_ORIGIN=http://localhost:3000` and `NEXT_PUBLIC_MEGA_UPLOAD_API_URL=http://localhost:8787`. Install dependencies and run `npm run mega-upload` in one terminal and `npm run dev` in another. The service verifies every request with Supabase Auth and stores new uploads in a folder scoped to that user. `LEGACY_MEGA_ROOT_OWNER_USER_IDS` is optional and only preserves access to older files that were uploaded into the MEGA account root. The upload service reads `.env.local` for local development; `/health` should return `{"ok":true}` while it is running.

For deployment, set the variables above on the separate service host and set `FRONTEND_ORIGIN` to the app's exact HTTPS origin. The deployed service must use HTTPS. Set `NEXT_PUBLIC_MEGA_UPLOAD_API_URL` in the vault app's environment to the service's HTTPS base URL, then rebuild/redeploy the app.

## Data and limits

MEGA encrypts files at rest, and the new uploads remain private in the MEGA account. The app's service authenticates the signed-in Supabase account before issuing a short-lived signed stream URL; image/video access and direct downloads go through that service. Permanent deletion removes the file from the MEGA account. Removing an item from the app alone deletes its encrypted vault reference and leaves the file in MEGA.

MEGA quota and transfer limits still apply. `EBLOCKED (-16)` means MEGA rejected or blocked the account/API resource; the service pauses retries for 15 minutes rather than retrying on every gallery request. Check that the account can sign in at mega.nz and contact MEGA support if the block persists. The upload service uses the unofficial `megajs` JavaScript SDK; MEGA does not publish this as an official Node.js SDK. The free account's available storage may change, and the MEGA account must allow automated sign-in through this SDK.
