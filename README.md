# XStream

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/imattas/XStream)

The button starts Cloudflare’s new-project flow, which copies this repository; it does not update the existing zemi.gg Worker or preserve its production-only PIN gate. The repository currently includes a legacy Pages configuration, so this new-project flow has not been verified. For the existing Worker, use the deployment steps below.

Xbox Remote Play and Xbox Cloud Gaming in a browser, using a Greenlight-derived frontend and the xbox-xcloud-player engine. A Cloudflare Worker serves the interface at https://zemi.gg, signs users in, discovers consoles and cloud titles, and handles signaling for both services. The browser plays the WebRTC stream and sends controller input.

**Verification status.** The app has been exercised locally with workerd, D1, mocked Microsoft/Xbox services and a Chromium WebRTC loopback peer. Live Microsoft grant issuance and console playback require external verification. A new Entra app registration by itself does not establish xHome or console-transfer entitlement. See [authentication requirements](docs/AUTH.md) before provisioning.

## Run locally

Use Node.js 24 and pnpm 11.25.0. From the repository root:

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example apps/worker/.dev.vars
pnpm dev
```

On macOS/Linux use `cp .env.example apps/worker/.dev.vars`. Open [XStream locally](http://127.0.0.1:5173). The development command applies the D1 migrations, starts Vite on port 5173 and starts Wrangler on port 8787. The public browser origin is the first address. You can open the sign-in screen with empty credentials. For Microsoft pairing, set the Worker encryption key. XStream defaults to the public Xbox client ID used by the upstream player; set `MICROSOFT_CLIENT_ID` to override it. Players request a code in XStream and approve it at the Microsoft link shown. Use the HTTPS custom domain for production.

Generate a fresh encryption key in a private terminal and place it only in the Worker's secrets:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## Operate the player

Enable Remote Play on your Xbox, sign in to XStream with the account that has access to the console, then open **My Consoles** and select **Start stream**. Pair a standard-mapped controller with the browser device and press a button to make it visible to the browser. The settings screen stores display fit, bitrate preference, reconnect preference, deadzone and button-swap preferences in this browser. The streaming toolbar provides connection state, fullscreen, playback controls, diagnostics and disconnect.

WebRTC needs a reachable candidate path to the Xbox session. The Xbox service determines the offered stream and network routes. A bitrate preference can influence negotiation. The displayed resolution, frame rate and round-trip time come from browser statistics. Hardware rumble, microphone, and remote-network reliability are outside the verified feature set.

## Deploy a custom domain

Production uses a single Cloudflare Worker for static assets and same-origin API requests at [zemi.gg](https://zemi.gg). The production configuration binds the XStream D1 database and disables Workers.dev and preview URLs. The separate local Worker configuration is used by the development server.

From the repository root, run the following for subsequent releases with an authorized Cloudflare account:

```sh
pnpm install --frozen-lockfile
pnpm db:remote
pnpm build
pnpm deploy:worker
```

Production sign-in uses the Worker secret `TOKEN_ENCRYPTION_KEY`. The optional `MICROSOFT_CLIENT_ID` binding overrides the upstream public client ID; an existing binding takes precedence. Keep the encryption key stable across releases so existing sessions can still be read. [Authentication requirements](docs/AUTH.md)

## Update the existing PIN-protected Worker

The PIN wrapper is intentionally not present in the current GitHub source. To preserve the PIN when updating the existing `xstream` Worker, create a separate local worktree, restore the wrapper and production configuration from the existing Git history, and deploy from there. Run these commands in PowerShell from a clean XStream checkout on `main`:

```powershell
git pull --ff-only
git worktree add --detach ../XStream-cloudflare HEAD
Set-Location ../XStream-cloudflare
git restore --source 07551a6 -- apps/worker/src/production.ts wrangler.production.jsonc
pnpm install --frozen-lockfile
pnpm build
pnpm exec wrangler login
pnpm exec wrangler deploy --config wrangler.production.jsonc
```

Authenticate as the Cloudflare account that owns `zemi.gg`. These commands use the existing Worker and D1 binding; they do not commit the PIN wrapper or change GitHub. Preserve the existing Worker secrets, including `SITE_PIN`, `MICROSOFT_CLIENT_ID`, `TOKEN_ENCRYPTION_KEY`, and the three `TURN_` secrets. Review Wrangler's target and output before proceeding. The PIN wrapper applies to pages and API requests. After deployment, verify the PIN screen, sign-in, and playback. Cloudflare's Deploy to Cloudflare button creates a separate project and is not a substitute for this update procedure.

## Repository

| Path | Contents |
| --- | --- |
| `apps/web` | Vite React application, Greenlight assets, settings, player and controllers |
| `apps/worker` | Authentication, D1 migrations, xHome and xCloud requests and signaling |
| `functions/api` | Pages-to-Worker service binding |
| `patches` | Versioned fixes to the upstream player |
| `tests` | Authentication, Worker-runtime and browser integration tests |
| `.github/workflows` | Continuous integration |

[Specification](SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [Upstream revisions](docs/UPSTREAM.md) · [Testing and hardware acceptance](docs/TESTING.md)

## Unified streaming migration

See the [implementation report](docs/MIGRATION.md) for changed files, verification results and live acceptance steps. Apply migration 0003 before publishing the updated Worker.

## Original Remote Play implementation report

On November 18, 2026 the frozen install, ESLint and strict TypeScript checks passed. Vitest passed 19 tests across four suites. Playwright passed all six Chromium tests against the production frontend. Chromium played synthetic audio and 320 × 180 video through the shipped player, exchanged ICE with a local peer, and sent binary controller reports after the message handshake.

Vite built the frontend, Wrangler bundled the API Worker (31.14 KiB, 8.78 KiB gzip), and the Pages Function compiled. Both migrations applied to local D1. Local Wrangler Pages served a frontend deep link with CSP and forwarded the health request through the API binding. The workerd tests exercised sign-in, credential exchange, console discovery, session creation, transfer and disconnect against mocked services.

| Upstream | Version or checkout | Commit |
| --- | --- | --- |
| Greenlight Web Only | 2.3.1 | `3e91e033bc15713673acf2535625780675c806ea` |
| Original Greenlight | Inspected checkout | `baa4072cbe1583e76b6271a82e8eda7d46fcf9b9` |
| xbox-xcloud-player | Inspected checkout | `a6511a645736f4988f77323284c6f0f36bf93aef` |
| xbox-xcloud-player | Integrated npm 1.0.0-beta7, patched locally | `175e7cca64f873f72d8d13d5acbbf29a2942ee4f` |
| xal-node | Authentication reference | `4e7f905468b0af67248e2b467f6c76ecf20e1e73` |

Device-code sign-in now opens Microsoft’s verification link. Live Xbox streaming grants require separate verification. Console discovery uses the first results page supported by the upstream adapter. The console negotiates encoded resolution. Display fit and a video bitrate cap are configurable. The settings are local to the browser.

Outstanding external acceptance includes issuing live Microsoft and Xbox grants, deploying to the chosen Cloudflare domain, and playing on a physical Series X/S with a controller on the intended networks. Follow the deployment commands above and the hardware acceptance steps in the testing guide.


## Optional TLS relay for restrictive networks

XStream can use Cloudflare Realtime TURN over TLS on TCP port 443 for both streaming modes. This still uses WebRTC and will not work if the browser or network blocks TURN TLS or WebRTC itself. Relay connections may add latency. Standalone TURN is billed by Cloudflare; review current pricing before enabling it. The Xbox peer must also be reachable from Cloudflare. This path has not been verified with a live Xbox or on a restricted network.

Create a Cloudflare Realtime TURN key in the Cloudflare dashboard. Keep its API token secret. After signing in to the deployed XStream, identify your account's `user_id` in the remote D1 `auth_sessions` table. For example, `pnpm exec wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT DISTINCT user_id FROM auth_sessions WHERE expires_at > unixepoch() * 1000"`. If multiple accounts have signed in, distinguish your account before proceeding; do not copy another user's ID. Set these Worker secrets using `pnpm exec wrangler secret put NAME --config wrangler.production.jsonc` for each name:

- `TURN_KEY_ID`: the TURN key ID.
- `TURN_KEY_API_TOKEN`: that TURN key's API token, not a browser credential.
- `TURN_ALLOWED_USER_ID`: your account's exact `user_id` from D1. Only this account can obtain relay credentials.

For local testing use the same variable names in `apps/worker/.dev.vars` and use the matching local D1 account ID. Restart the development server after editing secrets. In XStream, open **Settings → Streaming → Use TLS relay**, then start a new stream. Turn it off to return to the normal connection. TURN credentials last 12 hours; a session that exceeds that period must reconnect. Never place the TURN key API token in the frontend or commit it to Git.

Connection failures display a stage code: `XS-BROWSER` (browser feature check), `XS-RELAY` (relay credentials/configuration), `XS-SESSION` (Xbox session creation), `XS-PROVISION` (Xbox readiness), `XS-SIGNAL` (SDP exchange), `XS-ICE` (ICE candidate exchange), `XS-TIMEOUT` (connection setup timed out), `XS-CONNECTION` (peer connection ended), or `XS-KEEPALIVE` (session heartbeat). The code identifies the failing stage, not necessarily the underlying cause. Include the code and displayed message when troubleshooting, but do not share credentials.
