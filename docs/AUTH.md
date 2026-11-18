# Microsoft and Xbox authentication

## Player sign-in with a pairing code

Configure a Microsoft application ID for personal Microsoft accounts with public client flows enabled. Set `MICROSOFT_CLIENT_ID`, `APP_ORIGIN` and the Worker encryption key and apply migration 0004. Players select Sign in with Microsoft, open the Microsoft verification URL, enter their code and leave XStream open until the dashboard appears. Device-code sign-in needs neither a client secret nor a redirect URI.

The Worker requests `xboxlive.signin offline_access` from the consumers device authorization endpoint. D1 stores the encrypted device code bound to a short-lived HttpOnly pairing cookie. A Cloudflare rate-limit binding allows up to 12 pairing starts per client IP per minute at each edge location. The Worker enforces polling intervals, backs off on slow-down, expires pending requests and consumes an approved transaction once. It exchanges the approved account token for Xbox identity and issues the existing XStream session cookie. Device-grant refresh and console transfer use the public client ID. Live entitlement for the host's registration needs separate verification. [Microsoft device authorization](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)

The Worker presents the access token as an RPS ticket at Xbox user authentication. After Xbox confirms the user, the Worker creates a fresh seven-day app session. The browser receives an opaque `__Host-` cookie with `Secure; HttpOnly; SameSite=Lax; Path=/`. D1 holds a SHA-256 digest of the random cookie and a pseudonymous digest of the Xbox user hash. The Worker requests gamertag, gamerpic and available profile statistics using a separate Xbox profile ticket. The browser receives the display data and the original session deadline. Open tabs sign out at the deadline and recheck on wake. Activity and token refresh do not extend the seven days. A successful subsequent sign-in replaces the earlier session in that browser. Logout removes the session immediately. State-changing API calls require the configured origin.

The Worker encrypts pairing codes and session grants with AES-256-GCM, a random 96-bit nonce and record-bound additional authenticated data. It serializes credential updates with expiring D1 leases, persists rotated refresh tokens before dependent Xbox calls and checks absolute session expiration on reads. A revoked Microsoft refresh grant invalidates the local session. Expired rows are pruned on subsequent logins. Replacing the encryption key invalidates the stored credentials and pending sign-ins. Plan for players to sign in again when rotating it.

## Live authorization status

A request to Microsoft's consumers device authorization endpoint with the Xbox scopes and no client ID returned HTTP 400, AADSTS900144, requiring the client_id parameter. An operator must configure an authorized public client ID for their deployment. Live code issuance, user approval, and downstream Xbox entitlements remain unverified. Once configured, press Sign in with Microsoft and open the returned verification URL. The lifetime and polling interval come from the same response. Approval must complete before the countdown expires.

## Xbox grants for Remote Play

| Stage | Request | Result used by the application |
| --- | --- | --- |
| Xbox user | `POST https://user.auth.xboxlive.com/user/authenticate` | User ticket and Xbox user hash |
| Streaming authorization | `POST https://xsts.auth.xboxlive.com/xsts/authorize` | XSTS token for `http://gssv.xboxlive.com/` in the RETAIL sandbox |
| Home offering | `POST https://xhome.gssv-play-prod.xboxlive.com/v2/login/user` | Service bearer and default Xbox region for discovery and signaling |
| Console transfer | `POST https://login.live.com/oauth20_token.srf` | On `ReadyToConnect`, a short-lived transfer credential sent by the Worker to the stream's connect endpoint |

The Xbox user exchange follows Microsoft's website documentation. Greenlight's MSAL adapter supplies the streaming relying party, xHome offering, and console-transfer scope. The Worker uses the configured client registration in both Microsoft grants. Xbox authorization errors surface as `xbox_streaming_access_denied`, `xhome_offering_denied` or `console_transfer_denied` in the API. The application never returns those credentials to browser code. A successful login can coexist with a denial at any later stage. [Upstream exchange implementation](https://github.com/pccr10001/xal-node/blob/4e7f905468b0af67248e2b467f6c76ecf20e1e73/src/msal.ts) · [Greenlight connect-token use](https://github.com/pccr10001/greenlight-webonly/blob/3e91e033bc15713673acf2535625780675c806ea/main/helpers/streammanager.ts)

## Cloud Gaming grants

Opening the cloud catalog triggers a separate offering grant using the existing Microsoft session, Xbox user ticket and streaming XSTS exchange. The Worker requests `xgpuweb` and, on offering denial, tries Microsoft's free-to-play offering `xgpuwebf2p`. Each offering chooses its own default region. The encrypted credential record caches home and cloud grants independently. Xbox decides catalog availability and authorizes each play request. A cloud denial leaves console access available.

## Upstream device-code reference

The player-facing login uses Microsoft's public-client device grant. Greenlight's device flow uses a fixed, separately provisioned client ID and its corresponding refresh token for the Passport console-transfer scope. The available evidence does not establish access to both xHome and that transfer scope for a separately registered operator-owned public client. Live acceptance requires a suitably provisioned XStream client and verification of the downstream grants. [Microsoft device authorization](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) · [Greenlight device grant and transfer grant](https://github.com/pccr10001/xal-node/blob/4e7f905468b0af67248e2b467f6c76ecf20e1e73/src/msal.ts)

## Verification

The authentication suite exercises device authorization, cancellation, replay, browser binding, expired transactions and sessions, origin validation, authenticated encryption, credential rotation after downstream failure, D1 leases, revoked refresh grants, and Xbox region validation. The runtime integration uses mocked Microsoft and Xbox services behind a real local Worker and D1. Production entitlement, grant issuance and hardware streaming require credentials and a physical console.
