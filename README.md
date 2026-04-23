# @guayaba/graft-cli

CLI and programmatic toolkit to generate, validate, and publish **GRAFTs** (Guayaba Runtime Agent Framework Templates) from existing agent workspaces.

A GRAFT is a reusable, declarative agent template — see the marketplace roadmap in `gene-seed/internal/roadmap/grafts-marketplace.md` for the full schema (`schema_version: 2`).

## Install

```bash
npm i -g @guayaba/graft-cli
```

Or run on demand:

```bash
npx @guayaba/graft-cli --help
```

## Quick start

```bash
# 1. Generate a graft.json from an OpenClaw workspace
graft init --workspace ./my-agent

# 2. (optional) Validate it against the Guayaba API before publishing
graft init --validate

# 3. Push it to your personal storage on the Guayaba backend
graft push --icon ./icon.png --cover ./cover.jpg
```

## Commands

### `graft init`

Inspect an agent workspace and emit a `graft.json` template.

```
Options:
  -w, --workspace <path>   Workspace root. Defaults to cwd.
  -o, --out <path>         Output file. Defaults to ./graft.json.
  -f, --force              Overwrite the output file if it already exists.
      --no-interactive     Skip markdown prompts (auto-set when stdin isn't a TTY).
      --validate           After writing, POST the envelope to the Guayaba
                           API for authoritative validation. Reads
                           $GUAYABA_API_KEY or prompts for one.
```

### `graft push`

Upload a `graft.json` (and optional artwork) to your **personal** storage on the Guayaba backend.

Drafts pushed this way are private to your account — they aren't published to the public marketplace until you explicitly submit them for review (separate flow, not yet implemented).

```
Options:
  -i, --input <path>   Path to the GRAFT envelope. Defaults to ./graft.json.
      --icon  <path>   Optional icon image  (PNG/JPG/WebP, ≤ 1 MB).
      --cover <path>   Optional cover image (PNG/JPG/WebP, ≤ 4 MB).
```

Authentication: requires an account **master** API key. Read from
`$GUAYABA_API_KEY` or prompted in a TTY.

Storage layout (server-side):

```
personal/{user_id}/{slug}/{version}/metadata.json
personal/{user_id}/{slug}/{version}/schema.json
personal/{user_id}/{slug}/icon.{png|jpg|webp}    ← unversioned, sweeps stale ext
personal/{user_id}/{slug}/cover.{png|jpg|webp}   ← unversioned, sweeps stale ext
```

`(slug, version)` is **immutable**: re-pushing the same pair returns 409.
Bump the `metadata.version` field to push again.

### Validation

`POST /api/v1/grafts/validate` is the **single source of truth** for "is this envelope authorable?". `--validate` and the manager UI's "Export GRAFT" modal both call into the same backend service (`GraftSchemaValidator`); the CLI does no client-side schema checks beyond JSON parseability.

## Two modes

The package exposes both:

- A **CLI** (`graft`) for human and CI use.
- A **programmatic API** (`import { ... } from '@guayaba/graft-cli'`) for embedding the same logic into other tools.

```ts
import {
  readOpenclawWorkspace,
  extractOpenclawSummary,
  buildGraftFromOpenclaw,
  defaultMetadataFor,
  validateGraftPackage,
  pushGraftPackage,
} from '@guayaba/graft-cli';
```

## Authentication model

The CLI talks to the **Public API v1 surface** (`https://api.guayaba.run/api/v1`), not the manager UI's Sanctum endpoints. That requires an account **master** API key (`g_master_*`) — slave / agent-scoped keys (`g_agent_*`) are rejected with 403.

Generate a master key from the manager UI: *Account → API Keys → New master key*. The same key works for both `--validate` and `push`.

See `gene-seed/internal/architecture/security.md` for the full auth model.

## Development

```bash
npm install
npm run build      # tsup → dist/
npm run test       # vitest
npm run typecheck  # tsc --noEmit
```

Node ≥ 18 (uses `globalThis.fetch`, `FormData`, `Blob`).
