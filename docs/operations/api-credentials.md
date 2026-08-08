# Managed API credentials

Managed API credentials authenticate Candidate ingestion integrations. They do
not authenticate administrator operations or canonical Event Listing routes;
Firebase administrator Members remain the only admin actors.
There is no environment-variable API-key fallback.

## Provisioning

Open `/admin/api-keys` as a Firebase administrator, enter a label, and generate
the credential. The complete `ubc_live_<credential-id>.<random-secret>` token is
shown only in the generation response and page state. Copy it immediately into
the integration's secret store. The credential list never returns the raw token
or its hash.

Submit extracted Candidates with that token:

    curl -X POST \
      -H 'Api-Key: ubc_live_<credential-id>.<random-secret>' \
      -H 'Content-Type: application/json' \
      https://api.example/ingestion/event-candidates

## Rotation and revocation

Generate a new credential before changing the integration, verify that the
integration is using it, then revoke the old credential. Revocation preserves
the credential row and audit history.

Credentials may have an expiry date. The ingestion dependency rejects unknown,
malformed, expired, and revoked tokens and records the last successful use on
the credential row.
