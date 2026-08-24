# MacroHub

MacroHub is a dark, responsive Geometry Dash macro platform for browsing levels, publishing replay files, filtering downloads by replay tool, converting local files, collecting macros, commenting, and moderation.

The public catalog starts empty. The seed command creates only the format, replay-tool, and compatibility registries, so download counts, likes, level totals, and uploader metrics come from actual activity.

## Stack

- Next.js-compatible App Router UI through Vinext, React, TypeScript, and Tailwind CSS
- PostgreSQL/Neon with Prisma ORM
- ChatGPT Sites identity headers with an explicit MacroHub session cookie, so first visits remain signed out
- Cloudflare R2 through the `FILES` binding
- Zod validation and strict TypeScript

## Local setup

Requirements: Node.js 22.13 or newer, PostgreSQL 15 or newer, and an R2-compatible local binding supplied by the Sites/Vite setup.

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run db:seed
npm run dev
```

For migrations, use a direct PostgreSQL/Neon connection URL rather than a transaction-pooled runtime URL. The initial migration enables `pg_trgm`; enable that extension in the database console first if the migration role cannot create extensions.

The converter remains usable without a database. Catalog, account, upload, and social features return clean unavailable/empty states until `DATABASE_URL` and the R2 binding are configured.

## Cloudflare/Sites bindings

The repository contains `.openai/hosting.json` with the R2 binding name `FILES`. Production also needs these secrets/environment values:

- `DATABASE_URL`
- `RATE_LIMIT_SECRET` with at least 32 random bytes
- `NEXT_PUBLIC_SITE_URL`
- optional `GD_LEVEL_PROVIDER_URL`

Sites supplies the authenticated user headers consumed by `app/chatgpt-auth.ts`. Local anonymous browsing and conversion do not need an auth provider emulator.

Configure R2 lifecycle rules to delete `quarantine/` objects after 24 hours and generated `cache/` objects after the chosen cache retention window. Quarantine manifests also contain a one-hour application expiry. Preserve and reconcile ready objects when a database commit outcome is ambiguous; never delete them speculatively.

## Database

The Prisma schema separates macros, formats, tools, and compatibility:

- `Macro` owns one canonical replay and one ready original file.
- `MacroFormat` and `ReplayTool` are independent registries.
- `FormatToolCompatibility` is the many-to-many read/write relationship.
- `MacroConversionCapability` records a macro-specific assessment, canonical hash, and exporter version.
- Direct downloads re-check enabled state, capability freshness, tool status, compatibility, and exporter assessment before generating bytes.
- Likes, collection membership, reports, and deduplicated download windows use database uniqueness constraints.
- `RateLimitBucket` provides shared limits across Worker isolates when PostgreSQL is available, with a bounded local fallback for converter-only development.

Run:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

Promote an account to moderator/admin directly in PostgreSQL after its first sign-in:

```sql
UPDATE "User" SET "role" = 'ADMIN' WHERE "emailNormalized" = 'you@example.com';
```

## Replay conversion

Conversion always follows one path:

```text
source bytes -> format detector -> parser -> MacroHub canonical replay -> capability assessment -> exporter -> target bytes
```

There is no source-to-target converter matrix. A format is downloadable only when it has a real exporter and the generated file passes semantic round-trip verification when a parser is available.

Implemented codecs:

- `.gdr2` version 2 import/export, verified against CC0 Eclipse replay fixtures
- `.macrohub.json` canonical version 1 import/export

The registry also contains GDR, GDR JSON, MHR, CML, SLC, xdBot/XDBot, Echo, ReplayBot, yBot, OmegaBot, TASBot, Rush, KD-Bot, zBot, Fembot, TCBot, Amethyst, GDMO, and ReplayEngine entries. Entries without a verified specification remain non-exportable; MacroHub never emits placeholder or invented replay files.

The canonical format is documented by `schemas/macrohub-replay-v1.schema.json`. New codecs implement `MacroParser`, `MacroExporter`, and `MacroFormatDefinition`, then add explicit tool compatibility records separately.

## Geometry Dash metadata provider

`GeometryDashLevelProvider` keeps catalog logic independent of an external level service. When `GD_LEVEL_PROVIDER_URL` is set, the provider may be replaced with an HTTP adapter that returns:

```json
{
  "id": "123",
  "name": "Level name",
  "creator": "Creator",
  "difficulty": "Demon",
  "demonDifficulty": "Extreme",
  "stars": 10,
  "length": "XL",
  "geometryDashVersion": "2.2",
  "fetchedAt": "2026-08-24T12:00:00.000Z",
  "source": "provider-name"
}
```

If no trusted provider is configured and the replay does not contain a level name, the uploader must supply the missing display fields. A level ID embedded in the replay must match the submitted ID.

## Security and operations

- 10 MiB file limit, allowlisted extensions, detected content, MIME normalization, filename sanitization, and executable/active-content signature rejection
- same-origin checks on state-changing routes and bounded JSON bodies
- authenticated ownership checks, account-state enforcement, role-gated moderation, atomic audit records, and database constraints/triggers
- idempotent publishing via `sourceUploadId`
- R2 quarantine and copy-before-commit storage flow with rollback/reconciliation safeguards
- HMAC actor identifiers and rapid-download deduplication
- database-backed browse filters, bounded autocomplete, pagination, and indexed search fields

For a high-volume deployment, monitor rate-limit table growth, schedule expired-bucket cleanup, apply the R2 lifecycle rules above, and run a periodic storage reconciliation against `MacroCanonicalReplay` and `MacroFile` keys.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The conversion suite includes a real Eclipse `.gdr2` fixture, byte-identical round trips, canonical JSON conversion, loss warnings, hard conversion blocks, tool-policy resolution, and planned-format fail-closed checks.
