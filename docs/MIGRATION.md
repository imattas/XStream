# Unified streaming implementation report

The existing XStream workspace now supports Remote Play and Cloud Gaming through the same React player, Xbox data channels, Gamepad adapter and playback settings. The workspace lacked Git metadata at inspection, so the local starting commit and a Git-based diff are unavailable.

## Implementation

| Area | Changed files | Result |
| --- | --- | --- |
| Mode and authentication | `stream-mode.ts`, `apps/worker/src/auth/provider.ts`, `apps/worker/src/auth/session.ts` | A shared mode selects an offering. Cloud credentials use the existing encrypted application session, encrypted record, renewal and Xbox identity check. |
| Worker | `apps/worker/src/index.ts`, `apps/worker/src/xbox/{cloud,home,routes}.ts`, `apps/worker/migrations/0003_stream_mode.sql` | Catalog and title checks use the cloud grant. Play uses the cloud title or home console payload. D1 reserves one stream per application session and checks mode and ownership before forwarding signaling. |
| Browser | `apps/web/src/App.tsx`, `apps/web/src/components/ui.tsx`, `apps/web/src/pages/{Cloud,Dashboard,Stream}.tsx`, `apps/web/src/streaming/client.ts`, `apps/web/src/styles.css`, `apps/web/public/_headers` | Navigation, search, details, cover art, recent titles and entitled play use the existing visual system. Disconnect, queue handling, reconnect, statistics and controller transport share the existing player lifecycle. |
| Verification | `tests/auth.test.ts`, `tests/runtime.test.ts`, `tests/e2e/{web,rtc-loopback}.spec.ts` | Covers the free offering, denial, catalog hydration, unavailable titles, mode isolation, navigation, termination and both player modes. |
| Documentation | `README.md`, `SPEC.md`, `docs/{ARCHITECTURE,AUTH,TESTING,UPSTREAM,MIGRATION}.md` | Architecture, migration order, upstream evidence and acceptance procedures. |

The cloud catalog route is `GET /api/cloud/catalog`. It includes the details displayed on each card. A selected game starts with `POST /api/cloud/session`. Signaling and DELETE use the opaque cloud session handle. Product metadata uses the US English catalog convention from Greenlight Web Only. If hydration is unavailable, the title ID identifies the game. Xbox selects the streaming region and enforces access at launch.

## Upstream

The installed MIT player is `xbox-xcloud-player@1.0.0-beta7` at release revision `175e7cca64f873f72d8d13d5acbbf29a2942ee4f`. The audit also inspected player HEAD `a6511a645736f4988f77323284c6f0f36bf93aef`, Greenlight `baa4072cbe1583e76b6271a82e8eda7d46fcf9b9`, Greenlight Web Only 2.3.1 `3e91e033bc15713673acf2535625780675c806ea`, xal-node `4e7f905468b0af67248e2b467f6c76ecf20e1e73` and Better xCloud `ea4d19f2800cee9cfa387a0c9c37b3711cf208c7`. Revision links, protocol evidence and license notes appear in the [upstream record](UPSTREAM.md).

## Local verification

Node 24.22.3 and pnpm 11.25.0 ran the following checks.

| Command | Result |
| --- | --- |
| `pnpm exec playwright install chromium` | Chromium available |
| `pnpm lint` and `pnpm typecheck` | Passed |
| `pnpm test` | 20 passed across four suites, including the Pages binding, Worker and migrated D1 with mocked providers |
| `pnpm build` | Vite built 116 modules. Wrangler bundled the API Worker at 36.61 KiB (10.24 KiB gzip) and compiled the Pages Function. |
| `pnpm test:e2e` | Eight Chromium tests passed against the production frontend. Both modes played synthetic video and audio and delivered controller reports to a local WebRTC peer. |
| `pnpm db:local` | Wrangler applied migration 0003 to the existing local D1 schema. |

## Production acceptance

Apply migration 0003 to the deployment database before publishing the updated Worker and Pages assets. Production still uses Pages, a private Worker service binding and D1. WebRTC media travels directly between browser and Xbox service.

Production deployment, live Microsoft grant issuance, subscriber and free-to-play access, physical console playback and live cloud playback remain unverified. The [acceptance guide](TESTING.md) covers account eligibility, real video and input, network recovery, switching modes and logout.
