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

Submit each Candidate source capture and its complete still-image intent in one
request. UBC Discovery binds the image object keys to the Candidate id and returns
the S3 upload targets in the same response:

    curl -X POST \
      -H 'Authorization: Api-Key ubc_live_<credential-id>.<random-secret>' \
      -H 'Content-Type: application/json' \
      -d '{
        "source_type":"instagram",
        "external_source_id":"post-123",
        "description":"Club night at the Nest",
        "source_account":"ubcams",
        "image_content_types":["image/jpeg","image/png"]
      }' \
      https://api.example/ingestion/event-candidates

POST each returned target to S3 using the matching `image/jpeg`, `image/png`, or
`image/webp` content type (5MB maximum). Upload targets expire after 300 seconds.
Use an empty `image_content_types` array for caption-only captures. Repeated
submissions use the same source identity and identical image content types;
conflicting image intent is rejected. If extraction has already completed, an
idempotent retry returns the existing Candidate with no upload targets because
late evidence cannot replace the retained original extraction.

## Rotation and revocation

Generate a new credential before changing the integration, verify that the
integration is using it, then revoke the old credential. Revocation preserves
the credential row and audit history.

Credentials may have an expiry date. The ingestion dependency rejects unknown,
malformed, expired, and revoked tokens and records the last successful use on
the credential row.
