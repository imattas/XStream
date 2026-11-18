# Verification

Run from the repository root with Node 24:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

On a clean Linux CI host use `pnpm exec playwright install --with-deps chromium`. Tests build the API Worker in memory for workerd. Browser tests use the production client built by `pnpm build`.

## Coverage

* Authentication tests exercise device-code polling, slowdown, cancellation, replay prevention, encryption, session expiration, revocation, token refresh and upstream failures.
* The runtime suite runs the Pages forwarding function and API in separate workerd isolates connected by a service binding. D1 receives the production migrations. A local outbound service supplies Microsoft and Xbox responses. The test pairs a browser using its HttpOnly cookie, lists a console, creates an owned session, supplies the transfer token server-side, ends the stream, and verifies logout.
* Player tests cover the WebRTC and input adapter. Chromium tests cover navigation, error recovery, settings persistence and controller events. The local peer fixture negotiates an actual WebRTC connection with the packaged player and plays synthetic audio and video while receiving the gamepad report over a data channel.
* Wrangler packages both the API and the Pages Function. The Vite development proxy was also checked against a separately running local Wrangler instance.

The runtime suite also verifies subscriber denial, cloud catalog hydration, title selection, cloud session reservation, rejection of cross-mode handles and disconnect through the Pages binding. Both modes have Chromium loopback coverage. Browser navigation tests switch modes using the console dashboard and catalog.

## Cloud Gaming acceptance (unverified)

1. Apply D1 migration 0003 and publish the Worker and Pages build on the configured HTTPS origin. Use a Microsoft registration authorized for streaming and an account eligible for Cloud Gaming in its region.
2. Sign in once. Open Cloud Gaming, confirm titles and art appear, search for a known entitled title, and verify Recently played when the account has history.
3. Launch the game. Observe provisioning or queueing, then check the game name, moving video, audible sound, controller input, fullscreen and statistics. Interrupt the network and exercise reconnect.
4. Disconnect, start a home console stream, then go back and launch another cloud game. Try a second tab while playing and verify the first session stays active. Check that controller input stops when leaving playback.
5. Repeat with an account limited to free-to-play and one denied both offerings. Confirm the available games or error matches each account. Try a title outside the account entitlement. Confirm Remote Play remains available to a console-enabled account.
6. Sign out, revisit a streaming link and verify the login screen appears. Record which combinations passed, with the browser version, region, account eligibility and time. Keep credentials and raw signaling out of the record.

## External acceptance

Use an authorized production registration and your own console. Record browser, console model, network topology, observed resolution and test time. Keep provider tokens, raw SDP and ICE addresses out of reports.

1. Sign in from the custom HTTPS origin, enter the displayed code on the verification page and confirm XStream opens the dashboard and the expected console is listed.
2. Select the console and verify that it reaches connected state. Verify moving video and audible game audio. Check the statistics while playing.
3. Test both sticks, triggers, face buttons and D-pad in a game. Disconnect and reconnect the controller. Verify input also works in fullscreen.
4. Interrupt the network briefly, observe recovery or the reconnect action, then disconnect. Start a second session to confirm the first released the console.
5. Repeat on the target networks and console models. Include a remote network when assessing out-of-home support. Confirm account logout invalidates the old session.

The automated services simulate authorization outcomes and session availability. Only the external acceptance run establishes that a specific Microsoft registration, console, and network work together.

