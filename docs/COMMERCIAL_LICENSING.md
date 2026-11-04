# Commercial licensing and signed releases

## Product and payment model

Office Kit is local-first software. A commercial license grants a defined right to use the software; it does not require the customer to rent access to a hosted Office Kit service.

Recommended initial catalog (prices deliberately not fixed in this technical contract):

| Package | Commercial grant | Typical customer |
|---|---|---|
| Personal | Perpetual use, 1 installation | Individual |
| Small Team | Perpetual use, up to 10 installations | Small office |
| Business | Perpetual use, up to 50 installations | Department / SME |
| Enterprise | Negotiated perpetual site or installation pack | Larger organization |

Higher-volume packs should reduce the effective price per installation. A perpetual purchase includes the licensed major version and the update/support period stated at sale. Major-version upgrades and optional support can be sold separately. Do not promise lifetime updates unless that is the actual commercial offer.

Optional recurring services may be offered separately to enterprise customers (managed hosting, private relay, central administration, support SLA or federation infrastructure). They must not silently convert the desktop license into a rental.

## Order, invoice and entitlement lifecycle

1. A sale creates an immutable order record with order ID, customer/legal entity, product edition, package, quantity, currency, gross/net amount, tax treatment, payment provider reference and timestamp.
2. Successful payment/invoice settlement causes the licensing service to issue a signed entitlement. Failed, pending or refunded payments do not issue an active grant.
3. The customer receives the signed license file/key and invoice. The license contains an opaque customer reference, not personal data or payment credentials.
4. The application imports the license locally and verifies its Ed25519 signature against a public key pinned in the application.
5. Seat activation/deactivation is handled by a trusted host registry. A local UI counter is not authoritative and cannot safely enforce a shared 10/50-seat limit across disconnected computers.
6. Refund, chargeback, fraud or contractual termination creates a revocation/update event. Fully offline perpetual licenses cannot be instantly revoked; sales terms must state this limitation. Optional periodic online checks require clear disclosure and a defined grace policy.

Keep order/invoice records in the sales system; keep only the minimum entitlement and opaque reference in the customer's installation. Never store card details in Office Kit.

## Technical entitlement contract implemented in this branch

- Versioned entitlement schema, product/edition/plan checks, UTC validity dates and explicit perpetual expiry (null).
- Ed25519 signature envelope. The private signing key remains outside the application and outside this repository.
- Canonical JSON payload serialization makes signed bytes deterministic.
- Signature verification is injected by the native/browser host and must use a pinned trusted public key selected by key ID. Missing verifier, unknown key, tampering or invalid metadata fails closed.
- Installation limits are explicit. Counting and reserving seats requires a trusted, durable, atomic host registry; the current helper only evaluates a count supplied by that registry and does not activate machines.
- No billing provider, checkout, customer database, key generation/signing service, native activation UI or online revocation endpoint is implemented by this module.

## Signing the application for distribution

Application signing is separate from license signing:

- Android: build a release Android App Bundle (AAB), sign it with the Play App Signing upload key, and enrol in Google Play App Signing so Google manages the app-signing key used for delivered APKs. Protect and back up the upload keystore and its passwords. Never commit keystores or passwords to GitHub.
- Windows: use an Authenticode code-signing certificate to sign the installer and executable; timestamp signatures. SmartScreen reputation and installer trust are separate from Office Kit license validity.
- Release CI should receive signing material through protected environment secrets or a dedicated signing service, use least privilege, and never expose secrets in logs or artifacts.
- Do not create a production signing key until package IDs, ownership, recovery, and release responsibilities are agreed.

## Pricing and launch gates

Set prices only after competitor research, cost modelling, support assumptions, VAT/tax and regional pricing review. Start with a small set of clear packages and test willingness to pay. Do not publish a final price from engineering estimates alone.

Before public sale: legal terms/EULA, privacy notice, refund policy, invoicing/VAT workflow, support/update policy, license issuance and recovery, key rotation, abuse handling, and a tested signed release pipeline are required.
