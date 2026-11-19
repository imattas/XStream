# XStream

Xbox Remote Play and Xbox Cloud Gaming in a browser, using a Greenlight-derived frontend and the xbox-xcloud-player engine. A Cloudflare Worker serves the interface at https://zemi.gg, signs users in, discovers consoles and cloud titles, and handles signaling for both services. The browser plays the WebRTC stream and sends controller input.

**Verification status.** The app has been exercised locally with workerd, D1, mocked Microsoft/Xbox services and a Chromium WebRTC loopback peer. Live Microsoft grant issuance and console playback require external verification. A new Entra app registration by itself does not establish xHome or console-transfer entitlement. See [authentication requirements](docs/AUTH.md) before provisioning.

## Run locally

Use Node.js 24 and pnpm 11.25.0. From the repository root:

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example apps/worker/.dev.vars
pnpm dev
```

On macOS/Linux use `cp .env.example apps/worker/.dev.vars`. Open [XStream locally](http://127.0.0.1:5173). The development command applies the D1 migrations, starts Vite on port 5173 and starts Wrangler on port 8787. The public browser origin is the first address. You can open the sign-in screen with empty credentials. For Microsoft pairing, configure the app’s public client ID with public client flows enabled and set the Worker encryption key. Players request a code in XStream and approve it at the Microsoft link shown. Use the HTTPS custom domain for production.

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

The production Worker checks a site PIN before serving pages, assets, or API requests. Set the PIN using `pnpm exec wrangler secret put SITE_PIN --config wrangler.production.jsonc`. Each browser unlock lasts seven days. Changing the PIN invalidates existing unlocks. Local development uses a separate entry point.

Production sign-in uses the Worker secrets `MICROSOFT_CLIENT_ID` and `TOKEN_ENCRYPTION_KEY`. Keep the encryption key stable across releases so existing sessions can still be read. [Authentication requirements](docs/AUTH.md)

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

Outstanding external acceptance includes issuing grants with the operator's Microsoft registration, deploying to the chosen Cloudflare domain, and playing on a physical Series X/S with a controller on the intended networks. Follow the deployment commands above and the hardware acceptance steps in the testing guide.

