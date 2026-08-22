# Backend-specific guidance

## Closed string domains

Use a domain-specific `enum.StrEnum` for a closed, server-owned set of string
values that is used in backend logic or persisted as data. Keep enum members
named for the domain rather than sharing one broad enum across unrelated
audit or lifecycle concepts.

For persisted closed sets, use a `VARCHAR` column with an explicit SQLAlchemy
`CheckConstraint` and a matching Alembic migration. Keep the enum values stable
once they are written to audit history; adding a value requires updating the
enum, model constraint, migration, and tests together.
