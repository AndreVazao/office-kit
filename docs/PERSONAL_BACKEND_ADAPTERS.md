# Personal backend adapter integration map

Reviewed and updated on 2026-11-22. The VST adapter contract below contains read-only cockpit snapshots and a restricted assistant-message bridge; live VST compatibility is not yet verified. This is an integration map, not a claim that either backend is fully production-connected or that remote exposure is safe.

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
| Runtime status | `GET /runtime/status` | local-client session |
| Runtime truth/state | `GET /runtime/truth`, `GET /runtime/state` | local-client session |
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

### Current Office Kit cockpit contract — Phases 1 and 2

| Office Kit view | VST route | Interpretation |
|---|---|---|
| Observer summary | `GET /observer/summary` | Authenticated synchronization probe |
| Liveness | `GET /health` | Public liveness only; not proof of private access |
| CEO / overview | `GET /status` | Authenticated engine snapshot |
| Central Memory | `GET /learning-memory/health`, `GET /learning-memory/runtime` | Authenticated storage and worker diagnostics |
| Recovery / diagnostics | `GET /diagnostics` | Authenticated diagnostics snapshot |
| Radar / freshness | `GET /market-data-health` | Authenticated data freshness state |
| Markets | `GET /venue-health` | Authenticated venue state |
| Evidence | `GET /evidence-scorecard` | Authenticated evidence summary |
| Audit integrity | `GET /evidence-ledger/audit` | Authenticated ledger audit summary; full unpaginated ledger excluded |
| PAPER collector | `GET /paper-collector/resources` | Authenticated resource diagnostics |
| Research | `GET /research` | Authenticated research queue snapshot |
| Human interaction | `GET /human-interaction/pending` | Authenticated pending intervention snapshot |
| Assistant / research | `POST /assistant/message` | Fixed message+department body; backend scopes enforced |

The adapter uses authenticated loopback `GET /observer/summary` for synchronization plus the twelve cockpit GET routes in the table above. The fixed `POST /assistant/message` route is separate from the GET allowlist and cannot accept an arbitrary path or method. The route paths and scopes were checked against VST `main` at `ac88989caeff86198339de38e241b3e52560e791`. Live response compatibility remains pending.

### Authentication and safety

- The owner supplies the VST control token for one active session. It is held only in process memory and sent only in the `X-Token` header; disconnect, authentication rejection and close clear the reference. It is never persisted by the Office Kit.
- The adapter permits only HTTP loopback GETs from the fixed allowlist on port 8765, rejects redirects and remote endpoints, and declares `read_state` plus `assistant_message`. The twelve cockpit endpoints are read with a maximum of three concurrent requests. The only POST is `/assistant/message`, restricted to chat/status/research; PAPER control phrases and credential-like messages are blocked locally. The unpaginated evidence-ledger record list is excluded. Responses pass a bounded recursive redactor that removes claim tokens, credential fields, owner identifiers, local paths, URL query data and pending human-interaction form values before reaching the renderer.
- The assistant message requires `read_private_state`; research additionally requires `submit_research`. A 403 scope denial preserves the session token; a 401 clears it. Timeout/5xx after send is `UNKNOWN` and is never retried automatically.
- Backend-supported conversation departments are `brain`, `markets`, `radar`, `research`, `paper`, `risk`, `recovery`, `audit`, and `human`. `analysis` and `central_memory` remain read-only panels until VST supplies dedicated handlers.
- The observer envelope must contain `ok === true` before state/count/health fields are accepted. `updated_at_ms` is treated as the last observer publication time, not proof of engine readiness. Missing, stale or future timestamps do not produce authoritative state.
- The adapter does not copy observer-provided agents/tasks; both arrays remain empty. `REAL` is informational only; VST refusal is surfaced. `executionAuthorized=false` and `allowRiskBearingActions=false`. No order, mode, PAPER control, pairing, file-upload or execution-surface mutation route is exposed.
- The Windows host requires `ownerConsent: true` to set/clear the session token and does not auto-connect. Connection is explicit. The token is memory-only, is not retained across restarts or disconnects, and is never exposed by status APIs. JavaScript cannot guarantee zeroization of strings; only references and active requests are cleared.
- A successful fake response or local transport handshake is not proof that VST is ready, authorized or trading. Live observer/assistant contract validation and physical-PC testing remain required.

## Shared implementation requirements

- Implement two separate adapters behind the same versioned Office Kit adapter contract; do not add either backend's imports or models to the generic core.
- Keep DGM-MAT and VST endpoint bases, credentials, sessions and caches in separate installation namespaces.
- DGM-MAT bootstrap credentials use the platform keystore. The VST cockpit control token is memory-only for the active session and is never persisted. Never place credentials in profile JSON, logs, URLs or browser local storage.
- Use bounded timeouts, cancellation, polling backoff, sequence/freshness metadata and strict response allowlists. Do not copy arbitrary backend payloads into the visual model.
- If authentication, authorization, endpoint identity or data freshness cannot be verified, show disconnected/unverified and suppress operational claims.
- Do not create missions, send chat messages, approve actions, execute repairs, start/stop engines or submit trading commands in this read-only phase.

## Implementation status — updated 2026-11-12

- Product edition profiles and physical source-package isolation are merged. Universal remains backend-neutral; DGM-MAT and VST adapters/credentials remain edition-specific.
- The DGM-MAT adapter/session hardening is integrated in main. Its Windows CNG bootstrap composition is DGM-MAT-only; live tests against a running DGM-MAT instance and physical-PC validation remain pending.
- The documented `timestamp` is treated as the last state mutation in seconds, not a heartbeat or snapshot-generation timestamp. The adapter reports mutation age for diagnostics but always returns `synchronizing` / `synchronized: false`; agents and tasks remain empty. It does not infer live operational activity.
- One request deadline covers token acquisition, fetch and response-body parsing. Provider/fetch errors are reduced to safe bounded codes; 401/403 awaits bounded local token invalidation.
- Each successful adapter connection receives a fresh UUID session identity. A connection-generation fence prevents a late poll from an earlier connection from emitting into a newer session.
- `DgmMatLocalSessionProvider` now applies one deadline to bootstrap-keystore retrieval, the loopback session exchange and response-body parsing. Caller cancellation is propagated; the bootstrap credential is not retained and the short-lived access token remains memory-only.
- The DGM-MAT local-session provider validates the clock before reusing or requesting a token and again before caching the returned session expiry. Throwing, non-finite, negative-zero and out-of-Date-range values fail closed with `dgm_mat_clock_invalid`; `getState()` validates the clock even when no token is cached. Unit regressions cover invalid clocks before bootstrap and between response parsing and expiry recording. Live DGM-MAT and physical-PC validation remain separate gates. Final documentation-synchronized PR #94 HEAD `9cea25e098bcd5c1467b05abc21c93921f23d1bc` passed CI #604 (`43604372228`) on Linux/Windows Node 22 and Node 26.13.1 and Chromium visual #524 (`43604372222`) on the same SHA.
- PR #72 integrated the generic Windows CNG vault and DGM-MAT-only host composition. Windows native CNG CI passed; live DGM-MAT and physical-PC validation remain pending.
- PR #78 adds the VST read-only preview adapter and VST-only Windows host composition. CI #43230962819 and visual regression #43230962934 passed on implementation HEAD `3aff126095e4af10d16ea65fccaeb58be983eb43`; the VST CNG/SQLite integration test passed on Windows Node 22 and 26.13.1 using a fake observer response. Live VST contract verification, full signed host lifecycle, trusted-publisher acceptance and physical-PC validation remain separate gates. The subsequent documentation-only sync commit must also pass checks on its own PR HEAD before merge. Do not claim either personal backend is fully production-connected.

## DGM-MAT Windows host composition — integrated in main (PR #72, 2026-11-11)

- `DgmMatLocalSessionProvider` exchanges the bootstrap credential for a short-lived local-client session using `POST /auth/session` on the exact configured loopback endpoint (default `127.0.0.1:8181`) only.
- The generic Windows host exposes `createSecretStore(namespace)`. The DGM-MAT-only `createWindowsDgmMatHost` uses namespace `dgmat.bootstrap`; Universal and VST do not include this composition or its bootstrap credential flow.
- The bootstrap secret is encrypted before persistence: AES-256-GCM ciphertext and metadata are stored in SQLite; the random data key is wrapped by a separate installation/namespace-scoped RSA key in the Windows CNG Software KSP. The private key has `ExportPolicy.None`; the node-identity ECDSA key is not reused.
- The vault reports OS-protected software storage and `hardwareBacked=false`. This is not a TPM claim. The native helper remains protected by the host's Authenticode publisher pin.
- Provisioning and removal require `ownerConsent: true`. The host does not auto-connect; `connect()` is explicit. The adapter remains authenticated loopback GET-only/read-only. Disconnect/close clears the in-memory access token.
- Keystore retrieval receives the session exchange AbortSignal and terminates the helper process on cancellation. The complete session deadline includes the keystore read, loopback POST and response-body parsing.
- Host health explicitly reports backend operational state as `unverified`. The source timestamp is last-mutation time, not a heartbeat; no agent/task activity is fabricated.
- Fake/unit tests validate envelope handling and composition contracts. The Windows CI integration test validates CNG key persistence across helper processes, non-exportability, encrypted SQLite contents and installation/namespace isolation. These tests do not replace a live DGM-MAT instance test or physical-PC validation; both remain pending.

- Backup constraint: the CNG wrapping key is user-profile scoped and non-exportable. A SQLite-only backup cannot restore the bootstrap credential on another profile/machine; loss of the key requires explicit re-enrolment. A durable recovery workflow remains pending.


## VST Windows host composition — PR #78 preview (2026-11-12)

- `createWindowsVstHost` is exposed only through the VST edition's `./windows-host/vst` entrypoint. Universal and DGM-MAT do not include the VST composition or its token flow.
- The host keeps the owner-approved control token only in process memory for one session; set/clear require explicit owner consent. Disconnect, authentication rejection and close clear the reference. No CNG persistence is used.
- The adapter uses loopback GETs from a fixed read-only allowlist with `X-Token`; it rejects redirects and remote endpoints. `/observer/summary` must have `ok === true`; cockpit sections preserve individual unavailable states without inventing data.
- No command or trading route is exposed. Agent/task arrays remain empty, REAL is informational only and backend readiness stays unverified.
- Unit tests use fake HTTP and a fake host. The dedicated integration test verifies memory-only token lifecycle and read-only endpoint aggregation with fake HTTP responses. It does not prove live VST compatibility, signed Windows host startup or physical-PC installation.
