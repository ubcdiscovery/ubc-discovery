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

Submit Candidate source captures with that token, then upload still images:

    curl -X POST \
      -H 'Authorization: Api-Key ubc_live_<credential-id>.<random-secret>' \
      -H 'Content-Type: application/json' \
      https://api.example/ingestion/event-candidates

    curl -X POST \
      -H 'Authorization: Api-Key ubc_live_<credential-id>.<random-secret>' \
      -H 'Content-Type: application/json' \
      -d '{"source_type":"instagram","external_source_id":"post-123","content_types":["image/jpeg","image/png"]}' \
      https://api.example/ingestion/event-candidates/images/presign

POST each returned target to S3 using the matching `image/jpeg`, `image/png`, or `image/webp` content type (5MB maximum). Object keys are bound to the Candidate id.

## Rotation and revocation

Generate a new credential before changing the integration, verify that the
integration is using it, then revoke the old credential. Revocation preserves
the credential row and audit history.

Credentials may have an expiry date. The ingestion dependency rejects unknown,
malformed, expired, and revoked tokens and records the last successful use on
the credential row.
