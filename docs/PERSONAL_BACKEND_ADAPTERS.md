# Personal backend adapter integration map

Reviewed and updated on 2026-11-12. The VST adapter contract below is implemented as a read-only preview; live VST compatibility is not yet verified. This is an integration map, not a claim that either backend is fully production-connected or that remote exposure is safe.

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

### Current Office Kit read-only preview contract

| Office Kit view | VST route | Interpretation |
|---|---|---|
| Observer summary | `GET /observer/summary` | Current adapter route; bounded state fields only |
| Liveness | `GET /health` | Candidate only; not consumed by the adapter |
| Other diagnostics/readiness | `GET /status`, `GET /diagnostics`, `GET /market-data-health`, `GET /venue-health`, `GET /evidence-scorecard` | Candidate routes only; not consumed by the current adapter |

The current adapter uses only `GET http://127.0.0.1:8765/observer/summary`. The implementation has not yet been verified against a running VST instance; confirm the exact route, port, response schema and timestamp semantics during live E2E before production.

### Authentication and safety

- The local API token is supplied by the owner and sent only in the `X-Token` header. The current adapter requires a token provider; the Windows host stores it through the generic CNG vault in namespace `vst.local-api`.
- The current adapter permits only HTTP loopback `GET /observer/summary` on port 8765, rejects redirects and remote endpoints, and declares only `read_state`.
- The observer envelope must contain `ok === true` before state/count/health fields are accepted. `updated_at_ms` is treated as the last observer publication time, not proof of engine readiness. Missing, stale or future timestamps do not produce authoritative state.
- The adapter does not copy observer-provided agents/tasks; both arrays remain empty. `REAL` is informational only; `executionAuthorized=false` and `allowRiskBearingActions=false`. No order, mode, start/stop, pairing, file-upload or execution-surface mutation route is exposed.
- The Windows host requires `ownerConsent: true` for token provisioning/removal and does not auto-connect. Connection is explicit. The token is fetched per request, not cached between requests or exposed by status APIs; plaintext exists transiently in process memory during each request and JavaScript cannot guarantee zeroization. The CNG key is user-profile/installation/namespace scoped and software-backed, not TPM-backed.
- A successful fake response or local transport handshake is not proof that VST is ready, authorized or trading. Live observer contract validation and physical-PC testing remain required.

## Shared implementation requirements

- Implement two separate adapters behind the same versioned Office Kit adapter contract; do not add either backend's imports or models to the generic core.
- Keep DGM-MAT and VST endpoint bases, credentials, sessions and caches in separate installation namespaces.
- Credentials must be supplied through a secure owner-controlled pairing/configuration flow and stored only in the platform keystore. Never place credentials in profile JSON, logs, URLs or browser local storage.
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
- The DGM-MAT local-session provider validates the clock before reusing or requesting a token and again before caching the returned session expiry. Throwing, non-finite, negative-zero and out-of-Date-range values fail closed with `dgm_mat_clock_invalid`; `getState()` validates the clock even when no token is cached. Unit regressions cover invalid clocks before bootstrap and between response parsing and expiry recording. Live DGM-MAT and physical-PC validation remain separate gates.
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
- The host stores the owner token through the generic CNG vault in namespace `vst.local-api`; provisioning/removal require explicit owner consent. Provisioning never auto-connects.
- The adapter uses only loopback `GET /observer/summary` with `X-Token`; it rejects redirects and remote endpoints. The response must have `ok === true`; failed envelopes suppress state values.
- No command or trading route is exposed. Agent/task arrays remain empty, REAL is informational only and backend readiness stays unverified.
- Unit tests use fake HTTP and a fake host. A dedicated Windows integration test uses the real CNG helper and SQLite vault through the VST host composition; it passed on Node 22 and Node 26.13.1 in CI #43230962819 on implementation HEAD `3aff126095e4af10d16ea65fccaeb58be983eb43`. It uses a fake observer response and does not prove live VST compatibility or physical-PC installation.
