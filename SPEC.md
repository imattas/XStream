# XStream

XStream connects a browser to the signed-in user's Xbox Series X or Series S or to an entitled Xbox Cloud Gaming title. The application uses a Greenlight-derived console dashboard, a Cloudflare Worker for Microsoft authentication and mode-specific signaling, and xbox-xcloud-player for media and input.

## User flow

1. Sign in with a personal Microsoft account using an Xbox-enabled application registration.
2. Discover the account's consoles and choose one configured for Remote Play.
3. Create an xHome session, authorize the transfer, exchange SDP and ICE, and play through the browser.
4. Inspect connection and controller status, change supported playback preferences, enter fullscreen, reconnect, or end the session.

Cloud Gaming uses the same sign-in, settings, player and controller. Open Cloud Gaming, search the account catalog, select a title and press Play. Disconnect before switching targets.

## Deployment boundary

Cloudflare Pages serves the Vite build. A Pages Function forwards same-origin API calls over a private service binding. The API Worker owns credential storage, session checks and upstream calls. The browser establishes the WebRTC connection and sends Gamepad API input through the player's data channels.

## Acceptance

The strict TypeScript builds, lint, Worker-runtime checks, mocked protocol tests, browser navigation tests and production packaging must pass. A separate hardware acceptance run requires an approved Microsoft registration, an Xbox-enabled account, a configured console, a compatible browser and controller, and a network path for WebRTC. See docs/TESTING.md for acceptance criteria.
