# VST cockpit adapter — Phase 1 read-only contract

**Status:** implementation in progress; CI and real-backend acceptance are pending.  
**Scope:** Office Kit only. This document does not change or extend the VST backend.

## Authority boundary

- VST remains the only operational authority and continues independently if Office Kit closes.
- Office Kit is a read-only authenticated client in this phase.
- No trading logic, risk engine, exchange credentials, learning store, backend lifecycle control, or financial authorization is implemented here.
- The adapter exposes only `read_state`. It does not expose a generic HTTP method, arbitrary route, or write capability.
- No agent/task activity is synthesized. The existing observer snapshot continues to publish empty `agents` and `tasks` until VST provides explicit records with verified semantics.

## Verified VST routes

The route contract was checked against VST `main` at `ac88989caeff86198339de38e241b3e52560e791` in `PC_ENGINE/api/server.py`.

| Cockpit section | Method and path | Authentication |
|---|---|---|
| Liveness | `GET /health` | Public liveness only; not proof of private access |
| CEO / overview | `GET /status` | `read_private_state` |
| Central Memory health | `GET /learning-memory/health` | `read_private_state` |
| Central Memory runtime | `GET /learning-memory/runtime` | `read_private_state` |
| Recovery / diagnostics | `GET /diagnostics` | `read_private_state` |
| Radar / data freshness | `GET /market-data-health` | `read_private_state` |
| Markets / venues | `GET /venue-health` | `read_private_state` |
| Evidence | `GET /evidence-scorecard` | `read_private_state` |
| PAPER collector resources | `GET /paper-collector/resources` | `read_private_state` |
| Research queue | `GET /research` | `read_private_state` |
| Human intervention queue | `GET /human-interaction/pending` | `read_private_state` |

The existing `GET /observer/summary` remains the authenticated connection/synchronization probe for the runtime adapter. The nine cockpit routes above are an additional bounded read-only snapshot.

## Transport and data handling

- Default endpoint is exact loopback `http://127.0.0.1:8765`; LAN/Tailscale is deliberately not enabled in this increment.
- Every request uses `GET`, `X-Token`, `cache: no-store`, `credentials: omit`, and `redirect: error`.
- The owner supplies the control token for the active session. The host keeps it only in process memory and clears its reference on disconnect, authentication rejection, and close. It is not written to the CNG vault, renderer storage, URLs, or logs. JavaScript strings cannot be reliably zeroized.
- Requests are bounded by the adapter timeout and use at most three concurrent endpoint reads.
- Endpoint failures are represented as unavailable sections with sanitized error codes. Other read sections can still be displayed.
- Every payload passes a bounded recursive redactor: claim tokens, credentials, owner identifiers, local filesystem paths and URL query/fragment/user-info are removed; free-text token-like assignments are redacted. Pending human-interaction form values/defaults are also removed. Nested depth, object keys, array lengths and string lengths are bounded.
- Authentication rejection invalidates the cockpit snapshot; a partial snapshot is not reported as authenticated success.
- The response is session data only. It is not persisted by the Office Kit visual layer or host. The `/human-interaction/pending` claim token is deliberately removed; this phase cannot claim/respond to a human-interaction request.
- Mode and authority flags are descriptive only. `executionAuthorized`, `ordersSubmitted`, and `riskBearingActionsAllowed` remain false in the Office Kit contract.

## Host interface

After explicit session-token authentication and explicit connection, the VST host exposes `getCockpitSnapshot()`. The local host CLI accepts a fixed `authenticate` request carrying the owner-approved token through stdin only, then the fixed `cockpit-snapshot` command. The token is not echoed or logged and is cleared on disconnect/close; no arbitrary route or method is accepted.

## Explicitly not implemented in Phase 1

- `POST /assistant/message` and department context routing.
- Task/request lifecycle tracking beyond data actually returned by the backend.
- PAPER start/pause/resume/stop controls.
- Human-interaction response/cancel actions.
- LAN/Tailscale, device pairing, or remote identity verification.
- Android packaging, cockpit panels, or live backend end-to-end acceptance.

## Next gates

1. Pass Linux/Windows Node 22/26 and Chromium visual CI on the exact PR HEAD.
2. Add a controlled authenticated VST backend integration test using the real route factory, not only mocked fetch responses.
3. Confirm partial endpoint failures, expired/revoked tokens, stale timestamps, and server restart behavior.
4. Keep the Windows host fail-closed until the installer-authenticated Authenticode policy is implemented; this adapter PR does not bypass that gate.
5. Implement the authenticated assistant gateway in a separate phase after its department and permission semantics are contract-tested.
6. Add LAN/Tailscale only after endpoint identity, origin validation, token transport, and reconnect behavior are independently verified.
