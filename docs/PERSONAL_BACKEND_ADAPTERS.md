# Personal backend adapter integration map

Reviewed against the public default-branch source on 2026-11-04. This is an integration map, not a claim that either adapter is implemented or that remote exposure is safe.

## Universal edition

- The Universal edition remains backend-neutral and may load any explicitly installed adapter that satisfies the Office Kit adapter contract.
- It must not bundle or require DGM-MAT or VST.
- Adapter selection and connection require explicit owner action. Start read-only. Unknown capabilities remain unavailable.

## Personal DGM-MAT edition

Repository: `AndreVazao/DGM-MAT`.

### Candidate read-only data

| Office Kit view | DGM-MAT route | Current security classification |
|---|---|---|
| Runtime health | `GET /runtime/health` | local-client session |
| Runtime status | `GET /runtime/status` (summary; no source timestamp) | local-client session |
| Runtime truth/state | `GET /runtime/state` (primary snapshot; includes `timestamp` in seconds), `GET /runtime/truth` | local-client session |
| Agents and mission activity | `GET /runtime/office/telemetry`, `GET /runtime/missions/page` | local-client session |
| Capability inventory | `GET /mobile/capabilities` | local-client session |
| Self/workspace audit | `GET /governance/audit/self`, `GET /governance/audit/workspace` | operator session |

### Authentication and safety

- DGM-MAT has `LocalSessionAuthMiddleware` and short-lived bearer sessions. The `/auth/session` bootstrap exchange is loopback-only and uses the protected local bootstrap credential.
- Remote pairing is a separate one-time pairing-code flow (`GET /auth/pairing-code` on the PC, then `POST /auth/pair`) with short expiry. Office Kit must not try to reuse the loopback bootstrap secret remotely.
- Never connect to the unauthenticated WebSocket routes `/ws` or `/runtime/ws`; they are explicitly identified as currently unauthenticated in the route inventory.
- The first adapter must be GET-only and use only an authenticated local-client session for the minimal runtime snapshot. Operator-scope audits and all POST actions remain outside the first slice.
- Keep DGM-MAT bound to loopback until its own owner-approved private-network authentication gate is verified. Do not expose the API to LAN/Tailscale merely because discovery succeeds.

## Personal VST edition

Repository: `AndreVazao/VazaoSovereignTrader`.

### Candidate read-only data

| Office Kit view | VST route |
|---|---|
| Engine status and trading overview | `GET /status` |
| Liveness only | `GET /health` |
| Engine and market diagnostics | `GET /diagnostics`, `GET /market-data-health` |
| Venue health | `GET /venue-health` |
| Evidence/readiness | `GET /evidence-scorecard`, `GET /execution-surfaces`, `GET /execution-surfaces/runtime` |
| Pending operator interventions | `GET /human-interaction/pending` |

### Authentication and safety

- The documented local API uses `VST_LOCAL_TOKEN`; private status/diagnostic routes require `read_private_state`.
- The existing virtual-office integration map specifies the `X-Token` header for the browser shell and forbids tokens in URLs, browser storage and logs. The adapter must follow the currently tested server contract rather than inventing a new one.
- `GET /health` is liveness only and must never be interpreted as proof that the engine is ready or trading is authorized.
- The first adapter must be GET-only. Do not expose order, REAL, mode, start/stop, pairing, file-upload or execution-surface mutation routes through the initial Office Kit integration.
- Preserve PAPER-only/read-only truth labels and show source timestamps/staleness. A timeout after any future mutation must become outcome-unknown/reconcile, never automatic replay.

## Shared implementation requirements

- Implement two separate adapters behind the same versioned Office Kit adapter contract; do not add either backend's imports or models to the generic core.
- Keep DGM-MAT and VST endpoint bases, credentials, sessions and caches in separate installation namespaces.
- Credentials must be supplied through a secure owner-controlled pairing/configuration flow and stored only in the platform keystore. Never place credentials in profile JSON, logs, URLs or browser local storage.
- Use bounded timeouts, cancellation, polling backoff, sequence/freshness metadata and strict response allowlists. Do not copy arbitrary backend payloads into the visual model.
- If authentication, authorization, endpoint identity or data freshness cannot be verified, show disconnected/unverified and suppress operational claims.
- Do not create missions, send chat messages, approve actions, execute repairs, start/stop engines or submit trading commands in this read-only phase.

## Implementation status — updated 2026-11-04

- Product edition profiles and adapter allowlists are merged into `main` (PR #19).
- The first DGM-MAT read-only adapter was merged in PR #20; endpoint hardening is under review in PR #21.
- It is loopback-only, accepts only GET `/runtime/status` only, requires an injected short-lived local-session token provider, and exposes only `read_state`.
- It does not read the protected bootstrap credential, create sessions, pair remote devices, store tokens, call WebSockets, or issue write requests.
- The adapter work branch now reads `GET /runtime/state`, whose `RuntimeTruthState.timestamp` is the source-state update time in seconds since epoch. Office Kit converts it to UTC and accepts it only inside a 30-second freshness window; missing, future or stale timestamps remain unverified.
- DGM-MAT applies provider-level freshness separately inside the serialized state. A fresh top-level timestamp does not prove every provider observation is fresh; the adapter must preserve those distinctions.
- Agent/task collections remain empty until a stable per-record mapping is reviewed. This deliberately avoids inventing activity from unvalidated payloads.
- `DgmMatLocalSessionProvider` exists and keeps the short-lived access token in memory, but the native host still lacks a durable OS credential store/wiring for the protected bootstrap credential. Live tests against the running DGM-MAT PC remain pending.
- VST adapter remains unimplemented.

This integration map was derived from repository documentation and source review. End-to-end authentication and live contract tests against running local instances remain required before enabling either adapter.

## DGM-MAT local session provider — integrado no core; host wiring pendente
- `DgmMatLocalSessionProvider` foi integrado na main pela PR #22 (`69946aaa01f22ab243dd0b785dd1dff5b190c2f5`) e troca o bootstrap protegido por uma sessão local de curta duração através de `POST /auth/session` em `127.0.0.1:8181`.
- The bootstrap credential is fetched on demand from an injected host keystore provider and is not persisted or cached by Office Kit. The returned access token is held in process memory only, bounded to the server's 30-minute maximum, and refreshed before expiry.
- Session responses must be HTTP 201 JSON, Bearer, include `local-client`, and provide a bounded expiry/session identifier. Invalid credentials, malformed responses and transport errors fail closed.
- The adapter invalidates its cached session on 401/403. The host must wire `getBootstrapCredential` to a real OS-keystore/native provider; no such platform provider is included yet.
- This flow is desktop-local only. It does not support mobile pairing, remote bootstrap, LAN exposure, or Tailscale access.
