# Upstream sources

| Source | Inspected revision | Role |
| --- | --- | --- |
| [Greenlight Web Only](https://github.com/pccr10001/greenlight-webonly/tree/3e91e033bc15713673acf2535625780675c806ea) | `3e91e033bc15713673acf2535625780675c806ea` (manifest 2.3.1) | Primary UI reference and xHome service behavior |
| [Greenlight](https://github.com/unknownskl/greenlight/tree/baa4072cbe1583e76b6271a82e8eda7d46fcf9b9) | `baa4072cbe1583e76b6271a82e8eda7d46fcf9b9` | Electron, browser, platform and Pages architecture reference |
| [xbox-xcloud-player](https://github.com/unknownskl/xbox-xcloud-player/tree/a6511a645736f4988f77323284c6f0f36bf93aef) | `a6511a645736f4988f77323284c6f0f36bf93aef` | WebRTC, channels, controller and signaling |
| [Player npm release source](https://github.com/unknownskl/xbox-xcloud-player/tree/175e7cca64f873f72d8d13d5acbbf29a2942ee4f) | `175e7cca64f873f72d8d13d5acbbf29a2942ee4f` (1.0.0-beta7) | Pinned browser dependency |

Greenlight Web Only's yarn.lock resolves player 0.2.11. XStream uses the inspected 1.0.0-beta7 API. The browser package includes channel handling and input packet serialization. The player's Express example server is a protocol reference, excluded from the production architecture. Greenlight Web Only's Express WebSocket bridge, Electron IPC, file-based token store, Nextron export and desktop build workflows depend on a host process. XStream replaces that boundary with fetch handlers and a same-origin Pages binding.

The original Greenlight checkout includes a newer multi-package platform, a tRPC Pages Worker and desktop renderer. The fork's renderer and console workflow remain the visual reference. Upstream tests and CI target their respective Electron, Node, webpack and Jest environments. XStream exercises its Worker and React integration separately.

Greenlight is MIT licensed. The streaming package declares MIT in its manifest. Greenlight's license is included in the served notices.

## Device authorization

The player-facing flow follows Microsoft's consumers v2 device authorization and token endpoints. The xal-node MSAL adapter at `4e7f905468b0af67248e2b467f6c76ecf20e1e73` demonstrates Xbox sign-in and the public-client console transfer request. XStream defaults to the public Xbox client ID used by upstream `xal-node` revision `34d0d6a3e08ee2441e1f5b9c6d1793c66ad22ebc`, permits an operator override, and uses Microsoft's returned verification URI. Microsoft controls that app registration; live grants remain unverified. [Microsoft device flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) · [Upstream MSAL adapter](https://github.com/pccr10001/xal-node/blob/4e7f905468b0af67248e2b467f6c76ecf20e1e73/src/msal.ts)

## Cloud protocol evidence

The installed player release implements `startStream(type, target)` with a cloud title ID, empty server ID and the cloud session path. XStream translates the request in its Worker so the service bearer stays server-side. The browser imports the same released player and Gamepad modules for either mode. [Player play request](https://github.com/unknownskl/xbox-xcloud-player/blob/175e7cca64f873f72d8d13d5acbbf29a2942ee4f/src/apiclient.ts)

Greenlight Web Only uses the regional v2 titles and MRU endpoints and hydrates product IDs using Game Pass RemoteHighSapphire0 metadata. Its stream manager responds to ReadyToConnect with a transfer grant and monitors provisioning for both modes. XStream checks the state immediately after transfer acknowledgement, then resumes timed polling if provisioning is still in progress. [Title manager](https://github.com/pccr10001/greenlight-webonly/blob/3e91e033bc15713673acf2535625780675c806ea/main/helpers/titlemanager.ts) · [Session manager](https://github.com/pccr10001/greenlight-webonly/blob/3e91e033bc15713673acf2535625780675c806ea/main/helpers/streammanager.ts)

The MIT-licensed xal-node MSAL adapter constructs the offering-specific login host, XSTS request body and current subscriber/free-to-play offerings. Better xCloud was inspected for its distinction between home and cloud login handling. Its code is MIT licensed and serves as a reference only. Existing Greenlight and player notices continue to apply to distributed assets. [MSAL implementation](https://github.com/pccr10001/xal-node/blob/4e7f905468b0af67248e2b467f6c76ecf20e1e73/src/msal.ts) · [Better xCloud reference](https://github.com/redphx/better-xcloud/tree/ea4d19f2800cee9cfa387a0c9c37b3711cf208c7)

Cloud catalog metadata is fetched in groups of up to 100 product IDs, following Greenlight desktop’s title manager at `baa4072cbe1583e76b6271a82e8eda7d46fcf9b9`. The public Game Pass products response for `BT5P2X999VH2` returned a product-ID-keyed object with tile, poster, hero and titled-hero image URLs. The account-specific titles response determines entitlement before metadata lookup and again at launch. When a session reports WaitingForResources, Greenlight Web Only at `3e91e033bc15713673acf2535625780675c806ea` calls `GET /v1/waittime/{titleId}`; XStream reads estimatedTotalWaitTimeInSeconds while continuing to poll the owned session for its actual state.

## xHome signaling and player integration

XStream samples browser WebRTC statistics when the diagnostics panel is open and the page is visible. The player patch initializes the separate upstream debug-overlay sampler on its first use. This avoids a second statistics timer during playback. The received video bitrate uses the difference between successive inbound RTP byte counters and their report timestamps.

The player release's `src/apiclient.ts` implements console discovery at `GET /v6/servers/home` and stream creation at `POST /v5/sessions/home/play`. The Worker checks the selected console against that account's list before sending its server ID. The application session owns a D1 handle bound to the returned upstream ID and region. The Worker sends the deployed site's hostname in device metadata. Acceptance of the deployment's app registration and metadata needs a real account test.

`src/lib/stream.ts` defines provisioning, the transfer-token POST on ReadyToConnect, the SDP version ranges, the batch of JSON-encoded ICE candidates, the JSON-in-string exchange response, keepalive and DELETE. `src/example/stream.ts` shows the browser sequence. The application adds bounded waiting, cancellation, strict Worker routes and cleanup. Neither a stored handle nor a console server ID grants access without its owner's application session.

`src/player.ts`, `src/render/{audio,video}.ts`, `src/channel/`, and `src/input/gamepad.ts` implement peer connection, codec preferences, native media elements, Xbox message/control/input channels, frame packing, axes, triggers and button mapping. The browser attaches the gamepad when the message-channel handshake starts input. The bitrate setting caps video bandwidth in SDP. The upstream player reports a 1920 × 1080 display and does not expose a selectable encoded resolution. The browser's fit preference affects presentation.

The pnpm patch applies to the shipped CommonJS modules. It propagates asynchronous RTC negotiation errors, limits Teredo derivation to recognizable complete Teredo addresses, handles missing controller buttons, cancels polling and frame callbacks on teardown, handles unsupported microphone permission queries and removes SDP dumps. The application does not expose microphone capture or rumble. Console discovery displays the first upstream page, matching the pinned client's discovery method. The capture and controller fixtures in the loopback test exercise browser transport on one machine. Hardware compatibility and external NAT traversal require separate testing.

For cloud input selection the Worker reads details.supportedInputTypes from the entitled title. The input values MKB and NativeTouch follow Better xCloud revision ea4d19f2800cee9cfa387a0c9c37b3711cf208c7. The browser uses the input queues and touchinputenabledchanged message in xbox-xcloud-player revision 175e7cca64f873f72d8d13d5acbbf29a2942ee4f. Its pointer packet writer emits contact ID zero, so direct touch tracks one contact. The on-screen controller supports simultaneous buttons and sticks through gamepad reports.

## Account profile

The Worker requests a separate Xbox Live XSTS ticket for the signed-in user's profile. It sends the XSTS user hash and ticket in the XBL3.0 authorization header to the profile service and requests Gamertag and GameDisplayPicRaw with contract version 2. Profile display data is cached with the encrypted session credentials. [Xbox GDK profile settings, version 2](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/live/rest/uri/profilev2/uri-usersuseridprofilesettingsget?view=gdk-2610)

## In-game text entry

The pinned player identifies system UI capability 10 as ShowVirtualKeyboard. XStream advertises it when the browser has a keyboard handler. The ordered message channel carries the prompt title, description, default text and maximum length. Done responds with a TransactionComplete containing Text, and Cancel responds with ReceiverCancel for the original transaction ID. [XStreaming keyboard handling at 631cf32](https://github.com/Geocld/XStreaming/blob/631cf32a1670453a80d865d7f2b2783e15014543/src/pages/NativeStream.tsx#L533-L624)

The player patch also removes raw RTC, message and input payload dumps from the browser console. In the pinned release, `dist/channel/input/queue.js` normally waits for video metadata, while `dist/channel/input/packet.js` uses one-byte counts. The patched queue drains pending input on the existing 16 ms poll and bounds batches at 16 frames per input type during stalls. The regression fixture exercises ordering, bounded packets and idle polling without video.

## Optional TLS TURN relay

Cloudflare Realtime's [credential API](https://developers.cloudflare.com/realtime/turn/generate-credentials/) issues short-lived ICE credentials server-side. XStream filters the returned list to `turns:turn.cloudflare.com:443?transport=tcp` and configures the existing player peer with relay-only ICE before creating its offer. This does not change Xbox SDP or signaling formats. The browser-to-TURN leg uses TLS/TCP; TURN-to-peer connectivity remains subject to the Xbox candidate path. Live Xbox acceptance has not been performed.
