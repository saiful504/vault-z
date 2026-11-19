# vault-zk

Zero-knowledge personal data vault: Next.js App Router, Tailwind CSS, and Supabase (free tier). Passwords, NID numbers, passport numbers, and notes are encrypted in the browser with the Web Crypto API. The master password never leaves the client.

## Account and vault passwords

1. **Account password** — used with your email address to sign into Supabase Auth. Phone number is optional profile information only.
2. **Vault master password** — derives an AES-GCM key with PBKDF2 (SHA-256, 600,000 iterations). It is kept only in memory (`CryptoKey` in React state). Closing the tab locks the vault.

If you forget the master password, the ciphertext cannot be recovered. That is by design.

After signing in and creating the vault, you can enable biometric unlock for the current browser/device. On later visits, sign into the account and use the biometric button to unlock the vault.

When adding a vault item, choose **Document** to upload a JPEG, PNG, or WebP image. The original upload is ready to save immediately; opening the editor to adjust the crop, clean, or sharpen it is optional. Crop corners can be dragged or fine-tuned with exact positions. Image processing happens in the browser; the scan is encrypted with the vault key and only shown in the item list after you reveal it. You can download the processed scan in the same format as the uploaded image. Images up to 15 MB can be uploaded, and processed scans are size-limited before saving.

Choose **Media** to upload up to 20 local images or videos to the configured MEGA account. Each signed-in user gets a separate MEGA folder. Their private MEGA file IDs are encrypted in the vault payload; the gallery loads previews as needed, plays videos, and exports files to the device. You can optionally save an encrypted offline copy in this browser, clear that copy while keeping the gallery and MEGA file, or permanently delete the MEGA file. This requires deploying the separate [MEGA upload service](services/mega-upload/README.md); the app's Vercel functions cannot accept normal video-sized request bodies.

## Setup

1. Create a free [Supabase](https://supabase.com) project.
2. In Authentication → Sign In / Providers, keep **Email** enabled and turn off **Confirm email** to allow immediate signup without configuring email delivery. Phone auth is not required; phone number is optional profile information.
3. Open the Supabase SQL Editor and run [`supabase/schema.sql`](supabase/schema.sql). This creates the encrypted vault tables and their row-level security policies; it is safe to run on an existing schema.
4. Copy [`.env.local.example`](.env.local.example) to `.env.local` and fill in the project URL and **anon / publishable** key. Never put the `service_role` key in this app.
5. Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Deploy the app behind HTTPS to install it on Android: open the deployed URL in Chrome, open the browser menu, and choose **Install app** or **Add to Home screen**. The installable PWA requires an internet connection for Supabase-backed sign-in and vault sync; the master key is still kept only in browser memory.

Register and sign in with an email address and password. If email confirmation is enabled, Supabase sends a confirmation link; this requires email delivery. For local testing without an email provider, turn off **Confirm email** in Supabase Auth settings.

For Vercel deployments with email confirmation enabled:

1. In Vercel, set `NEXT_PUBLIC_SITE_URL` to your app's canonical HTTPS URL (for example, `https://your-app.vercel.app`) and redeploy. If unset, signup uses the current browser origin.
2. In Supabase, open Authentication → URL Configuration. Set **Site URL** to that same deployed URL and add `https://your-app.vercel.app/auth/callback` to **Redirect URLs**. Add your custom domain callback too if you use one.
3. Request a new confirmation email after changing these settings. Existing emails may still contain the old `localhost` link.

## Offline demo (development only)

To test email/password signup, login, and the encrypted vault without connecting to Supabase, set this variable in `.env.local`:

```dotenv
NEXT_PUBLIC_DEMO_MODE=true
```

Restart `npm run dev`, open `/signup`, and enter an email address, an account password of at least 8 characters, and an optional phone number. The demo stores account and vault data in this browser's local storage; vault item contents remain encrypted with the vault master password. This is a local UI demo, not production authentication. It activates only in development and is unavailable in production builds. Clear this site's storage to reset the demo. Set `NEXT_PUBLIC_DEMO_MODE=false` to use Supabase again.

## Biometric unlock

1. Sign in with your email and account password and unlock the vault with its master password.
2. In the unlocked vault, enter the master password again and choose **Enable on this device**.
3. Approve the device's fingerprint, Face ID, or platform authenticator prompt. On a later visit, sign in to Supabase and choose **Unlock with biometrics**.

This requires HTTPS (localhost is allowed), WebAuthn, and an authenticator/browser that implements the WebAuthn PRF extension. If PRF is unavailable, use the master password; the app does not store an unwrapped or exportable vault key. The IndexedDB envelope is encrypted using a key derived from the authenticator's PRF output. Clear browser site data to remove that local envelope. This initial schema supports one enrolled credential per account; enrolling another device replaces the previous credential.

## What the server sees

Supabase stores `user_id`, timestamps, a KDF salt, ciphertext + IV, and WebAuthn credential metadata (`credential_id`, public key, transports, and PRF salt). Title, category, notes, secrets, processed document images, and private MEGA file IDs are inside the encrypted payload. The separate MEGA upload service receives selected file bytes before streaming them to MEGA; host it yourself and trust its operator. MEGA stores the uploaded files privately and encrypts them at rest. The biometric metadata is not a Supabase login credential: account authentication still requires the email address and account password, and biometric unlock only restores the local vault key after the account is signed in.

## Security caveats

This protects vault-item plaintext **relative to Supabase and the Next.js server**, but the MEGA upload service handles media bytes before they reach MEGA. It does not protect you from XSS, a compromised device, a weak master password, or metadata leaks (item count, timestamps). WebAuthn is used as a local user-verification gate, not as server-verified authentication; an XSS compromise running on the trusted origin can still attack an unlocked vault or request authenticator interaction. Envelope format `version: 1`.
